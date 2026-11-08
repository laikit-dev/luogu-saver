import { Task as TaskEntity } from '@/entities/task';
import { Workflow } from '@/entities/workflow';
import { logger } from '@/lib/logger';
import { redisClient } from '@/lib/redis';
import { QUEUE_NAMES, WORKFLOW_PRIORITY } from '@/shared/constants';
import { CommonTask, TaskStatus, TaskType } from '@/shared/task';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { TaskDefinition, WorkflowDefinition } from '@/utils/flow-validator';

type RuntimeWorkflowTask = CommonTask & {
    priority: number;
};

type RuntimeBuildOptions = {
    completedTaskNames?: Set<string>;
    taskResults?: Record<string, unknown>;
};

type RuntimePlan = {
    taskIds: Record<string, string>;
    reportTaskIds: Record<string, string>;
    trackTaskIds: Record<string, string>;
    entryPointIds: string[];
};

export class WorkflowRuntimeStore {
    static async initializeRuntime(
        definition: WorkflowDefinition,
        workflowId: string,
        taskIds: Record<string, string>,
        priority: number,
        options: RuntimeBuildOptions = {}
    ): Promise<RuntimePlan> {
        const completedTaskNames = options.completedTaskNames || new Set<string>();
        const taskResults = options.taskResults || {};
        const descendants = this.buildDescendants(definition, taskIds);
        const runtimeTasks = definition.tasks.map(task =>
            this.toRuntimeTask(task, workflowId, taskIds, priority)
        );

        logger.info(
            {
                workflowId,
                taskCount: runtimeTasks.length,
                priority,
                completedTaskNames: [...completedTaskNames]
            },
            'Initializing workflow runtime state'
        );

        const multi = redisClient.multi();
        for (const task of runtimeTasks) {
            const fathers = task.fathers || [];
            const incompleteFatherCount = fathers.filter(
                name => !completedTaskNames.has(name)
            ).length;
            const descendantIds = descendants[task.id] || [];
            multi.set(this.taskDefKey(task.id), JSON.stringify(task));
            multi.set(this.taskCounterKey(task.id), String(incompleteFatherCount));
            multi.set(this.taskDescendantsKey(task.id), JSON.stringify(descendantIds));

            logger.debug(
                {
                    workflowId,
                    taskId: task.id,
                    taskName: task.taskName,
                    type: task.type,
                    queueName: QUEUE_NAMES[task.type],
                    fathers,
                    fatherIds: task.fatherIds || {},
                    descendantIds,
                    incompleteFatherCount,
                    track: task.track === true,
                    report: task.report === true,
                    priority
                },
                'Workflow runtime task initialized'
            );

            if (completedTaskNames.has(task.taskName || '')) {
                multi.set(this.taskReleasedKey(task.id), '1');
                if (taskResults[task.taskName || ''] !== undefined) {
                    multi.set(
                        this.taskResultKey(task.id),
                        JSON.stringify(this.unwrapStoredResult(taskResults[task.taskName || '']))
                    );
                }
            } else {
                multi.del(this.taskReleasedKey(task.id));
                multi.del(this.taskResultKey(task.id));
            }
        }
        await multi.exec();

        const reportTaskIds = Object.fromEntries(
            definition.tasks
                .filter(task => task.report === true)
                .map(task => [task.name, taskIds[task.name]])
        );
        const trackTaskIds = Object.fromEntries(
            definition.tasks
                .filter(task => task.track === true)
                .map(task => [task.name, taskIds[task.name]])
        );
        const entryPointIds = definition.tasks
            .filter(task => !task.fathers || task.fathers.length === 0)
            .map(task => taskIds[task.name]);

        logger.info(
            {
                workflowId,
                taskCount: runtimeTasks.length,
                entryPointIds,
                reportTaskIds,
                trackTaskIds
            },
            'Workflow runtime state initialized'
        );

        return {
            taskIds,
            reportTaskIds,
            trackTaskIds,
            entryPointIds
        };
    }

    static async getFatherResults(task: CommonTask) {
        const fatherIds = task.fatherIds || {};
        const entries = Object.entries(fatherIds);
        if (entries.length === 0) {
            logger.debug(
                {
                    workflowId: task.workflowId,
                    taskId: task.id,
                    taskName: task.taskName,
                    fatherNames: []
                },
                'Workflow task has no upstream father results to load'
            );
            return {};
        }

        const resultKeys = entries.map(([, taskId]) => this.taskResultKey(taskId));
        const redisResults = await redisClient.mget(resultKeys);
        const result: Record<string, unknown> = {};
        let redisHitCount = 0;
        let dbHitCount = 0;
        const missingFatherNames: string[] = [];

        for (const [index, [fatherName, fatherId]] of entries.entries()) {
            const redisValue = redisResults[index];
            if (redisValue) {
                result[fatherName] = JSON.parse(redisValue);
                redisHitCount += 1;
                continue;
            }

            const fatherTask = await getServiceRepository<TaskEntity>(TaskEntity).findOne({
                where: { id: fatherId },
                select: ['id', 'result']
            });
            if (fatherTask?.result !== undefined && fatherTask.result !== null) {
                result[fatherName] = this.unwrapStoredResult(fatherTask.result);
                dbHitCount += 1;
            } else {
                missingFatherNames.push(fatherName);
            }
        }

        logger.debug(
            {
                workflowId: task.workflowId,
                taskId: task.id,
                taskName: task.taskName,
                fatherNames: entries.map(([fatherName]) => fatherName),
                redisHitCount,
                dbHitCount,
                missingFatherNames
            },
            'Loaded workflow upstream father results'
        );

        return result;
    }

