import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { JudgementService } from '@/services/judgement.service';
import { requiresPermission } from '@/middlewares/authorization';
import { Permission } from '@/shared/permission';
import { RegisteredUserService } from '@/services/registered-user.service';
import {
    JudgementQueryError,
    parseJudgementPagination,
    parseJudgementQuery
} from '@/shared/judgement';

const router = new Router<DefaultState, Context>({ prefix: '/judgement' });

router.get('/', async (ctx: Context) => {
    try {
        ctx.success(await JudgementService.list(parseJudgementQuery(ctx.query)));
    } catch (error) {
        if (!(error instanceof JudgementQueryError)) throw error;
        ctx.fail(error.status, error.message);
    }
});

router.get('/logs', async (ctx: Context) => {
    try {
        ctx.success(await JudgementService.listLogs(parseJudgementPagination(ctx.query)));
    } catch (error) {
        if (!(error instanceof JudgementQueryError)) throw error;
        ctx.fail(error.status, error.message);
    }
});

router.get('/stats', async (ctx: Context) => {
    ctx.success(await JudgementService.stats());
});

router.post('/hide-mine', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    const registeredUser = await RegisteredUserService.getById(ctx.user.id);
    if (!registeredUser) {
        ctx.fail(401, 'Unauthorized');
        return;
    }
    ctx.success(await JudgementService.hideHistory(registeredUser.luoguUid));
});

export default router;
