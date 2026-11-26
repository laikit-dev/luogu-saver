import Router from 'koa-router';
import { Context, DefaultState } from 'koa';

const router = new Router<DefaultState, Context>({ prefix: '/plaza' });

import { RecommendationService } from '@/services/recommendation.service';
import { createDisabledInterestProfile } from '@/services/recommendation-profile';
import { getConsentedDeviceId, resolveRecommendationSubject } from '@/middlewares/tracking';
import { logger } from '@/lib/logger';

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
    try {
        const parsedCount = Number.parseInt(ctx.query.count as string, 10);
        const count = Math.min(50, Math.max(1, Number.isFinite(parsedCount) ? parsedCount : 10));
        const excludedArticles = parseExcludedArticles(ctx.query.exclude);
        const subject = resolveRecommendationSubject(ctx);
        if (!subject) {
            ctx.success(
                await RecommendationService.getPublicRecommendations(count, excludedArticles)
            );
            return;
        }
        if (subject.kind === 'user') {
            // OAuth callbacks are top-level redirects without tracking headers, so the device history
            // is merged on the first consented plaza request that carries both identities.
            const deviceId = getConsentedDeviceId(ctx);
            if (deviceId) await RecommendationService.mergeDeviceHistory(deviceId, subject.userId);
        }
        ctx.success(
            await RecommendationService.getPersonalizedRecommendations(
                subject,
                count,
                excludedArticles
            )
        );
    } catch (error) {
        logger.error({ error }, 'Failed to retrieve recommendations');
        ctx.fail(500, 'Failed to retrieve recommendations');
    }
});

router.get('/profile', async (ctx: Context) => {
    try {
        const subject = resolveRecommendationSubject(ctx);
        if (!subject) {
            ctx.success(createDisabledInterestProfile());
            return;
        }
        if (subject.kind === 'user') {
            const deviceId = getConsentedDeviceId(ctx);
            if (deviceId) await RecommendationService.mergeDeviceHistory(deviceId, subject.userId);
        }
        ctx.success(await RecommendationService.getInterestProfileSummary(subject));
    } catch (error) {
        logger.error({ error }, 'Failed to retrieve interest profile');
        ctx.fail(500, 'Failed to retrieve interest profile');
    }
});

router.delete('/profile', async (ctx: Context) => {
    try {
        const subject = resolveRecommendationSubject(ctx);
        if (!subject) {
            ctx.success({ cleared: false });
            return;
        }
        if (subject.kind === 'user') {
            const deviceId = getConsentedDeviceId(ctx);
            if (deviceId) await RecommendationService.mergeDeviceHistory(deviceId, subject.userId);
        }
        await RecommendationService.clearSubjectHistory(subject);
        ctx.success({ cleared: true });
    } catch (error) {
        logger.error({ error }, 'Failed to clear interest profile');
        ctx.fail(500, 'Failed to clear interest profile');
    }
});

export default router;
