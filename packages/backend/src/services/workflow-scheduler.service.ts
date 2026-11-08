import { Task as TaskEntity } from '@/entities/task';
import { Workflow } from '@/entities/workflow';
import { getQueueByName } from '@/lib/queue-factory';
import { logger } from '@/lib/logger';
import { QUEUE_NAMES, WORKFLOW_PRIORITY } from '@/shared/constants';
import { TaskStatus } from '@/shared/task';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { WorkflowRuntimeStore } from '@/services/helpers/workflow-runtime-store.helper';
import { TaskDefinition, WorkflowDefinition } from '@/utils/flow-validator';

const TERMINAL_WORKFLOW_STATUSES: Record<string, true | undefined> = {
    completed: true,
    failed: true,
    expired: true
};
const TERMINAL_TASK_STATUSES = new Set([TaskStatus.COMPLETED, TaskStatus.FAILED]);

export class WorkflowScheduler {
    static async dispatchEntryPoints(entrypointIds: string[]) {
        logger.info({ entrypointIds }, 'Dispatching workflow entrypoint tasks');
        await Promise.all(entrypointIds.map(id => this.dispatchTaskById(id, 'entrypoint')));
    }

    static async releaseDescendants(taskId: string) {
        const runtimeTask = await WorkflowRuntimeStore.getRuntimeTask(taskId);
        if (!(await WorkflowRuntimeStore.claimDescendantRelease(taskId))) {
            logger.debug(
                {
                    workflowId: runtimeTask.workflowId,
                    taskId,
                    taskName: runtimeTask.taskName
                },
                'Workflow task descendants already released'
            );
            return [];
        }

        const descendantIds = await WorkflowRuntimeStore.getDescendantIds(taskId);
        const dispatchedTaskIds: string[] = [];
        const descendantCounters: Array<{ taskId: string; remaining: number }> = [];

        for (const descendantId of descendantIds) {
            const remaining = await WorkflowRuntimeStore.decrementFatherCounter(descendantId);
            descendantCounters.push({ taskId: descendantId, remaining });
            if (remaining <= 0) {
                if (await this.areFathersCompleted(descendantId)) {
                    await this.dispatchTaskById(descendantId, 'father-counter-zero');
                    dispatchedTaskIds.push(descendantId);
                } else {
                    logger.debug(
                        {
                            workflowId: runtimeTask.workflowId,
                            taskId,
                            taskName: runtimeTask.taskName,
                            descendantId
                        },
                        'Workflow descendant counter reached zero but fathers are not all completed'
                    );
                }
            }
        }

        logger.info(
            {
                workflowId: runtimeTask.workflowId,
                taskId,
                taskName: runtimeTask.taskName,
                descendantIds,
                descendantCounters,
                dispatchedTaskIds
            },
            'Released workflow task descendants'
        );

        return dispatchedTaskIds;
    }

    static async dispatchReadyTasksForWorkflow(workflow: Workflow, taskRows: TaskEntity[]) {
        if (TERMINAL_WORKFLOW_STATUSES[workflow.status] === true) return [];

        logger.info(
            {
                workflowId: workflow.id,
                status: workflow.status,
                taskCount: taskRows.length,
                statusCounts: this.countTaskStatuses(taskRows)
            },
            'Scanning workflow for ready tasks'
        );

        const taskByName = new Map(taskRows.map(task => [task.taskName, task]));
        const dispatchedTaskIds: string[] = [];

        for (const taskDef of (workflow.definition as WorkflowDefinition).tasks) {
            const taskRow = taskByName.get(taskDef.name);
            if (!taskRow) {
                logger.warn(
                    {
                        workflowId: workflow.id,
                        taskName: taskDef.name
                    },
                    'Workflow ready-task scan skipped task because task row is missing'
                );
                continue;
            }
            if (TERMINAL_TASK_STATUSES.has(taskRow.status)) {
                logger.debug(
                    {
                        workflowId: workflow.id,
                        taskId: taskRow.id,
                        taskName: taskDef.name,
                        status: taskRow.status
                    },
                    'Workflow ready-task scan skipped terminal task'
                );
                continue;
            }
            if (!(await this.areTaskDefFathersCompleted(taskDef, taskByName))) {
                logger.debug(
                    {
                        workflowId: workflow.id,
                        taskId: taskRow.id,
                        taskName: taskDef.name,
                        fathers: taskDef.fathers || []
                    },
                    'Workflow ready-task scan skipped task with incomplete fathers'
                );
                continue;
            }

            const runtimeTask = await WorkflowRuntimeStore.getRuntimeTask(taskRow.id);
            const queueName = QUEUE_NAMES[runtimeTask.type];
            const queueWrapper = getQueueByName(queueName);
            const existingJob = await queueWrapper.getJob(taskRow.id);
            const existingState = await existingJob?.getState();
            if (existingState && existingState !== 'completed' && existingState !== 'failed') {
                logger.debug(
                    {
                        workflowId: workflow.id,
                        taskId: taskRow.id,
                        taskName: taskDef.name,
                        queueName,
                        existingState
                    },
                    'Workflow ready-task scan skipped task with existing non-terminal job'
                );
                continue;
            }

            await this.dispatchTaskById(taskRow.id, 'recovery-ready');
            dispatchedTaskIds.push(taskRow.id);
        }

        logger.info(
            {
                workflowId: workflow.id,
                dispatchedTaskIds
            },
            'Workflow ready-task scan completed'
        );

        return dispatchedTaskIds;
    }

