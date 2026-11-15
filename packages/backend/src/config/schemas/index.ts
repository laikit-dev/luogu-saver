import { z } from 'zod';
import { ServerSchema } from './server';
import { DbSchema, RedisSchema, ChromaSchema, MeilisearchSchema } from './infrastructure';
import {
    ApiRateLimitSchema,
    RecommendationSchema,
    QueueSchema,
    WorkflowMaintenanceSchema
} from './business';
import { LLMConfigSchema } from './llm';
import { VerificationSchema } from './verification';
import { AuthSchema } from './auth';

export const AppConfigSchema = ServerSchema.extend({
    db: DbSchema,
    redis: RedisSchema,
    chroma: ChromaSchema,
    meilisearch: z.preprocess(value => value ?? {}, MeilisearchSchema),

    recommendation: RecommendationSchema,
    queue: z.preprocess(value => value ?? {}, QueueSchema),
    apiRateLimit: z.preprocess(value => value ?? {}, ApiRateLimitSchema),
    workflow: z.preprocess(value => value ?? {}, WorkflowMaintenanceSchema),
    llm: LLMConfigSchema,
    verification: VerificationSchema,
    auth: z.preprocess(value => value ?? {}, AuthSchema)
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
