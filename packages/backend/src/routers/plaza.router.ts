import Router from 'koa-router';
import { Context, DefaultState } from 'koa';

const router = new Router<DefaultState, Context>({ prefix: '/plaza' });

import { RecommendationService } from '@/services/recommendation.service';
import { getConsentedDeviceId, resolveRecommendationSubject } from '@/middlewares/tracking';

const MAX_EXCLUDED_ARTICLES = 200;

function parseExcludedArticles(exclude: unknown): string[] {
    const rawExclude = Array.isArray(exclude) ? exclude.join(',') : exclude;
    if (typeof rawExclude !== 'string') return [];

    const seen = new Set<string>();
    const excludedArticles: string[] = [];

    for (const articleId of rawExclude.split(',')) {
        const trimmedId = articleId.trim();
        if (!trimmedId || seen.has(trimmedId)) continue;

        seen.add(trimmedId);
        excludedArticles.push(trimmedId);
        if (excludedArticles.length >= MAX_EXCLUDED_ARTICLES) break;
    }

    return excludedArticles;
}

router.get('/get', async (ctx: Context) => {
    const parsedCount = Number.parseInt(ctx.query.count as string, 10);
    const count = Math.min(50, Math.max(1, Number.isFinite(parsedCount) ? parsedCount : 10));
    const excludedArticles = parseExcludedArticles(ctx.query.exclude);
    const subject = resolveRecommendationSubject(ctx);
    if (!subject) {
        ctx.success(await RecommendationService.getPublicRecommendations(count, excludedArticles));
        return;
    }
    if (subject.kind === 'user') {
        // OAuth callbacks are top-level redirects without tracking headers, so the device history
        // is merged on the first consented plaza request that carries both identities.
        const deviceId = getConsentedDeviceId(ctx);
        if (deviceId) await RecommendationService.mergeDeviceHistory(deviceId, subject.userId);
    }
    ctx.success(
        await RecommendationService.getPersonalizedRecommendations(subject, count, excludedArticles)
    );
});

export default router;
