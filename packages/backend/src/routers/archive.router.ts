import Router from 'koa-router';
import type { Context, DefaultState } from 'koa';
import { UserTimelineService } from '@/services/user-timeline.service';
import {
    parseArchiveUid,
    parseAuthorArticlesQuery,
    parseTimelineQuery
} from '@/utils/archive-query';
import { logger } from '@/lib/logger';

const router = new Router<DefaultState, Context>({ prefix: '/archive' });

function failArchiveRead(ctx: Context, error: unknown, message: string): void {
    if (error instanceof Error && 'status' in error && error.status === 400) {
        ctx.fail(400, error.message);
        return;
    }
    logger.error({ error }, message);
    ctx.fail(500, message);
}

router.get('/user/:uid/timeline', async (ctx: Context) => {
    try {
        const uid = parseArchiveUid(ctx.params.uid);
        const query = parseTimelineQuery(ctx.query);
        ctx.success(await UserTimelineService.listForUser(uid, query));
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to retrieve archive timeline');
    }
});

router.get('/user/:uid/stats', async (ctx: Context) => {
    try {
        const uid = parseArchiveUid(ctx.params.uid);
        ctx.success(await UserTimelineService.statsForUser(uid));
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to retrieve archive statistics');
    }
});

router.get('/user/:uid/articles', async (ctx: Context) => {
    try {
        const uid = parseArchiveUid(ctx.params.uid);
        const query = parseAuthorArticlesQuery(ctx.query);
        ctx.success(await UserTimelineService.articlesForUser(uid, query));
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to retrieve author articles');
    }
});

export default router;
