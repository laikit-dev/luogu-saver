import type { Context } from 'koa';
import { describe, expect, it, vi } from 'vitest';
import { resolveRecommendationSubject } from '../src/middlewares/tracking';

vi.mock('@/services/recommendation.service', () => ({ RecommendationService: {} }));

function requestContext(headers: Record<string, string>, userId?: number): Context {
    const user = userId === undefined ? undefined : { id: userId, role: 1, luoguUid: 900 };
    return { headers, user } as unknown as Context;
}

describe('resolveRecommendationSubject', () => {
    it('attributes consented authenticated requests to the registered user, not the device', () => {
        const ctx = requestContext({ 'x-consent-tracking': 'true', 'x-device-id': 'device-a' }, 7);
        expect(resolveRecommendationSubject(ctx)).toEqual({ kind: 'user', userId: 7 });
    });

    it('attributes consented anonymous requests to the device', () => {
        const ctx = requestContext({ 'x-consent-tracking': 'true', 'x-device-id': 'device-a' });
        expect(resolveRecommendationSubject(ctx)).toEqual({ kind: 'device', deviceId: 'device-a' });
    });

    it('requires consent to be exactly "true", even for authenticated requests', () => {
        for (const consent of ['false', 'TRUE', '1']) {
            const ctx = requestContext(
                { 'x-consent-tracking': consent, 'x-device-id': 'device-a' },
                7
            );
            expect(resolveRecommendationSubject(ctx)).toBeNull();
        }
        expect(
            resolveRecommendationSubject(requestContext({ 'x-device-id': 'device-a' }, 7))
        ).toBeNull();
    });

    it('returns no subject for consented anonymous requests without a device ID', () => {
        expect(
            resolveRecommendationSubject(requestContext({ 'x-consent-tracking': 'true' }))
        ).toBeNull();
        const ctx = requestContext({ 'x-consent-tracking': 'true', 'x-device-id': '' });
        expect(resolveRecommendationSubject(ctx)).toBeNull();
    });
});
