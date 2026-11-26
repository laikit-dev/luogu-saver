import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { requiresRole } from '@/middlewares/authorization';
import { UserRole } from '@/shared/permission';
import { DeletionRequestService } from '@/services/deletion-request.service';

const router = new Router<DefaultState, Context>({ prefix: '/deletion-request' });

router.post('/', requiresRole(UserRole.USER), async (ctx: Context) => {
    const request = await DeletionRequestService.createRequest(ctx.user.id, ctx.request.body || {});
    ctx.success(request);
});

router.get('/mine', requiresRole(UserRole.USER), async (ctx: Context) => {
    const result = await DeletionRequestService.listMyRequests(
        ctx.user.id,
        ctx.query.page,
        ctx.query.pageSize
    );
    ctx.success(result);
});

export default router;
