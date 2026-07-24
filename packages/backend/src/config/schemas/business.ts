import { z } from 'zod';

export const RecommendationSchema = z.object({
    anonymous: z.object({
        expireTime: z.number().default(7 * 24 * 60 * 60),
        maxCount: z.number().default(100)
    }),
    maxHistory: z.number().default(500),
    decayFactor: z.number().default(0.9),
    relevantThreshold: z.number().default(0.75)
});

const QueueSectionSchema = z.object({
    concurrencyLimit: z.number().default(2),
    maxRequestToken: z.number().default(20),
    regenerationSpeed: z.number().default(1),
    regenerationInterval: z.number().default(1000),
    maxQueueLength: z.number().default(1000)
});
const DefaultQueueSectionSchema = z.preprocess(value => value ?? {}, QueueSectionSchema);
const AiQueueSectionSchema = QueueSectionSchema.extend({
    concurrencyLimit: z.number().default(10),
    maxRequestToken: z.number().default(50),
    maxQueueLength: z.number().default(2000)
});
const DefaultAiQueueSectionSchema = z.preprocess(value => value ?? {}, AiQueueSectionSchema);

export const QueueSchema = z.object({
    save: DefaultQueueSectionSchema,
    ai: DefaultAiQueueSectionSchema,
    update: DefaultQueueSectionSchema,
    search: DefaultQueueSectionSchema,
    read: DefaultQueueSectionSchema,
    rag: DefaultAiQueueSectionSchema,
    discover: DefaultQueueSectionSchema
});

export const ApiRateLimitSchema = z.object({
    enabled: z.boolean().default(true),
    points: z.number().default(300),
    duration: z.number().default(60),
    blockDuration: z.number().default(60),
    keyPrefix: z.string().default('api_rate_limit')
});

export const WorkflowMaintenanceSchema = z.object({
    recovery: z.preprocess(
        value => value ?? {},
        z.object({
            enabled: z.boolean().default(true),
            batchSize: z.number().int().positive().default(100),
            concurrency: z.number().int().positive().default(2),
            yieldMs: z.number().int().min(0).default(50)
        })
    ),
    cleanup: z.preprocess(
        value => value ?? {},
        z.object({
            enabled: z.boolean().default(true),
            intervalMs: z
                .number()
                .int()
                .positive()
                .default(60 * 60 * 1000),
            terminalRetentionMs: z
                .number()
                .int()
                .positive()
                .default(7 * 24 * 60 * 60 * 1000),
            legacyTaskRetentionMs: z
                .number()
                .int()
                .positive()
                .default(7 * 24 * 60 * 60 * 1000),
            batchSize: z.number().int().positive().default(100),
            initialDelayMs: z
                .number()
                .int()
                .min(0)
                .default(60 * 1000)
        })
    )
});

export const DiscoverySchema = z.object({
    articlePlaza: z.preprocess(
        value => value ?? {},
        z.object({
            enabled: z.boolean().default(true),
            intervalMs: z
                .number()
                .int()
                .positive()
                .default(60 * 60 * 1000),
            maxPages: z.number().int().min(1).max(1000).default(50),
            includeCategories: z.boolean().default(true),
            forceUpdate: z.boolean().default(false)
        })
    )
});
