import { redisClient } from '@/lib/redis';
import { plainToInstance } from 'class-transformer';
import { logger } from '@/lib/logger';
import { EntityManager } from 'typeorm';

export type ClassConstructor<T> = { new (...args: any[]): T };
const inFlightLoads = new Map<string, Promise<unknown>>();

export function Cacheable<T>(
    ttlSeconds: number = 60,
    keyGenerator: (...args: any[]) => string,
    EntityClass?: ClassConstructor<T>
): MethodDecorator {
    return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args: any[]) {
            if (args.some(arg => arg instanceof EntityManager)) {
                return await originalMethod.apply(this, args);
            }

            const cacheKey = keyGenerator(...args);
            try {
                const cachedResult = await redisClient.get(cacheKey);
                if (cachedResult) {
                    const parsedResult = JSON.parse(cachedResult);
                    if (EntityClass) {
                        return plainToInstance(EntityClass, parsedResult);
                    }
                    return parsedResult;
                }
            } catch (err) {
                logger.error({ err }, 'Error accessing Redis cache');
            }
            const existingLoad = inFlightLoads.get(cacheKey);
            if (existingLoad) {
                return await existingLoad;
            }

            const loadPromise = (async () => {
                const result = await originalMethod.apply(this, args);
                if (result !== undefined) {
                    redisClient
                        .set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds)
                        .catch(console.error);
                }
                return result;
            })();

            inFlightLoads.set(cacheKey, loadPromise);
            try {
                return await loadPromise;
            } finally {
                inFlightLoads.delete(cacheKey);
            }
        };
        return descriptor;
    };
}