    private static async dispatchTaskById(taskId: string, reason = 'ready') {
        const runtimeTask = await WorkflowRuntimeStore.getRuntimeTask(taskId);
        await Workflow.transaction(async manager => {
            if (runtimeTask.workflowId) {
                // Hold the promotion lock through the SQL priority read and Redis queue add.
                const workflow = await getServiceRepository<Workflow>(Workflow, manager).findOne({
                    where: { id: runtimeTask.workflowId },
                    select: ['id', 'status'],
                    lock: { mode: 'pessimistic_write' }
                });
                if (!workflow || TERMINAL_WORKFLOW_STATUSES[workflow.status] === true) {
                    logger.debug(
                        {
                            workflowId: runtimeTask.workflowId,
                            taskId,
                            taskName: runtimeTask.taskName,
                            workflowStatus: workflow?.status || null,
                            reason
                        },
                        'Workflow task dispatch skipped because workflow is unavailable or terminal'
                    );
                    return;
                }
            }

            const taskRow = await getServiceRepository<TaskEntity>(TaskEntity, manager).findOne({
                where: { id: taskId },
                select: ['id', 'status', 'priority']
            });
            if (!taskRow) {
                logger.warn(
                    {
                        workflowId: runtimeTask.workflowId,
                        taskId,
                        taskName: runtimeTask.taskName,
                        reason
                    },
                    'Workflow task dispatch skipped because task row is missing'
                );
                return;
            }
            if (TERMINAL_TASK_STATUSES.has(taskRow.status)) {
                logger.debug(
                    {
                        workflowId: runtimeTask.workflowId,
                        taskId,
                        taskName: runtimeTask.taskName,
                        status: taskRow.status,
                        reason
                    },
                    'Workflow task dispatch skipped because task row is terminal'
                );
                return;
            }

            const queueName = QUEUE_NAMES[runtimeTask.type];
            if (!queueName) throw new Error(`No queue name defined for workflow task ID ${taskId}`);

            const queueWrapper = getQueueByName(queueName);
            if (await queueWrapper.getJob(taskId)) return;

            runtimeTask.priority = taskRow.priority ?? WORKFLOW_PRIORITY.ANONYMOUS;
            const { priority, ...jobData } = runtimeTask;
            logger.info(
                {
                    workflowId: runtimeTask.workflowId,
                    taskId: runtimeTask.id,
                    taskName: runtimeTask.taskName,
                    type: runtimeTask.type,
                    queueName,
                    priority,
                    reason
                },
                'Dispatching workflow task'
            );
            await queueWrapper.add(runtimeTask.taskName || runtimeTask.type, jobData, {
                jobId: runtimeTask.id,
                priority
            });
        });
    }

    private static async areFathersCompleted(taskId: string) {
        const runtimeTask = await WorkflowRuntimeStore.getRuntimeTask(taskId);
        const fatherIds = Object.values(runtimeTask.fatherIds || {});
        if (fatherIds.length === 0) return true;

        const fatherRows = await getServiceRepository<TaskEntity>(TaskEntity).findByIds(fatherIds);
        const statusById = new Map(fatherRows.map(task => [task.id, task.status]));
        return fatherIds.every(fatherId => statusById.get(fatherId) === TaskStatus.COMPLETED);
    }

    private static async areTaskDefFathersCompleted(
        taskDef: TaskDefinition,
        taskByName: Map<string | null, TaskEntity>
    ) {
        for (const fatherName of taskDef.fathers || []) {
            const fatherTask = taskByName.get(fatherName);
            if (!fatherTask || fatherTask.status !== TaskStatus.COMPLETED) return false;
        }
        return true;
    }

    private static countTaskStatuses(taskRows: Array<Pick<TaskEntity, 'status'>>) {
        const counts = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0
        };

        for (const task of taskRows) {
            counts[this.formatTaskStatus(task.status)] += 1;
        }

        return counts;
    }

    private static formatTaskStatus(status: TaskStatus) {
        switch (status) {
            case TaskStatus.PENDING:
                return 'pending' as const;
            case TaskStatus.PROCESSING:
                return 'processing' as const;
            case TaskStatus.COMPLETED:
                return 'completed' as const;
            case TaskStatus.FAILED:
                return 'failed' as const;
        }
    }
}
