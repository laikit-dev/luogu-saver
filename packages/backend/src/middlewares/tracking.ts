import { Context, Next } from 'koa';
import { TrackingEvent } from '@/shared/event';
import {
    RecommendationService,
    type RecommendationSubject
} from '@/services/recommendation.service';

/** Returns `X-Device-Id` only when tracking consent is given and the ID is non-empty. */
export function getConsentedDeviceId(ctx: Context): string | null {
    if (ctx.headers['x-consent-tracking'] !== 'true') return null;
    const deviceId = ctx.headers['x-device-id'];
    return typeof deviceId === 'string' && deviceId ? deviceId : null;
}

/**
 * Selects whose behavior a request reads and writes for recommendations.
 * An authenticated user takes precedence over the device; `null` means no personalization.
 */
export function resolveRecommendationSubject(ctx: Context): RecommendationSubject | null {
    if (ctx.headers['x-consent-tracking'] !== 'true') return null;
    if (ctx.user?.id !== undefined) return { kind: 'user', userId: ctx.user.id };
    const deviceId = getConsentedDeviceId(ctx);
    return deviceId ? { kind: 'device', deviceId } : null;
}

export const tracking = async (ctx: Context, next: Next) => {
    const subject = resolveRecommendationSubject(ctx);
    if (subject) {
        ctx.track = async (event: string, data: string) => {
            if (event === TrackingEvent.VIEW_ARTICLE && data) {
                await RecommendationService.recordBehavior(subject, data);
            }
        };
    }
    await next();
};
