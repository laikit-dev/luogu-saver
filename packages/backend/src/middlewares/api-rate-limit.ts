import { Context, Next } from 'koa';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '@/config';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/middlewares/client-ip';
import { PeerExportService } from '@/services/peer-export.service';

const limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: config.apiRateLimit.keyPrefix,
    points: config.apiRateLimit.points,
    duration: config.apiRateLimit.duration,
    blockDuration: config.apiRateLimit.blockDuration
});

export const apiRateLimit = async (ctx: Context, next: Next) => {
    if (
        !config.apiRateLimit.enabled ||
        (ctx.path.startsWith('/peer/v1/') &&
            PeerExportService.isAuthorized(ctx.get('Authorization') || undefined))
    ) {
        await next();
        return;
    }

    try {
        await limiter.consume(getClientIp(ctx));
        await next();
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            ctx.set('Retry-After', String(Math.ceil(error.msBeforeNext / 1000) || 1));
            ctx.fail(429, 'Too Many Requests');
            return;
        }

        logger.error({ error }, 'API rate limiter failed');
        throw error;
    }
};
