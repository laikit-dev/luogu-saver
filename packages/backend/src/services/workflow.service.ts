import { Task } from '@/entities/task';
import { Workflow } from '@/entities/workflow';
import { WorkflowDeduplication } from '@/entities/workflow-deduplication';
import { getQueueByName } from '@/lib/queue-factory';
import { WORKFLOW_TEMPLATES } from '@/lib/workflow-templates';
import { logger } from '@/lib/logger';
import { WorkflowRuntimeStore } from '@/services/helpers/workflow-runtime-store.helper';
import { WorkflowScheduler } from '@/services/workflow-scheduler.service';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { QUEUE_NAMES, WORKFLOW_PRIORITY } from '@/shared/constants';
import { TaskStatus, TaskType } from '@/shared/task';
import { validateFlowStructure, WorkflowDefinition } from '@/utils/flow-validator';
import { normalizeErrorReason } from '@/utils/error-reason';
import { randomUUID } from 'node:crypto';
import { isDuplicateKeyError } from '@/utils/db-errors';
import { getRandomString } from '@/utils/string';

type WorkflowCreateOptions = {
    priority?: number;
    deduplicationKey?: string;
};

export class WorkflowService {
    static async createWorkflow(
        definition: WorkflowDefinition,
        options: WorkflowCreateOptions = {}
    ) {
        validateFlowStructure(definition);
        const priority = options.priority ?? WORKFLOW_PRIORITY.ANONYMOUS;
        const deduplicationKey = options.deduplicationKey?.trim() || null;
        if (deduplicationKey) {
            const existing = await this.getDeduplicatedWorkflow(deduplicationKey, priority);
            if (existing) return existing;
        }
        await this.ensureWorkflowQueueCapacity(definition, priority);

        const workflowId = randomUUID();
        const taskIds = Object.fromEntries(
            definition.tasks.map(task => [task.name, getRandomString(16)])
        );

        logger.info(
            {
                workflowId,
                priority,
                taskCount: definition.tasks.length,
                taskNames: definition.tasks.map(task => task.name)
            },
            'Creating workflow'
        );

        let claimInsertFailed = false;
        try {
            await Workflow.transaction(async manager => {
                const workflow = getServiceRepository<Workflow>(Workflow, manager).create({
                    id: workflowId,
                    rootJobId: null,
                    queueName: null,
                    definition,
                    status: 'active',
                    result: this.createInitialResult(definition)
                });
                await getServiceRepository<Workflow>(Workflow, manager).save(workflow);

                if (deduplicationKey) {
                    try {
                        await getServiceRepository<WorkflowDeduplication>(
                            WorkflowDeduplication,
                            manager
                        ).insert({ key: deduplicationKey, workflowId });
                    } catch (error) {
                        claimInsertFailed = true;
                        throw error;
                    }
                }

                const tasks = definition.tasks.map(taskDef =>
                    getServiceRepository<Task>(Task, manager).create({
                        id: taskIds[taskDef.name],
                        type: taskDef.data.type,
                        payload: taskDef.data.payload,
                        status: TaskStatus.PENDING,
                        info: null,
                        workflowId,
                        taskName: taskDef.name,
                        priority,
                        result: null
                    })
                );
                await getServiceRepository<Task>(Task, manager).save(tasks);
            });

            logger.debug(
                {
                    workflowId,
                    taskIds,
                    priority,
                    taskCount: definition.tasks.length
                },
                'Workflow database rows created'
            );

            const runtimePlan = await WorkflowRuntimeStore.initializeRuntime(
                definition,
                workflowId,
                taskIds,
                priority
            );
            await WorkflowScheduler.dispatchEntryPoints(runtimePlan.entryPointIds);

            logger.info(
                {
                    workflowId,
                    priority,
                    taskCount: definition.tasks.length,
                    entryPointIds: runtimePlan.entryPointIds,
                    reportTaskIds: runtimePlan.reportTaskIds,
                    trackTaskIds: runtimePlan.trackTaskIds
                },
                'Workflow created'
            );
            return {
                workflowId,
                taskIds: runtimePlan.taskIds,
                reportTaskIds: runtimePlan.reportTaskIds,
                trackTaskIds: runtimePlan.trackTaskIds,
                deduplicated: false
            };
        } catch (error) {
            // MariaDB may report a snapshot conflict rather than a duplicate-key error.
            // Reconcile claim insertion failures only after rollback and only to a real winner.
            if (deduplicationKey && (claimInsertFailed || isDuplicateKeyError(error))) {
                const existing = await this.getDeduplicatedWorkflow(deduplicationKey, priority);
                if (existing) return existing;
            }
            logger.error({ error, workflowId }, 'Workflow creation failed');
            await this.cleanupFailedCreate(workflowId, Object.values(taskIds));
            throw error;
        }
    }

