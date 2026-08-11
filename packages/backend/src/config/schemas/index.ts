import { z } from 'zod';
import { ServerSchema } from './server';
import { DbSchema, RedisSchema, ChromaSchema, MeilisearchSchema } from './infrastructure';
import {
    ApiRateLimitSchema,
    DiscoverySchema,
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
    rag: z.preprocess(
        value => value ?? {},
        z.object({
            chunkSize: z.number().int().min(1).default(4000),
            chunkOverlap: z.number().int().min(0).default(300),
            candidateArticleLimit: z.number().int().min(1).max(1000).default(100),
            rawVectorResultLimit: z.number().int().min(1).max(5000).default(500),
            keywordWeight: z.number().min(0).default(0.25),
            vectorWeight: z.number().min(0).default(0.35),
            rerankWeight: z.number().min(0).default(0.4)
        })
    ),
    recommendation: RecommendationSchema,
    queue: z.preprocess(value => value ?? {}, QueueSchema),
    discovery: z.preprocess(value => value ?? {}, DiscoverySchema),
    apiRateLimit: z.preprocess(value => value ?? {}, ApiRateLimitSchema),
    workflow: z.preprocess(value => value ?? {}, WorkflowMaintenanceSchema),
    llm: LLMConfigSchema,
    verification: VerificationSchema,
    auth: z.preprocess(value => value ?? {}, AuthSchema)
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
