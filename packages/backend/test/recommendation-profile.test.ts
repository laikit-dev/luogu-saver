import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationArticleRow } from '../src/services/article.service';

const mocks = vi.hoisted(() => ({
    redisZrevrange: vi.fn(),
    redisDel: vi.fn(),
    getRecommendationArticlesByIds: vi.fn(),
    getVectors: vi.fn(),
    loggerError: vi.fn()
}));

vi.mock('@/config', () => ({
    config: {
        recommendation: {
            maxHistory: 50,
            profileSize: 20,
            decayFactor: 0.9,
            relevantThreshold: 0.5,
            anonymous: {
                maxCount: 30,
                expireTime: 7 * 86400
            },
            user: {
                expireTime: 30 * 86400
            }
        }
    }
}));

vi.mock('@/lib/redis', () => ({
    redisClient: {
        zrevrange: mocks.redisZrevrange,
        del: mocks.redisDel
    }
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        error: mocks.loggerError,
        debug: vi.fn()
    }
}));

vi.mock('@/services/article.service', () => ({
    ArticleService: {
        getRecommendationArticlesByIds: mocks.getRecommendationArticlesByIds
    }
}));

vi.mock('@/services/embedding.service', () => ({
    EmbeddingService: {
        getVectors: mocks.getVectors
    }
}));

import { RecommendationService } from '../src/services/recommendation.service';
import {
    buildInterestProfileSummary,
    createDisabledInterestProfile
} from '../src/services/recommendation-profile';

function makeRow(
    id: string,
    overrides: Partial<RecommendationArticleRow> = {}
): RecommendationArticleRow {
    return {
        id,
        title: `Article ${id}`,
        category: 2,
        updatedAt: new Date('2026-11-26T00:00:00.000Z'),
        tags: [],
        summary: '',
        contentPreview: '',
        author: {
            id: 1001,
            name: 'Alex_Wei',
            color: 'Red',
            ccfLevel: 10,
            xcpcLevel: 3,
            badge: 'NOI'
        } as RecommendationArticleRow['author'],
        ...overrides
    };
}

