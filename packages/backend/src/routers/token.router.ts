import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { isValidUserRole, normalizeUserRole, UserRole } from '@/shared/permission';
import { VerificationService } from '@/services/verification.service';
import { requiresRole } from '@/middlewares/authorization';
import { RegisteredUser } from '@/entities/registered-user';
import { RegisteredUserService } from '@/services/registered-user.service';

const router = new Router<DefaultState, Context>({ prefix: '/token' });

router.post('/verify', async (ctx: Context) => {
    const { uid } = ctx.request.body as any;

    if (!uid) {
        ctx.fail(400, 'UID is required');
        return;
    }

    const result = await VerificationService.prepareForLuogu(uid);
    ctx.success(result);
});

router.post('/create', async (ctx: Context) => {
    ctx.fail(410, 'Token creation has moved to CP OAuth login');
});

router.post('/permission', requiresRole(UserRole.ADMIN), async (ctx: Context) => {
    const { uid, role } = ctx.request.body as { uid?: unknown; role?: unknown };
    const parsedUid = Number(uid);

    if (!Number.isInteger(parsedUid) || parsedUid <= 0 || !isValidUserRole(role)) {
        ctx.fail(400, 'Valid uid and role are required');
        return;
    }

    if (parsedUid === ctx.user.id) {
        ctx.fail(400, 'Cannot change your own role');
        return;
    }

    try {
        const registeredUser = await RegisteredUser.findOne({ where: { id: parsedUid } });
        if (!registeredUser) {
            ctx.fail(404, 'Registered user not found');
            return;
        }

        await RegisteredUserService.updateRole(parsedUid, role);
        ctx.success({ uid: parsedUid, role });
    } catch (error) {
        ctx.fail(500, error instanceof Error ? error.message : 'Unknown error');
    }
});

router.get('/inspect', requiresRole(UserRole.USER), async (ctx: Context) => {
    try {
        const registeredUser = await RegisteredUser.findOne({ where: { id: ctx.user.id } });
        if (!registeredUser) {
            ctx.fail(404, 'Registered user not found');
            return;
        }
        ctx.success({
            uid: registeredUser.id,
            role: normalizeUserRole(registeredUser.role),
            createdAt: registeredUser.createdAt
        });
    } catch (error) {
        ctx.fail(500, error instanceof Error ? error.message : 'Unknown error');
    }
});

export default router;