    static async storeTaskResult(taskId: string, returnvalue: unknown) {
        const result = this.unwrapStoredResult(returnvalue);
        await redisClient.set(this.taskResultKey(taskId), JSON.stringify(result));
        logger.debug(
            {
                taskId,
                resultKeys: this.getResultKeys(result)
            },
            'Stored workflow task result in runtime cache'
        );
    }

    static async rebuildRuntimeFromRows(workflow: Workflow, taskRows: TaskEntity[]) {
        logger.info(
            {
                workflowId: workflow.id,
                taskCount: taskRows.length,
                statusCounts: this.countTaskStatuses(taskRows)
            },
            'Rebuilding workflow runtime state from database rows'
        );

        const taskIds = Object.fromEntries(
            taskRows.filter(task => task.taskName).map(task => [task.taskName as string, task.id])
        );
        const completedTaskNames = new Set(
            taskRows
                .filter(task => task.taskName && task.status === TaskStatus.COMPLETED)
                .map(task => task.taskName as string)
        );
        const taskResults = Object.fromEntries(
            taskRows
                .filter(task => task.taskName && task.result !== undefined && task.result !== null)
                .map(task => [task.taskName as string, task.result])
        );
        const priority =
            taskRows.find(task => task.priority !== null && task.priority !== undefined)
                ?.priority ?? WORKFLOW_PRIORITY.ANONYMOUS;

        const plan = await this.initializeRuntime(
            workflow.definition,
            workflow.id,
            taskIds,
            priority,
            {
                completedTaskNames,
                taskResults
            }
        );

        logger.info(
            {
                workflowId: workflow.id,
                taskCount: taskRows.length,
                priority,
                entryPointIds: plan.entryPointIds
            },
            'Workflow runtime state rebuilt from database rows'
        );

        return plan;
    }

    static async cleanupRuntime(taskIds: string[]) {
        if (taskIds.length === 0) return;

        logger.info({ taskIds }, 'Cleaning up workflow runtime keys');

        const multi = redisClient.multi();
        for (const taskId of taskIds) {
            multi.del(this.taskDefKey(taskId));
            multi.del(this.taskCounterKey(taskId));
            multi.del(this.taskDescendantsKey(taskId));
            multi.del(this.taskResultKey(taskId));
            multi.del(this.taskReleasedKey(taskId));
        }
        await multi.exec();
    }

    static async getRuntimeTask(taskId: string): Promise<RuntimeWorkflowTask> {
        const taskDefStr = await redisClient.get(this.taskDefKey(taskId));
        if (!taskDefStr) {
            throw new Error(`Task definition not found for task ID ${taskId}`);
        }
        return JSON.parse(taskDefStr) as RuntimeWorkflowTask;
    }

    static async claimDescendantRelease(taskId: string): Promise<boolean> {
        return (await redisClient.set(this.taskReleasedKey(taskId), '1', 'NX')) === 'OK';
    }

    static async getDescendantIds(taskId: string): Promise<string[]> {
        const descendantIdsStr = await redisClient.get(this.taskDescendantsKey(taskId));
        if (!descendantIdsStr) return [];
        return JSON.parse(descendantIdsStr) as string[];
    }

    static async decrementFatherCounter(taskId: string): Promise<number> {
        const remaining = await redisClient.decr(this.taskCounterKey(taskId));
        if (remaining < 0) await redisClient.set(this.taskCounterKey(taskId), '0');
        return remaining;
    }

    private static buildDescendants(
        definition: WorkflowDefinition,
        taskIds: Record<string, string>
    ): Record<string, string[]> {
        const descendants: Record<string, string[]> = {};
        for (const task of definition.tasks) {
            descendants[this.requireTaskId(taskIds, task.name)] = [];
        }
        for (const task of definition.tasks) {
            for (const fatherName of task.fathers || []) {
                descendants[this.requireTaskId(taskIds, fatherName)].push(
                    this.requireTaskId(taskIds, task.name)
                );
            }
        }
        return descendants;
    }

    private static toRuntimeTask(
        task: TaskDefinition,
        workflowId: string,
        taskIds: Record<string, string>,
        priority: number
    ): RuntimeWorkflowTask {
        const taskId = this.requireTaskId(taskIds, task.name);
        const fathers = task.fathers || [];
        const fatherIds = Object.fromEntries(
            fathers.map(fatherName => [fatherName, this.requireTaskId(taskIds, fatherName)])
        );

        return {
            ...task.data,
            id: taskId,
            type: task.data?.type as TaskType,
            payload: task.data?.payload,
            workflowId,
            taskName: task.name,
            track: task.track === true,
            report: task.report === true,
            fathers,
            fatherIds,
            priority
        };
    }

    private static getResultKeys(value: unknown) {
        if (!value || typeof value !== 'object') return [];
        return Object.keys(value);
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

    private static unwrapStoredResult(value: unknown) {
        if (value && typeof value === 'object' && '__result' in value) return value.__result;
        if (value && typeof value === 'object' && 'result' in value && 'name' in value) {
            return value.result;
        }
        return value;
    }

    private static requireTaskId(taskIds: Record<string, string>, taskName: string) {
        const taskId = taskIds[taskName];
        if (!taskId) throw new Error(`Task ID missing for workflow task ${taskName}`);
        return taskId;
    }

    private static taskDefKey(taskId: string) {
        return `workflow:task:def:${taskId}`;
    }

    private static taskCounterKey(taskId: string) {
        return `workflow:task:counter:${taskId}`;
    }

    private static taskDescendantsKey(taskId: string) {
        return `workflow:task:descendants:${taskId}`;
    }

    private static taskResultKey(taskId: string) {
        return `workflow:task:result:${taskId}`;
    }

    private static taskReleasedKey(taskId: string) {
        return `workflow:task:released:${taskId}`;
    }
}
