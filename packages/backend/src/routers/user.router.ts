import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { UserService } from '@/services/user.service';
import { TaskService } from '@/services/task.service';
import { TaskType, SaveTarget } from '@/shared/task';
import { logger } from '@/lib/logger';

const router = new Router<DefaultState, Context>({ prefix: '/user' });

function parseUid(raw: string): number | null {
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const uid = Number(raw);
    if (!Number.isInteger(uid) || uid <= 0) return null;
    return uid;
}

async function dispatchProfileRefresh(uid: number): Promise<string | null> {
    try {
        const task = await TaskService.createTask(TaskType.SAVE, {
            target: SaveTarget.PROFILE,
            targetId: String(uid),
            metadata: {}
        });
        await TaskService.dispatchTask(task.id);
        return task.id;
    } catch (error) {
        logger.error({ error, uid }, 'Failed to dispatch profile refresh task');
        return null;
    }
}

router.get('/query/:id', async (ctx: Context) => {
    const uid = parseUid(ctx.params.id);
    if (uid === null) {
        ctx.fail(400, 'Invalid user ID');
        return;
    }
    try {
        const user = await UserService.getUserById(uid);
        if (!user) {
            ctx.fail(404, 'User not found');
            return;
        }
        const stale = UserService.isProfileStale(user);
        if (stale) {
            // fire-and-forget; response should not wait
            void dispatchProfileRefresh(uid);
        }
        ctx.success({
            id: user.id,
            name: user.name,
            color: user.color,
            ccfLevel: user.ccfLevel,
            xcpcLevel: user.xcpcLevel,
            slogan: user.slogan,
            introduction: user.introduction,
            prizes: user.prizes,
            profileFetchedAt: user.profileFetchedAt,
            profileStale: stale,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        });
    } catch (error) {
        logger.error({ error, uid }, 'Failed to retrieve user');
        ctx.fail(500, 'Failed to retrieve user');
    }
});

router.post('/:id/refresh', async (ctx: Context) => {
    const uid = parseUid(ctx.params.id);
    if (uid === null) {
        ctx.fail(400, 'Invalid user ID');
        return;
    }
    const taskId = await dispatchProfileRefresh(uid);
    if (!taskId) {
        ctx.fail(500, 'Failed to dispatch profile refresh');
        return;
    }
    ctx.success({ taskId });
});

export default router;
