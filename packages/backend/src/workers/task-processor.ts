import type { CommonTask, TaskHandler } from '@/workers/types';
import { logger } from '@/lib/logger';
import { WorkflowRuntimeStore } from '@/services/helpers/workflow-runtime-store.helper';
import { Job, UnrecoverableError } from 'bullmq';
import { normalizeErrorReason } from '@/utils/error-reason';

export class TaskProcessor<T extends CommonTask> {
    private taskHandlers = new Map<string, TaskHandler<T>>();

    registerHandler(handler: TaskHandler<T>) {
        this.taskHandlers.set(handler.taskType, handler);
    }

    process = async (job: Job<T>) => {
        const task = job.data as any;
        logger.debug(
            {
                jobId: job.id,
                jobName: job.name,
                workflowId: task.workflowId,
                taskName: task.taskName,
                type: task.type,
                target: task.payload?.target,
                fathers: task.fathers || []
            },
            'Task processor received job'
        );

        await job.updateProgress('Fetching handler');
        const typeName = task.payload.target ? `${task.type}:${task.payload.target}` : task.type;
        const handler = this.taskHandlers.get(typeName);
        if (!handler) {
            throw new UnrecoverableError(`No handler registered for task type: ${typeName}`);
        }

        if (task.workflowId) {
            job.getChildrenValues = async <CT>() => {
                const fatherResults = await WorkflowRuntimeStore.getFatherResults(task);
                // BullMQ lets each handler choose the type of its stored upstream results.
                return fatherResults as unknown as Record<string, CT>;
            };
            logger.debug(
                {
                    jobId: job.id,
                    workflowId: task.workflowId,
                    taskName: task.taskName,
                    fatherNames: task.fathers || []
                },
                'Task processor configured workflow upstream result loader'
            );
        }

        logger.debug(
            {
                jobId: job.id,
                workflowId: task.workflowId,
                taskName: task.taskName,
                handlerKey: typeName
            },
            'Task processor resolved handler'
        );

        await job.updateProgress('Sending to handler');
        let result: any;
        try {
            result = await handler.handle(task, job);
        } catch (error) {
            const reason = normalizeErrorReason(error);
            if (error instanceof UnrecoverableError) throw new UnrecoverableError(reason);
            throw new Error(reason);
        }

        logger.debug(
            {
                jobId: job.id,
                workflowId: task.workflowId,
                taskName: task.taskName,
                handlerKey: typeName,
                resultKeys: this.getResultKeys(result)
            },
            'Task processor handler completed'
        );

        return {
            __result: result,
            __name: job.name
        };
    };

    private getResultKeys(result: any) {
        if (!result || typeof result !== 'object') return [];
        return Object.keys(result);
    }
}