describe('recommendation interest profile', () => {
    beforeEach(() => {
        mocks.redisZrevrange.mockReset();
        mocks.redisDel.mockReset();
        mocks.getRecommendationArticlesByIds.mockReset();
        mocks.getVectors.mockReset();
        mocks.loggerError.mockReset();
    });

    it('returns an empty disabled profile without touching storage', () => {
        const disabled = createDisabledInterestProfile();
        expect(disabled.trackingEnabled).toBe(false);
        expect(disabled.subjectKind).toBeNull();
        expect(disabled.personaTags).toEqual([]);
        expect(disabled.topicTags).toEqual([]);
    });

    it('derives persona tags, topic tags, clusters, authors, and UTC+8 rhythm from history', () => {
        // 2026-11-25T16:30:00Z == 2026-11-26 00:30 Beijing time (night)
        const nightTs = Date.parse('2026-11-25T16:30:00.000Z');
        // 2026-11-26T06:00:00Z == 2026-11-26 14:00 Beijing time (afternoon)
        const afternoonTs = Date.parse('2026-11-26T06:00:00.000Z');

        const rows: RecommendationArticleRow[] = [
            makeRow('a1', {
                title: 'P3372 线段树 1 题解',
                category: 2,
                tags: ['数据结构'],
                summary: '利用懒标记线段树维护区间加法。'
            }),
            makeRow('a2', {
                title: '吉司机线段树与区间最值操作笔记',
                category: 4,
                summary: '算法理论讲解线段树历史最值。'
            }),
            makeRow('a3', {
                title: '斜率优化 DP 详解',
                category: 4,
                summary: '动态规划常见优化技巧。'
            }),
            makeRow('a4', {
                title: 'NOIP 2026 游记与退役记',
                category: 5,
                author: {
                    id: 2002,
                    name: 'Tourist',
                    color: 'Purple',
                    ccfLevel: 9,
                    xcpcLevel: 0,
                    badge: null
                } as RecommendationArticleRow['author']
            })
        ];

        const viewedAtByArticleId = new Map<string, number>([
            ['a1', nightTs],
            ['a2', nightTs - 60_000],
            ['a3', nightTs - 120_000],
            ['a4', afternoonTs]
        ]);

        const summary = buildInterestProfileSummary({
            subjectKind: 'user',
            retentionDays: 30,
            decayFactor: 0.9,
            hydratedRows: rows,
            viewedAtByArticleId,
            clusters: [
                { weight: 2.71, articleIds: ['a1', 'a2', 'a3'] },
                { weight: 0.729, articleIds: ['a4'] }
            ]
        });

        expect(summary.trackingEnabled).toBe(true);
        expect(summary.viewedCount).toBe(4);
        expect(summary.retentionDays).toBe(30);

        const personaIds = summary.personaTags.map(tag => tag.id);
        expect(personaIds).toContain('hardcore-oier');
        expect(personaIds).toContain('deep-focus');
        expect(personaIds).toContain('night-owl');
        expect(personaIds).toContain('loyal-reader');
        expect(personaIds).toContain('master-tracker');

        const topicNames = summary.topicTags.map(t => t.tag);
        expect(topicNames).toContain('线段树');
        expect(topicNames).toContain('数据结构');
        expect(topicNames).toContain('动态规划');
        expect(topicNames).toContain('NOIP');

        expect(summary.clusters).toHaveLength(2);
        expect(summary.clusters[0].keywords).toContain('线段树');
        expect(summary.clusters[0].sampleArticles.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
        expect(summary.clusters[1].keywords).toContain('NOIP');

        expect(summary.favoriteAuthors[0]).toMatchObject({
            id: 1001,
            name: 'Alex_Wei',
            count: 3
        });
        expect(summary.readingRhythm.find(b => b.period === 'night')).toEqual({
            period: 'night',
            count: 3,
            share: 0.75
        });
    });

    it('hydrates history and vector clusters via RecommendationService.getInterestProfileSummary', async () => {
        const ts1 = Date.parse('2026-11-26T12:00:00.000Z');
        const ts2 = Date.parse('2026-11-26T11:00:00.000Z');
        mocks.redisZrevrange.mockResolvedValue(['a1', String(ts1), 'a2', String(ts2)]);
        mocks.getRecommendationArticlesByIds.mockResolvedValue([
            makeRow('a1', { title: '线段树模板', category: 2 }),
            makeRow('a2', { title: 'NOIP 游记', category: 5 })
        ]);
        mocks.getVectors.mockResolvedValue(
            new Map<string, number[]>([
                ['a1', [1, 0]],
                ['a2', [0, 1]]
            ])
        );

        const profile = await RecommendationService.getInterestProfileSummary({
            kind: 'device',
            deviceId: 'dev-1'
        });

        expect(mocks.redisZrevrange).toHaveBeenCalledWith(
            'anon_behavior:dev-1',
            0,
            29,
            'WITHSCORES'
        );
        expect(mocks.getRecommendationArticlesByIds).toHaveBeenCalledWith(['a1', 'a2']);
        expect(mocks.getVectors).toHaveBeenCalledWith(['a1', 'a2']);
        expect(profile.subjectKind).toBe('device');
        expect(profile.retentionDays).toBe(7);
        expect(profile.viewedCount).toBe(2);
        expect(profile.personaTags.map(t => t.id)).toEqual(['newcomer']);
        expect(profile.clusters).toHaveLength(2);
    });

    it('clears both behavior and recommended keys in clearSubjectHistory', async () => {
        mocks.redisDel.mockResolvedValue(2);

        await RecommendationService.clearSubjectHistory({ kind: 'user', userId: 42 });

        expect(mocks.redisDel).toHaveBeenCalledWith('user_behavior:42', 'user_recommendations:42');
    });
});
