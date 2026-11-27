import Router from 'koa-router';
import { Context, DefaultState } from 'koa';

const router = new Router<DefaultState, Context>({ prefix: '/article' });

import { ArticleService } from '@/services/article.service';
import { truncateUtf8 } from '@/utils/string';
import { TrackingEvent } from '@/shared/event';
import { RecommendationService } from '@/services/recommendation.service';
import { ArticleHistoryService } from '@/services/article-history.service';
import { CommentService, parseCommentsQuery } from '@/services/comment.service';
import { TaskService } from '@/services/task.service';
import { TaskType, SaveTarget } from '@/shared/task';
import { logger } from '@/lib/logger';
import type { Article } from '@/entities/article';
import { hasRole, UserRole } from '@/shared/permission';

async function getViewableArticle(
    ctx: Context,
    articleId: string,
    allowDeletedForAdmin: boolean = false
): Promise<Article | null> {
    const article = await ArticleService.getArticleByIdWithoutCache(articleId);
    if (!article) {
        ctx.fail(404, 'Article not found');
        return null;
    }
    if (article.deleted && !(allowDeletedForAdmin && hasRole(ctx.user?.role, UserRole.MODERATOR))) {
        ctx.fail(403, article.deleteReason || 'Article has been deleted');
        return null;
    }
    return article;
}

async function dispatchCommentsRefresh(lid: string): Promise<string | null> {
    try {
        const task = await TaskService.createTask(TaskType.SAVE, {
            target: SaveTarget.COMMENTS,
            targetId: lid,
            metadata: {}
        });
        await TaskService.dispatchTask(task.id);
        return task.id;
    } catch (error) {
        logger.error({ error, lid }, 'Failed to dispatch comments refresh task');
        return null;
    }
}

router.get('/query/:id', async (ctx: Context) => {
    try {
        const articleId = ctx.params.id;
        const article = await getViewableArticle(ctx, articleId, true);
        if (!article) return;
        if (!article.deleted) {
            if (ctx.track) void ctx.track(TrackingEvent.VIEW_ARTICLE, articleId);
            void ArticleService.incrementViewCount(articleId);
        }
        ctx.success(article);
    } catch (error) {
        logger.error({ error, articleId: ctx.params.id }, 'Failed to retrieve article');
        ctx.fail(500, 'Failed to retrieve article');
    }
});

router.get('/relevant/:id', async (ctx: Context) => {
    try {
        const article = await getViewableArticle(ctx, ctx.params.id);
        if (!article) return;

        ctx.success(await RecommendationService.getRelevantArticle(ctx.params.id, 5, article));
    } catch (error) {
        logger.error({ error, articleId: ctx.params.id }, 'Failed to retrieve relevant articles');
        ctx.fail(500, 'Failed to retrieve relevant articles');
    }
});

router.get('/history/:id', async (ctx: Context) => {
    try {
        if (!(await getViewableArticle(ctx, ctx.params.id))) return;

        const history = await ArticleHistoryService.getHistoryByArticleId(ctx.params.id);
        ctx.success(history);
    } catch (error) {
        logger.error({ error, articleId: ctx.params.id }, 'Failed to retrieve article history');
        ctx.fail(500, 'Failed to retrieve article history');
    }
});

router.get('/recent', async (ctx: Context) => {
    try {
        const count = Math.min(100, Number(ctx.query.count) || 20);
        const updatedAfterStr = ctx.query.updated_after as string | undefined;
        const updatedAfter = updatedAfterStr ? new Date(updatedAfterStr) : undefined;
        const truncatedCount = Math.min(Number(ctx.query.truncated_count) || 200, 600);

        const articles = await ArticleService.getRecentArticles(count, updatedAfter);
        const sanitizedArticles = articles.map(article => ({
            ...article,
            content: article.content ? truncateUtf8(article.content, truncatedCount) : undefined
        }));
        ctx.success(sanitizedArticles);
    } catch (error) {
        logger.error({ error }, 'Failed to retrieve recent articles');
        ctx.fail(500, 'Failed to retrieve recent articles');
    }
});

router.get('/count', async (ctx: Context) => {
    try {
        const count = await ArticleService.getArticleCount();
        ctx.success({ count });
    } catch (error) {
        logger.error({ error }, 'Failed to retrieve article count');
        ctx.fail(500, 'Failed to retrieve article count');
    }
});

router.get('/comments/:id', async (ctx: Context) => {
    const lid = ctx.params.id;
    if (!/^[A-Za-z0-9]{1,8}$/.test(lid)) {
        ctx.fail(400, 'Invalid article ID');
        return;
    }

    let query;
    try {
        query = parseCommentsQuery(ctx.query as Record<string, unknown>);
    } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 400) {
            ctx.fail(400, (error as Error).message);
            return;
        }
        throw error;
    }

    try {
        const article = await getViewableArticle(ctx, lid);
        if (!article) return;

        const stale = CommentService.isCommentsStale(article);
        const { comments, nextCursor } = await CommentService.getCommentsPageByArticle(lid, query);
        ctx.success({
            comments: comments.map(c => ({
                id: String(c.id),
                content: c.content,
                time: Number(c.time),
                author: c.author
                    ? {
                          id: c.author.id,
                          name: c.author.name,
                          color: c.author.color,
                          ccfLevel: c.author.ccfLevel,
                          xcpcLevel: c.author.xcpcLevel,
                          badge: c.author.badge ?? null
                      }
                    : { id: c.authorId }
            })),
            nextCursor,
            commentsStale: stale,
            commentsFetchedAt: article.commentsFetchedAt ?? null
        });
    } catch (error) {
        logger.error({ error, lid }, 'Failed to retrieve comments');
        ctx.fail(500, 'Failed to retrieve comments');
    }
});

router.post('/comments/:id/refresh', async (ctx: Context) => {
    const lid = ctx.params.id;
    if (!/^[A-Za-z0-9]{1,8}$/.test(lid)) {
        ctx.fail(400, 'Invalid article ID');
        return;
    }
    try {
        if (!(await getViewableArticle(ctx, lid))) return;

        const taskId = await dispatchCommentsRefresh(lid);
        if (!taskId) {
            ctx.fail(500, 'Failed to dispatch comments refresh');
            return;
        }
        ctx.success({ taskId });
    } catch (error) {
        logger.error({ error, lid }, 'Failed to refresh comments');
        ctx.fail(500, 'Failed to dispatch comments refresh');
    }
});

export default router;
