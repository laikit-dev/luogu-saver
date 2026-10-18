import Router from 'koa-router';
import type { Context, DefaultState } from 'koa';
import { requiresPermission } from '@/middlewares/authorization';
import { LibraryService } from '@/services/library.service';
import { UserTimelineService } from '@/services/user-timeline.service';
import { Permission } from '@/shared/permission';
import { parseArchiveUid, parseTimelineQuery } from '@/utils/archive-query';

const router = new Router<DefaultState, Context>({ prefix: '/library' });

router.get('/follows', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.listFollows(ctx.user.id, ctx.query.page, ctx.query.pageSize));
});

router.get('/follows/:uid', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.getFollowState(ctx.user.id, parseArchiveUid(ctx.params.uid)));
});

router.put('/follows/:uid', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.follow(ctx.user.id, parseArchiveUid(ctx.params.uid)));
});

router.delete('/follows/:uid', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.unfollow(ctx.user.id, parseArchiveUid(ctx.params.uid)));
});

router.get('/saved', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(
        await LibraryService.listSavedArticles(ctx.user.id, ctx.query.page, ctx.query.pageSize)
    );
});

router.get('/saved/:articleId', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.getSavedState(ctx.user.id, ctx.params.articleId));
});

router.put('/saved/:articleId', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.saveArticle(ctx.user.id, ctx.params.articleId));
});

router.delete('/saved/:articleId', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.removeSavedArticle(ctx.user.id, ctx.params.articleId));
});

router.get('/feed', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await UserTimelineService.listForOwner(ctx.user.id, parseTimelineQuery(ctx.query)));
});

router.get('/digest', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    ctx.success(await LibraryService.getDigestPreference(ctx.user.id));
});

router.post('/digest', requiresPermission(Permission.LOGIN), async (ctx: Context) => {
    const { enabled } = (ctx.request.body || {}) as { enabled?: unknown };
    ctx.success(await LibraryService.setDigestPreference(ctx.user.id, enabled));
});

export default router;
