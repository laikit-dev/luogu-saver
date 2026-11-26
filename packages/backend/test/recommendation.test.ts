import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Koa from 'koa';
import { once } from 'node:events';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
    chromaEnabled: true,
    getOrCreateCollection: vi.fn(),
    collectionGet: vi.fn(),
    collectionQuery: vi.fn(),
    redisZrevrange: vi.fn(),
    redisZrange: vi.fn(),
    redisMulti: vi.fn(),
    redisEval: vi.fn(),
    redisGet: vi.fn(),
    redisSet: vi.fn(),
    getHotArticleIds: vi.fn(),
    getRecentArticleIdPool: vi.fn(),
    getRecommendationArticlesByIds: vi.fn(),
    getArticleById: vi.fn(),
    getArticleTitlesByAuthor: vi.fn(),
    getArticleTitlesByIds: vi.fn(),
    searchArticleTitleCandidates: vi.fn(),
    loggerError: vi.fn(),
    loggerDebug: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn()
}));

vi.mock('@/config', () => ({
    config: {
        chroma: {
            get enable() {
                return mocks.chromaEnabled;
            },
            collectionName: 'lgs_articles',
            chunkSize: 4000,
            chunkOverlap: 300,
            candidateArticleLimit: 100,
            rawVectorResultLimit: 500
        },
        recommendation: {
            anonymous: { expireTime: 604800, maxCount: 100 },
            user: { expireTime: 2592000 },
            maxHistory: 500,
            profileSize: 50,
            decayFactor: 0.9,
            relevantThreshold: 0.75
        }
    }
}));

vi.mock('@/data-source', () => ({
    ChromaDataSource: {
        getOrCreateCollection: mocks.getOrCreateCollection
    },
    AppDataSource: {}
}));

vi.mock('@/lib/redis', () => ({
    redisClient: {
        zrevrange: mocks.redisZrevrange,
        zrange: mocks.redisZrange,
        multi: mocks.redisMulti,
        eval: mocks.redisEval,
        get: mocks.redisGet,
        set: mocks.redisSet
    }
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        error: mocks.loggerError,
        debug: mocks.loggerDebug,
        info: mocks.loggerInfo,
        warn: mocks.loggerWarn
    }
}));

vi.mock('@/lib/llm', () => ({ llm: {} }));

vi.mock('@/services/article.service', () => ({
    ArticleService: {
        getHotArticleIds: mocks.getHotArticleIds,
        getRecentArticleIdPool: mocks.getRecentArticleIdPool,
        getRecommendationArticlesByIds: mocks.getRecommendationArticlesByIds,
        getArticleById: mocks.getArticleById,
        getArticleTitlesByAuthor: mocks.getArticleTitlesByAuthor,
        getArticleTitlesByIds: mocks.getArticleTitlesByIds
    }
}));

vi.mock('@/services/search.service', () => ({
    SearchService: {
        searchArticleTitleCandidates: mocks.searchArticleTitleCandidates
    }
}));

import { RecommendationSchema } from '../src/config/schemas/business';
import { EmbeddingService } from '../src/services/embedding.service';
import { RecommendationService } from '../src/services/recommendation.service';
import type { RecommendationArticleRow } from '../src/services/article.service';
import { sampleWithoutReplacement } from '../src/utils/array';
import { responseHelper } from '../src/middlewares/response';
import { Cacheable } from '../src/decorators/cacheable';
import plazaRouter from '../src/routers/plaza.router';

function makeRow(
    id: string,
    overrides: Partial<RecommendationArticleRow> = {}
): RecommendationArticleRow {
    return {
        id,
        title: `Title ${id}`,
        category: 2,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        tags: ['dp'],
        summary: `Summary ${id}`,
        contentPreview: `Content preview ${id}`,
        ...overrides
    };
}

function resetEmbeddingCollectionCache() {
    const service = EmbeddingService as unknown as {
        _collection: unknown;
        _collectionPromise: unknown;
    };
    service._collection = null;
    service._collectionPromise = null;
}

function mockMultiTransaction() {
    const tx = {
        zadd: vi.fn().mockReturnThis(),
        zremrangebyrank: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([])
    };
    mocks.redisMulti.mockReturnValue(tx);
    return tx;
}

