import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { UserService } from '@/services/user.service';
import { UserProfileHistoryService } from '@/services/user-profile-history.service';
import { TaskService } from '@/services/task.service';
import { TaskType, SaveTarget } from '@/shared/task';
import { logger } from '@/lib/logger';
import { requiresPermission } from '@/middlewares/authorization';
import { Permission } from '@/shared/permission';
import { parseArchiveUid } from '@/utils/archive-query';

const router = new Router<DefaultState, Context>({ prefix: '/user' });

function parseUid(raw: string): number | null {
    try {
        return parseArchiveUid(raw);
    } catch {
        return null;
    }
}

function parseOwnedUid(ctx: Context): number | null {
    const uid = parseUid(ctx.params.id);
    if (uid === null) {
        ctx.fail(400, 'Invalid user ID');
        return null;
    }
    if (ctx.user.luoguUid !== uid) {
        ctx.fail(403, 'Permission denied');
        return null;
    }
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
        const profileRefreshTaskId = stale ? await dispatchProfileRefresh(uid) : null;
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
            profileRefreshTaskId,
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

router.get('/history/:id/settings', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    const uid = parseOwnedUid(ctx);
    if (uid === null) return;
    try {
        const settings = await UserProfileHistoryService.getSettings(uid);
        if (!settings) {
            ctx.fail(404, 'User not found');
            return;
        }
        ctx.success(settings);
    } catch (error) {
        logger.error({ error, uid }, 'Failed to retrieve profile history settings');
        ctx.fail(500, 'Failed to retrieve profile history settings');
    }
});

router.post('/history/:id/settings', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    const uid = parseOwnedUid(ctx);
    if (uid === null) return;
    const body = ctx.request.body as { recordingEnabled?: unknown } | null | undefined;
    if (!body || typeof body.recordingEnabled !== 'boolean') {
        ctx.fail(400, 'recordingEnabled must be a boolean');
        return;
    }
    try {
        const settings = await UserProfileHistoryService.setRecordingEnabled(
            uid,
            body.recordingEnabled
        );
        if (!settings) {
            ctx.fail(404, 'User not found');
            return;
        }
        ctx.success(settings);
    } catch (error) {
        logger.error({ error, uid }, 'Failed to update profile history settings');
        ctx.fail(500, 'Failed to update profile history settings');
    }
});

router.post('/history/:id/clear', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    const uid = parseOwnedUid(ctx);
    if (uid === null) return;
    try {
        const result = await UserProfileHistoryService.clearHistory(uid);
        if (!result) {
            ctx.fail(404, 'User not found');
            return;
        }
        ctx.success(result);
    } catch (error) {
        logger.error({ error, uid }, 'Failed to clear profile history');
        ctx.fail(500, 'Failed to clear profile history');
    }
});

router.get('/history/:id', async (ctx: Context) => {
    const uid = parseUid(ctx.params.id);
    if (uid === null) {
        ctx.fail(400, 'Invalid user ID');
        return;
    }
    try {
        const history = await UserProfileHistoryService.listVersions(uid);
        if (!history) {
            ctx.fail(404, 'User not found');
            return;
        }
        ctx.success(history);
    } catch (error) {
        logger.error({ error, uid }, 'Failed to retrieve profile history');
        ctx.fail(500, 'Failed to retrieve profile history');
    }
});

router.get('/history/:id/:version', async (ctx: Context) => {
    const uid = parseUid(ctx.params.id);
    const version = parseUid(ctx.params.version);
    if (uid === null || version === null) {
        ctx.fail(400, 'Invalid user ID or profile version');
        return;
    }
    try {
        const history = await UserProfileHistoryService.getVersion(uid, version);
        if (!history) {
            ctx.fail(404, 'Profile version not found');
            return;
        }
        ctx.success(history);
    } catch (error) {
        logger.error({ error, uid, version }, 'Failed to retrieve profile version');
        ctx.fail(500, 'Failed to retrieve profile version');
    }
});

export default router;
