import { Task } from '@/entities/task';
import { TaskStatus, TaskType } from '@/shared/task';
import { getQueueByType } from '@/lib/queue-factory';
import { getRandomString } from '@/utils/string';
import { retryOnDuplicateKey } from '@/utils/db-errors';
import { EntityManager, In, Not } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { normalizeErrorReason } from '@/utils/error-reason';
import { ContentRefreshStateService } from '@/services/content-refresh-state.service';

export class TaskService {
    static async createTask(type: TaskType, payload: any, manager?: EntityManager): Promise<Task> {
        return retryOnDuplicateKey(async () => {
            const task = getServiceRepository<Task>(Task, manager).create();

            task.id = getRandomString(8);
            task.type = type;
            task.payload = payload;
            task.status = TaskStatus.PENDING;
            await getServiceRepository<Task>(Task, manager).save(task);
            return task;
        }, 5);
    }

    static async dispatchTask(taskId: string) {
        const task = await this.getTaskById(taskId);
        if (!task) throw new Error(`Task with ID ${taskId} not found.`);
        const queue = getQueueByType(task.type);
        if (!queue) throw new Error(`No queue found for task type ${task.type}`);

        await queue.add(
            task.type,
            {
                id: task.id,
                type: task.type,
                payload: task.payload
            },
            { jobId: task.id }
        );
        ContentRefreshStateService.markActive(task.id, task.type, task.payload);
    }

    static async updateTask(
        taskId: string,
        status: TaskStatus,
        info?: string,
        manager?: EntityManager,
        result?: any
    ) {
        const updateData: Partial<Task> = { status };
        if (info !== undefined) {
            updateData.info = status === TaskStatus.FAILED ? normalizeErrorReason(info) : info;
        }
        if (result !== undefined) {
            updateData.result = result;
        }

        const criteria =
            status === TaskStatus.PROCESSING
                ? { id: taskId, status: Not(In([TaskStatus.COMPLETED, TaskStatus.FAILED])) }
                : taskId;
        await getServiceRepository<Task>(Task, manager).update(criteria, updateData);
    }

    static async completeTask(taskId: string, info: string, result?: any): Promise<boolean> {
        const updateData: Partial<Task> = {
            status: TaskStatus.COMPLETED,
            info
        };
        if (result !== undefined) updateData.result = result;

        const updateResult = await getServiceRepository<Task>(Task).update(
            { id: taskId, status: Not(In([TaskStatus.COMPLETED, TaskStatus.FAILED])) },
            updateData
        );
        return Boolean(updateResult.affected && updateResult.affected > 0);
    }

    static async failTask(taskId: string, info: string): Promise<boolean> {
        const normalizedInfo = normalizeErrorReason(info);
        const updateResult = await getServiceRepository<Task>(Task).update(
            { id: taskId, status: Not(In([TaskStatus.COMPLETED, TaskStatus.FAILED])) },
            {
                status: TaskStatus.FAILED,
                info: normalizedInfo
            }
        );
        return Boolean(updateResult.affected && updateResult.affected > 0);
    }

    static async getTaskById(taskId: string, manager?: EntityManager): Promise<Task | null> {
        const task = await getServiceRepository<Task>(Task, manager).findOne({
            where: { id: taskId }
        });
        if (task?.status === TaskStatus.FAILED && task.info) {
            task.info = normalizeErrorReason(task.info);
        }
        return task;
    }
}
