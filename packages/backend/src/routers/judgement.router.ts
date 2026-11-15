import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { JudgementService } from '@/services/judgement.service';
import {
    JudgementQueryError,
    parseJudgementPagination,
    parseJudgementQuery
} from '@/utils/judgement';

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

export default router;
