import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { TaskService } from '@/services/task.service';
import { logger } from '@/lib/logger';
import { TaskType } from '@/shared/task';
import { requiresRole } from '@/middlewares/authorization';
import { UserRole } from '@/shared/permission';
import { sanitizePublicTaskResult } from '@/utils/task-result-sanitizer';

const router = new Router<DefaultState, Context>({ prefix: '/task' });

router.post('/create', requiresRole(UserRole.ADMIN), async (ctx: Context) => {
    const { type, payload } = ctx.request.body as {
        type?: TaskType;
        payload?: any;
    };
    const target = payload.target;
    if (typeof type !== 'string' || typeof target !== 'string' || typeof payload !== 'object') {
        ctx.fail(400, 'Invalid request body');
        return;
    }
    if (!type || !target || !payload) {
        ctx.fail(400, 'Type and payload are required');
        return;
    }
    if (!Object.values(TaskType).includes(type as TaskType)) {
        ctx.fail(400, 'Invalid task type');
        return;
    }
    try {
        const task = await TaskService.createTask(type, payload);
        await TaskService.dispatchTask(task.id);
        ctx.success({ taskId: task.id });
    } catch (error) {
        logger.error({ error }, 'Failed to create task');
        ctx.fail(500, 'Failed to create task');
    }
});

router.get('/query/:id', async (ctx: Context) => {
    const taskId = ctx.params.id;
    try {
        const task = await TaskService.getTaskById(taskId);
        if (!task) {
            ctx.fail(404, 'Task not found');
            return;
        }
        ctx.success({
            ...task,
            result: sanitizePublicTaskResult(task.result)
        });
    } catch (error) {
        logger.error({ error }, 'Failed to get task status');
        ctx.fail(500, 'Failed to get task status');
    }
});

export default router;