    static async createWorkflowFromTemplate(
        templateName: string,
        params: any,
        options: WorkflowCreateOptions = {}
    ) {
        logger.info(
            {
                templateName,
                priority: options.priority ?? WORKFLOW_PRIORITY.ANONYMOUS
            },
            'Creating workflow from template'
        );

        const templateBuilders = new Map<string, unknown>(Object.entries(WORKFLOW_TEMPLATES));
        const builder = templateBuilders.get(templateName);
        if (builder === undefined) throw new Error(`Template ${templateName} not found`);

        if (typeof builder !== 'function') {
            throw new Error(`Template ${templateName} is invalid`);
        }

        const definition = builder(params) as WorkflowDefinition;
        logger.debug(
            {
                templateName,
                taskCount: definition.tasks.length,
                taskNames: definition.tasks.map(task => task.name)
            },
            'Workflow template built definition'
        );

        const targetId = String(params?.targetId || '').trim();
        const deduplicationKey =
            templateName === 'article-save-pipeline'
                ? `article-save:${targetId}`
                : templateName === 'paste-save-pipeline'
                  ? `paste-save:${targetId}`
                  : options.deduplicationKey;

        return this.createWorkflow(definition, { ...options, deduplicationKey });
    }

    static async getWorkflowById(id: string) {
        const workflow = await getServiceRepository<Workflow>(Workflow).findOne({ where: { id } });
        if (!workflow) return null;

        const taskRows = await getServiceRepository<Task>(Task).find({
            where: { workflowId: id }
        });
        const taskByName = new Map(taskRows.map(task => [task.taskName, task]));
        const tasks = (workflow.definition as WorkflowDefinition).tasks.map(taskDef => {
            const task = taskByName.get(taskDef.name);
            const fathers = taskDef.fathers || [];
            return {
                taskId: task?.id || null,
                taskName: taskDef.name,
                status: task ? this.formatTaskStatus(task.status) : 'missing',
                type: taskDef.data?.type || task?.type || null,
                target: taskDef.data?.payload?.target || task?.payload?.target || null,
                fathers,
                fatherIds: Object.fromEntries(
                    fathers
                        .map(fatherName => [fatherName, taskByName.get(fatherName)?.id])
                        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
                ),
                track: taskDef.track === true,
                report: taskDef.report === true,
                info: task ? this.formatTaskInfo(task) : null
            };
        });

        logger.debug(
            {
                workflowId: workflow.id,
                status: workflow.status,
                taskCount: taskRows.length,
                statusCounts: this.countTaskStatuses(taskRows)
            },
            'Workflow queried'
        );

        return {
            workflowId: workflow.id,
            status: workflow.status,
            createdAt: workflow.createdAt,
            updatedAt: workflow.updatedAt,
            tasks,
            result: workflow.result
        };
    }

    private static createInitialResult(definition: WorkflowDefinition) {
        const result: Record<string, any> = {};
        for (const task of definition.tasks) {
            if (task.track === true) result[task.name] = null;
        }
        return result;
    }

