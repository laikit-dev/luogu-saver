import { z } from 'zod';

export const DbSchema = z.object({
    host: z.string().default('localhost'),
    user: z.string().default('root'),
    port: z.number().default(3306),
    password: z.string().default(''),
    database: z.string().default('mydatabase'),
    connectionLimit: z.number().int().positive().default(10),
    queueLimit: z.number().int().min(0).default(0),
    connectTimeoutMs: z.number().int().positive().default(10000),
    maxQueryExecutionTimeMs: z.number().int().positive().default(1000),
    poolMetricsIntervalMs: z.number().int().positive().default(60000)
});

export const RedisSchema = z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().default(''),
    keyPrefix: z.string().default('')
});

export const ChromaSchema = z.object({
    enable: z.boolean().default(false),
    ssl: z.boolean().default(false),
    host: z.string().default('127.0.0.1'),
    port: z.number().default(8000),
    collectionName: z.string().default('lgs_articles'),
    chunkSize: z.number().int().min(1).default(4000),
    chunkOverlap: z.number().int().min(0).default(300),
    candidateArticleLimit: z.number().int().min(1).max(1000).default(100),
    rawVectorResultLimit: z.number().int().min(1).max(5000).default(500)
});

export const MeilisearchSchema = z.object({
    enable: z.boolean().default(false),
    host: z.string().default('http://127.0.0.1:7700'),
    apiKey: z.string().default(''),
    articleIndexName: z.string().default('lgs_articles')
});