describe('RecommendationSchema validation', () => {
    it('enforces valid ranges for decayFactor, relevantThreshold, and positive integer limits', () => {
        const valid = RecommendationSchema.parse({ anonymous: {} });
        expect(valid.decayFactor).toBe(0.9);
        expect(valid.relevantThreshold).toBe(0.75);
        expect(valid.maxHistory).toBe(500);

        expect(() => RecommendationSchema.parse({ anonymous: {}, decayFactor: 0 })).toThrow();
        expect(() => RecommendationSchema.parse({ anonymous: {}, decayFactor: 1.5 })).toThrow();
        expect(() =>
            RecommendationSchema.parse({ anonymous: {}, relevantThreshold: -0.1 })
        ).toThrow();
        expect(() =>
            RecommendationSchema.parse({ anonymous: {}, relevantThreshold: 1.1 })
        ).toThrow();
        expect(() => RecommendationSchema.parse({ anonymous: {}, maxHistory: 0 })).toThrow();
        expect(() => RecommendationSchema.parse({ anonymous: { maxCount: -5 } })).toThrow();
    });
});

describe('EmbeddingService recommendation contract', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.chromaEnabled = true;
        resetEmbeddingCollectionCache();
        mocks.getOrCreateCollection.mockResolvedValue({
            get: mocks.collectionGet,
            query: mocks.collectionQuery
        });
    });

    it('creates collection with cosine HNSW space and null embeddingFunction', async () => {
        mocks.collectionGet.mockResolvedValue({ ids: ['a1'], embeddings: [[1, 0]] });
        const vec = await EmbeddingService.getVector('a1');
        expect(vec).toEqual([1, 0]);
        expect(mocks.getOrCreateCollection).toHaveBeenCalledWith({
            name: 'lgs_articles',
            embeddingFunction: null,
            configuration: { hnsw: { space: 'cosine' } }
        });
    });

    it('returns null from getVector when Chroma is disabled or getCollection rejects', async () => {
        mocks.chromaEnabled = false;
        expect(await EmbeddingService.getVector('a1')).toBeNull();
        expect(mocks.getOrCreateCollection).not.toHaveBeenCalled();

        mocks.chromaEnabled = true;
        mocks.getOrCreateCollection.mockRejectedValue(new Error('Chroma offline'));
        expect(await EmbeddingService.getVector('a1')).toBeNull();
        expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('queries only non-deleted summary vectors in getNearestArticleIds', async () => {
        mocks.collectionQuery.mockResolvedValue({
            ids: [['a1', 'a2']],
            metadatas: [
                [
                    { articleId: 'a1', kind: 'summary' },
                    { articleId: 'a2', kind: 'summary' }
                ]
            ]
        });

        const ids = await EmbeddingService.getNearestArticleIds([1, 0], 15);
        expect(ids).toEqual(['a1', 'a2']);
        expect(mocks.collectionQuery).toHaveBeenCalledWith({
            queryEmbeddings: [[1, 0]],
            nResults: 15,
            where: { $and: [{ deleted: false }, { kind: 'summary' }] },
            include: ['metadatas']
        });
    });

    it('batches multiple cluster embeddings into one Chroma query call', async () => {
        mocks.collectionQuery.mockResolvedValue({
            ids: [
                ['a1', 'a2'],
                ['b1', 'b2']
            ],
            metadatas: [
                [
                    { articleId: 'a1', kind: 'summary' },
                    { articleId: 'a2', kind: 'summary' }
                ],
                [
                    { articleId: 'b1', kind: 'summary' },
                    { articleId: 'b2', kind: 'summary' }
                ]
            ]
        });

        const batch = await EmbeddingService.getNearestArticleIdsBatch([[1, 0], [], [0, 1]], 10);
        expect(mocks.collectionQuery).toHaveBeenCalledTimes(1);
        expect(mocks.collectionQuery).toHaveBeenCalledWith({
            queryEmbeddings: [
                [1, 0],
                [0, 1]
            ],
            nResults: 10,
            where: { $and: [{ deleted: false }, { kind: 'summary' }] },
            include: ['metadatas']
        });
        expect(batch).toEqual([['a1', 'a2'], [], ['b1', 'b2']]);
    });

    it('degrades gracefully when Chroma read times out', async () => {
        vi.useFakeTimers();
        try {
            mocks.collectionQuery.mockImplementation(() => new Promise(() => {}));
            const pending = EmbeddingService.getNearestArticleIds([1, 0], 10);
            await vi.advanceTimersByTimeAsync(3100);
            await expect(pending).resolves.toEqual([]);
            expect(mocks.loggerError).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('RecommendationService profile vectors', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.chromaEnabled = true;
        resetEmbeddingCollectionCache();
        mocks.getOrCreateCollection.mockResolvedValue({
            get: mocks.collectionGet,
            query: mocks.collectionQuery
        });
    });

    it('drawProfile normalizes by weight sum and L2 norm instead of shrinking with vector count', async () => {
        const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
        mocks.collectionGet.mockResolvedValue({
            ids,
            embeddings: ids.map(() => [1, 0, 0])
        });

        const profile = await RecommendationService.drawProfile(ids);
        expect(profile).toHaveLength(3);
        expect(profile[0]).toBeCloseTo(1, 6);
        expect(profile[1]).toBeCloseTo(0, 6);
        expect(profile[2]).toBeCloseTo(0, 6);
    });

    it('drawInterestProfiles separates orthogonal interests in one Chroma get call', async () => {
        mocks.collectionGet.mockResolvedValue({
            ids: ['dp1', 'dp2', 'travel1'],
            embeddings: [
                [1, 0, 0],
                [0.98, 0.2, 0],
                [0, 0, 1]
            ]
        });

        const clusters = await RecommendationService.drawInterestProfiles([
            'dp1',
            'dp2',
            'travel1'
        ]);
        expect(mocks.collectionGet).toHaveBeenCalledTimes(1);
        expect(clusters).toHaveLength(2);
        // Most recent topic (dp1 + dp2) has greater decayed weight than travel1.
        expect(clusters[0].weight).toBeGreaterThan(clusters[1].weight);
        expect(clusters[0].vector[0]).toBeGreaterThan(0.95);
        expect(clusters[1].vector[2]).toBeCloseTo(1, 6);
    });
});

describe('RecommendationService personalized and public feeds', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.chromaEnabled = true;
        resetEmbeddingCollectionCache();
        mocks.getOrCreateCollection.mockResolvedValue({
            get: mocks.collectionGet,
            query: mocks.collectionQuery
        });
        mocks.getArticleTitlesByIds.mockResolvedValue(new Map());
        mockMultiTransaction();
        mocks.getRecommendationArticlesByIds.mockImplementation(async (ids: string[]) =>
            ids.map(id => makeRow(id))
        );
    });

    it('preserves vector relevance ordering, honors exclusions, and records only hydrated IDs', async () => {
        mocks.redisZrevrange.mockResolvedValue(['seen1', '2000']);
        mocks.redisZrange.mockResolvedValue(['prev1']);
        mocks.collectionGet.mockResolvedValue({ ids: ['seen1'], embeddings: [[1, 0]] });
        mocks.collectionQuery.mockResolvedValue({
            ids: [['seen1', 'prev1', 'v1', 'v2', 'deleted1', 'v3', 'v4', 'v5', 'v6', 'v7']],
            metadatas: [Array(10).fill({ kind: 'summary' })]
        });
        mocks.getHotArticleIds.mockResolvedValue(['h1', 'h2', 'h3', 'h4', 'h5']);
        mocks.getRecentArticleIdPool.mockResolvedValue(['r1', 'r2', 'r3', 'r4', 'r5']);
        mocks.getRecommendationArticlesByIds.mockImplementation(async (ids: string[]) =>
            ids.filter(id => id !== 'deleted1').map(id => makeRow(id))
        );

        const tx = mockMultiTransaction();
        const result = await RecommendationService.getPersonalizedRecommendations(
            { kind: 'user', userId: 42 },
            6,
            ['h1']
        );

        expect(result).toHaveLength(6);
        const ids = result.map(item => item.id);
        expect(ids).not.toContain('seen1');
        expect(ids).not.toContain('prev1');
        expect(ids).not.toContain('h1');
        expect(ids).not.toContain('deleted1');

        // Vector candidates retain their exact similarity rank order.
        const vectorOrder = result.filter(item => item.reason === 'vector').map(item => item.id);
        expect(vectorOrder.length).toBeGreaterThanOrEqual(3);
        expect(vectorOrder).toEqual(
            ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].slice(0, vectorOrder.length)
        );

        // Only actually returned IDs are written to recommendedKey.
        expect(tx.zadd).toHaveBeenCalledTimes(1);
        const recordedMembers = tx.zadd.mock.calls[0].slice(1).filter((_, idx) => idx % 2 === 1);
        expect(recordedMembers).toEqual(ids);
    });

    it('queries Chroma once for multiple orthogonal interest clusters and interleaves results', async () => {
        mocks.redisZrevrange.mockResolvedValue(['dp1', '3000', 'travel1', '2000']);
        mocks.redisZrange.mockResolvedValue([]);
        mocks.collectionGet.mockResolvedValue({
            ids: ['dp1', 'travel1'],
            embeddings: [
                [1, 0, 0],
                [0, 0, 1]
            ]
        });
        mocks.collectionQuery.mockResolvedValue({
            ids: [
                ['dp_rec1', 'dp_rec2'],
                ['tr_rec1', 'tr_rec2']
            ],
            metadatas: [
                [
                    { articleId: 'dp_rec1', kind: 'summary' },
                    { articleId: 'dp_rec2', kind: 'summary' }
                ],
                [
                    { articleId: 'tr_rec1', kind: 'summary' },
                    { articleId: 'tr_rec2', kind: 'summary' }
                ]
            ]
        });
        mocks.getHotArticleIds.mockResolvedValue(['h1', 'h2']);
        mocks.getRecentArticleIdPool.mockResolvedValue(['r1', 'r2']);

        const result = await RecommendationService.getPersonalizedRecommendations(
            { kind: 'user', userId: 99 },
            8
        );
        expect(mocks.collectionQuery).toHaveBeenCalledTimes(1);
        const vectorIds = result.filter(item => item.reason === 'vector').map(item => item.id);
        expect(vectorIds).toEqual(['dp_rec1', 'tr_rec1', 'dp_rec2', 'tr_rec2']);
    });

    it('soft-recycles previously recommended items when strict pool is exhausted while still excluding viewed and excluded IDs', async () => {
        mocks.redisZrevrange.mockResolvedValue(['viewed1', '2000']);
        mocks.redisZrange.mockResolvedValue(['prev1', 'prev2', 'prev3']);
        mocks.collectionGet.mockResolvedValue({ ids: [], embeddings: [] });
        mocks.getHotArticleIds.mockResolvedValue(['viewed1', 'excluded1', 'prev1', 'prev2']);
        mocks.getRecentArticleIdPool.mockResolvedValue([
            'viewed1',
            'excluded1',
            'prev1',
            'prev2',
            'prev3',
            'fresh1'
        ]);

        const result = await RecommendationService.getPersonalizedRecommendations(
            { kind: 'device', deviceId: 'dev-1' },
            4,
            ['excluded1']
        );

        const ids = result.map(item => item.id);
        expect(ids).toHaveLength(4);
        expect(ids).toContain('fresh1');
        expect(ids).not.toContain('viewed1');
        expect(ids).not.toContain('excluded1');
    });

    it('degrades gracefully when Redis behavior read fails', async () => {
        mocks.redisZrevrange.mockRejectedValue(new Error('ECONNREFUSED'));
        mocks.redisZrange.mockResolvedValue([]);
        mocks.getHotArticleIds.mockResolvedValue(['h1', 'h2', 'h3']);
        mocks.getRecentArticleIdPool.mockResolvedValue(['r1', 'r2', 'r3']);

        const result = await RecommendationService.getPersonalizedRecommendations(
            { kind: 'user', userId: 7 },
            4
        );
        expect(result).toHaveLength(4);
        expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('uses LLM summary when available and truncates fallback preview by Unicode code points', async () => {
        const emojiText = '🚀'.repeat(120);
        mocks.getHotArticleIds.mockResolvedValue(['a1', 'a2']);
        mocks.getRecentArticleIdPool.mockResolvedValue(['a1', 'a2']);
        mocks.getRecommendationArticlesByIds.mockResolvedValue([
            makeRow('a1', { summary: '  LLM Summary  ', contentPreview: 'Raw markdown' }),
            makeRow('a2', { summary: '   ', contentPreview: emojiText })
        ]);

        const result = await RecommendationService.getPublicRecommendations(2);
        const byId = new Map(result.map(item => [item.id, item]));
        expect(byId.get('a1')?.summary).toBe('LLM Summary');
        expect(Array.from(byId.get('a2')?.summary ?? '')).toHaveLength(100);
        expect(byId.get('a2')?.summary).toBe('🚀'.repeat(100));
    });

    it('attributes returned vector cards to the most cosine-similar viewed article in the recalling cluster, falling back to the cluster lead', async () => {
        // Viewed articles s1 (newest) and s2 (older) are both in cluster 0 (sim = 0.8 >= 0.65).
        // Returned vector card rec1 is much closer to s2 than s1; rec2 has no embedding so it falls back to s1.
        mocks.redisZrevrange.mockResolvedValue(['s1', '2000', 's2', '1000']);
        mocks.redisZrange.mockResolvedValue([]);
        mocks.collectionGet
            .mockResolvedValueOnce({
                ids: ['s1', 's2'],
                embeddings: [
                    [1, 0],
                    [0.8, 0.6]
                ]
            })
            .mockResolvedValueOnce({
                ids: ['rec1'],
                embeddings: [[0.7, 0.714]]
            });
        mocks.collectionQuery.mockResolvedValue({
            ids: [['rec1', 'rec2']],
            metadatas: [
                [
                    { articleId: 'rec1', kind: 'summary' },
                    { articleId: 'rec2', kind: 'summary' }
                ]
            ]
        });
        mocks.getHotArticleIds.mockResolvedValue([]);
        mocks.getRecentArticleIdPool.mockResolvedValue([]);
        mocks.getArticleTitlesByIds.mockResolvedValue(
            new Map([
                ['s1', '线段树模板'],
                ['s2', '树链剖分详解']
            ])
        );

        const result = await RecommendationService.getPersonalizedRecommendations(
            { kind: 'user', userId: 7 },
            2
        );
        const byId = new Map(result.map(item => [item.id, item]));
        expect(byId.get('rec1')?.reasonSource).toEqual({ id: 's2', title: '树链剖分详解' });
        expect(byId.get('rec2')?.reasonSource).toEqual({ id: 's1', title: '线段树模板' });
    });
});

