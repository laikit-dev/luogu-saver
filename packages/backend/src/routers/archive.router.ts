import Router from 'koa-router';
import type { Context, DefaultState } from 'koa';
import { ArticleHistoryService } from '@/services/article-history.service';
import { UserTimelineService } from '@/services/user-timeline.service';
import { UserRssService } from '@/services/user-rss.service';
import {
    parseArchiveArticleId,
    parseArchiveUid,
    parseArchiveVersion,
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

router.get('/user/:uid/rss', async (ctx: Context) => {
    try {
        const uid = parseArchiveUid(ctx.params.uid);
        const { kinds } = parseTimelineQuery({ kinds: ctx.query.kinds, limit: 50 });
        const feed = await UserRssService.buildForUser(uid, kinds);
        ctx.set('Content-Type', 'application/rss+xml; charset=utf-8');
        ctx.set('Cache-Control', 'no-cache');
        ctx.set('ETag', feed.etag);
        if (UserRssService.matchesEtag(ctx.get('If-None-Match'), feed.etag)) {
            ctx.status = 304;
            return;
        }
        ctx.status = 200;
        ctx.body = feed.xml;
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to retrieve archive RSS');
    }
});

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

router.get('/article/:id/versions', async (ctx: Context) => {
    try {
        const articleId = parseArchiveArticleId(ctx.params.id);
        const result = await ArticleHistoryService.listVersionMetadata(articleId);
        if (!result) {
            ctx.fail(404, 'Article not found');
            return;
        }
        ctx.success(result);
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to retrieve article versions');
    }
});

router.get('/article/:id/compare', async (ctx: Context) => {
    try {
        const articleId = parseArchiveArticleId(ctx.params.id);
        const from = parseArchiveVersion(ctx.query.from);
        const to = parseArchiveVersion(ctx.query.to);
        const comparison = await ArticleHistoryService.compareVersions(articleId, from, to);
        if (!comparison) {
            ctx.fail(404, 'Article or version not found');
            return;
        }
        ctx.success(comparison);
    } catch (error) {
        failArchiveRead(ctx, error, 'Failed to compare article versions');
    }
});

export default router;