    private static async getDeduplicatedWorkflow(key: string, requestedPriority: number) {
        const claim = await getServiceRepository<WorkflowDeduplication>(
            WorkflowDeduplication
        ).findOne({ where: { key } });
        if (!claim) return null;

        const existing = await Workflow.transaction(async manager => {
            // Dispatch takes this same lock before reading SQL priority and adding a job.
            const workflow = await getServiceRepository<Workflow>(Workflow, manager).findOne({
                where: { id: claim.workflowId },
                lock: { mode: 'pessimistic_write' }
            });
            if (!workflow || ['completed', 'failed', 'expired'].includes(workflow.status)) {
                return null;
            }

            const taskRows = await getServiceRepository<Task>(Task, manager).find({
                where: { workflowId: workflow.id },
                select: ['id', 'taskName', 'type', 'status', 'priority']
            });
            const priority = taskRows.reduce(
                (current, task) => Math.min(current, task.priority ?? WORKFLOW_PRIORITY.ANONYMOUS),
                requestedPriority
            );
            if (taskRows.some(task => task.priority !== priority)) {
                await getServiceRepository<Task>(Task, manager).update(
                    { workflowId: workflow.id },
                    { priority }
                );
            }

            // A claim is visible before initial Redis initialization, so use SQL rows only.
            for (const task of taskRows) {
                if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) {
                    continue;
                }
                const job = await getQueueByName(QUEUE_NAMES[task.type]).getJob(task.id);
                if (!job || job.priority <= priority) continue;
                const state = await job.getState();
                if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
                    await job.changePriority({ priority });
                }
            }

            const taskIds = Object.fromEntries(
                taskRows
                    .filter(task => task.taskName)
                    .map(task => [task.taskName as string, task.id])
            );
            const definition = workflow.definition as WorkflowDefinition;
            return {
                workflowId: workflow.id,
                taskIds,
                reportTaskIds: Object.fromEntries(
                    definition.tasks
                        .filter(task => task.report === true)
                        .map(task => [task.name, taskIds[task.name]])
                ),
                trackTaskIds: Object.fromEntries(
                    definition.tasks
                        .filter(task => task.track === true)
                        .map(task => [task.name, taskIds[task.name]])
                ),
                deduplicated: true
            };
        });
        if (!existing) {
            // Terminal cleanup deletes claims before workflows; do not invert that lock order.
            await getServiceRepository<WorkflowDeduplication>(WorkflowDeduplication).delete({
                key,
                workflowId: claim.workflowId
            });
        }
        return existing;
    }

    private static async ensureWorkflowQueueCapacity(
        definition: WorkflowDefinition,
        priority: number
    ) {
        const jobsByQueue = new Map<string, number>();

        for (const task of definition.tasks) {
            const queueName = task.queueName || QUEUE_NAMES[task.data?.type as TaskType];
            if (!queueName) {
                throw new Error(`No queue name defined for workflow task: ${task.name}`);
            }
            jobsByQueue.set(queueName, (jobsByQueue.get(queueName) || 0) + 1);
        }

        for (const [queueName, jobsToAdd] of jobsByQueue) {
            logger.debug(
                {
                    queueName,
                    jobsToAdd
                },
                'Checking workflow queue capacity'
            );
            const queueWrapper = getQueueByName(queueName);
            if (await queueWrapper.wouldExceedMaxLength(jobsToAdd, priority)) {
                logger.warn(
                    {
                        queueName,
                        jobsToAdd
                    },
                    'Workflow queue capacity check failed'
                );
                throw new Error('Queue is full. Please try again later.');
            }
            logger.debug(
                {
                    queueName,
                    jobsToAdd
                },
                'Workflow queue capacity check passed'
            );
        }
    }

    private static async cleanupFailedCreate(workflowId: string, taskIds: string[]) {
        try {
            await WorkflowRuntimeStore.cleanupRuntime(taskIds);
            await getServiceRepository<WorkflowDeduplication>(WorkflowDeduplication).delete({
                workflowId
            });
            await getServiceRepository<Task>(Task).delete(taskIds);
            await getServiceRepository<Workflow>(Workflow).delete({ id: workflowId });
            logger.info({ workflowId, taskIds }, 'Workflow creation cleanup completed');
        } catch (cleanupError) {
            logger.error({ cleanupError, workflowId }, 'Failed to clean up workflow creation');
        }
    }

    private static countTaskStatuses(taskRows: Task[]) {
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

    private static formatTaskInfo(task: Task) {
        if (!task.info) return null;
        return task.status === TaskStatus.FAILED ? normalizeErrorReason(task.info) : task.info;
    }
}