describe('RecommendationService.getRelevantArticle', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.chromaEnabled = true;
        resetEmbeddingCollectionCache();
        mocks.getOrCreateCollection.mockResolvedValue({
            get: mocks.collectionGet,
            query: mocks.collectionQuery
        });
        mocks.getRecommendationArticlesByIds.mockImplementation(async (ids: string[]) =>
            ids.map(id => makeRow(id))
        );
        mocks.searchArticleTitleCandidates.mockResolvedValue([]);
    });

    it('caps and sorts author title matches, skips duplicates without burning vector budget, and reuses sourceArticle', async () => {
        mocks.collectionGet.mockResolvedValue({ ids: ['src'], embeddings: [[1, 0]] });
        mocks.collectionQuery.mockResolvedValue({
            ids: [['src', 't1', 't2', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']],
            metadatas: [Array(9).fill({ kind: 'summary' })]
        });
        mocks.getArticleTitlesByAuthor.mockResolvedValue([
            { id: 'src', title: 'P1001 题解' },
            { id: 't1', title: 'P1002 题解' },
            { id: 't2', title: 'P1003 题解' },
            { id: 't3', title: 'P1004 题解' },
            { id: 't4', title: 'P1005 题解' },
            { id: 't5', title: 'P1006 题解' },
            { id: 't6', title: 'P1007 题解' },
            { id: 't7', title: 'P1008 题解' }
        ]);

        const result = await RecommendationService.getRelevantArticle(
            'src',
            5,
            { id: 'src', title: 'P1001 题解', authorId: 10 } as never,
            5
        );

        expect(mocks.getArticleById).not.toHaveBeenCalled();
        const titleItems = result.filter(item => item.reason === 'title');
        const vectorItems = result.filter(item => item.reason === 'vector');
        expect(titleItems).toHaveLength(5);
        expect(vectorItems).toHaveLength(5);
        expect(vectorItems.map(item => item.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    });

    it('handles empty titles without NaN similarity', async () => {
        mocks.collectionGet.mockResolvedValue({ ids: [], embeddings: [] });
        mocks.getArticleTitlesByAuthor.mockResolvedValue([
            { id: 'other1', title: '' },
            { id: 'other2', title: 'Non-empty' }
        ]);

        const result = await RecommendationService.getRelevantArticle('src', 5, {
            id: 'src',
            title: '',
            authorId: 10
        } as never);
        expect(Array.isArray(result)).toBe(true);
    });

    it('merges site-wide Meilisearch title matches across authors, deduplicates, and prefers same-author on ties', async () => {
        mocks.collectionGet.mockResolvedValue({ ids: [], embeddings: [] });
        mocks.getArticleTitlesByAuthor.mockResolvedValue([
            { id: 'src', title: 'P3372 【模板】线段树 1 题解' },
            { id: 'same_tie', title: 'P3372 线段树 1 题解' }
        ]);
        mocks.searchArticleTitleCandidates.mockResolvedValue([
            { id: 'src', title: 'P3372 【模板】线段树 1 题解', authorId: 10 },
            { id: 'global_exact', title: 'p3372 【模板】线段树 1 题解', authorId: 99 },
            { id: 'same_tie', title: 'P3372 线段树 1 题解', authorId: 10 },
            { id: 'other_tie', title: 'P3372 线段树 1 题解', authorId: 77 },
            { id: 'noisy', title: '2026 年度随笔总结', authorId: 88 }
        ]);

        const result = await RecommendationService.getRelevantArticle(
            'src',
            5,
            { id: 'src', title: 'P3372 【模板】线段树 1 题解', authorId: 10 } as never,
            5
        );

        expect(mocks.searchArticleTitleCandidates).toHaveBeenCalledWith(
            'P3372 【模板】线段树 1 题解',
            30
        );
        expect(result.map(item => item.id)).toEqual(['global_exact', 'same_tie', 'other_tie']);
        expect(result.every(item => item.reason === 'title')).toBe(true);
    });

    it('degrades gracefully to same-author and vector recommendations when Meilisearch fails', async () => {
        mocks.collectionGet.mockResolvedValue({ ids: ['src'], embeddings: [[1, 0]] });
        mocks.collectionQuery.mockResolvedValue({
            ids: [['src', 'v1']],
            metadatas: [[{ kind: 'summary' }, { kind: 'summary' }]]
        });
        mocks.getArticleTitlesByAuthor.mockResolvedValue([{ id: 't1', title: 'P1002 题解' }]);
        mocks.searchArticleTitleCandidates.mockRejectedValue(new Error('meilisearch timeout'));

        const result = await RecommendationService.getRelevantArticle(
            'src',
            5,
            { id: 'src', title: 'P1001 题解', authorId: 10 } as never,
            5
        );

        expect(result.map(item => ({ id: item.id, reason: item.reason }))).toEqual([
            { id: 't1', reason: 'title' },
            { id: 'v1', reason: 'vector' }
        ]);
    });
});

describe('sampleWithoutReplacement', () => {
    it('samples distinct IDs excluding excluded set without mutating input pool', () => {
        const pool = ['a1', 'a2', 'a3', 'a4', 'a5'];
        const snapshot = [...pool];
        const sampled = sampleWithoutReplacement(pool, 3, new Set(['a2', 'a4']));
        expect(pool).toEqual(snapshot);
        expect(sampled).toHaveLength(3);
        expect(new Set(sampled).size).toBe(3);
        expect(sampled.sort()).toEqual(['a1', 'a3', 'a5']);
    });
});

describe('Cacheable single-flight deduplication', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.redisGet.mockResolvedValue(null);
        mocks.redisSet.mockResolvedValue('OK');
    });

    it('deduplicates concurrent cache misses for the same key and retries after rejection', async () => {
        let calls = 0;
        let deferred = Promise.withResolvers<string[]>();
        let failNext = false;

        class Loader {
            static async load(key: string): Promise<string[]> {
                calls++;
                if (failNext) {
                    throw new Error(`boom:${key}`);
                }
                return await deferred.promise;
            }
        }

        const descriptor = Object.getOwnPropertyDescriptor(Loader, 'load')!;
        Cacheable(60, (key: string) => `test:sf:${key}`)(Loader, 'load', descriptor);
        Object.defineProperty(Loader, 'load', descriptor);

        const p1 = Loader.load('hot');
        const p2 = Loader.load('hot');
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toBe(1);

        deferred.resolve(['a1', 'a2']);
        await expect(Promise.all([p1, p2])).resolves.toEqual([
            ['a1', 'a2'],
            ['a1', 'a2']
        ]);

        failNext = true;
        await expect(Loader.load('retry')).rejects.toThrow('boom:retry');
        failNext = false;
        deferred = Promise.withResolvers<string[]>();
        const p3 = Loader.load('retry');
        await Promise.resolve();
        await Promise.resolve();
        deferred.resolve(['recovered']);
        await expect(p3).resolves.toEqual(['recovered']);
    });
});

describe('GET /plaza/get error handling', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const app = new Koa();
        app.use(responseHelper);
        app.use(plazaRouter.routes());
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected loopback port');
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
        });
    });

    it('returns a generic 500 response without exposing internal error details', async () => {
        mocks.getHotArticleIds.mockRejectedValue(new Error('secret-db-password-leak'));
        const response = await fetch(`${origin}/plaza/get`);
        const body = (await response.json()) as { code: number; message: string };
        expect(body.code).toBe(500);
        expect(body.message).toBe('Failed to retrieve recommendations');
    });
});
