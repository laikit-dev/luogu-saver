import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    redisGet: vi.fn(),
    redisSet: vi.fn(),
    redisDel: vi.fn(),
    loggerError: vi.fn()
}));

vi.mock('@/data-source', () => ({
    AppDataSource: {
        manager: {
            query: mocks.query
        }
    }
}));

vi.mock('@/lib/redis', () => ({
    redisClient: {
        get: mocks.redisGet,
        set: mocks.redisSet,
        del: mocks.redisDel
    }
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        error: mocks.loggerError
    }
}));

import {
    MIN_PUBLISH_TIME_SECONDS,
    SITE_STATS_CACHE_KEY,
    SITE_STATS_CACHE_TTL_SECONDS,
    SITE_STATS_QUERY_CONCURRENCY,
    SITE_STATS_REFRESH_LOCK_KEY,
    SITE_STATS_REFRESH_LOCK_TTL_SECONDS,
    SITE_STATS_RETENTION_TTL_SECONDS,
    SiteStatsService
} from '../src/services/site-stats.service';

function stubStandardQueries(tracker?: { active: number; maxActive: number }) {
    const responses: Array<[RegExp, unknown[]]> = [
        [
            /idx_articles_stats_category_pid/,
            [
                {
                    category: 2,
                    pid: 'P3372',
                    count: '9',
                    total_views: '500',
                    total_upvotes: '50',
                    total_favors: '15'
                },
                {
                    category: 2,
                    pid: 'P1001',
                    count: '7',
                    total_views: '300',
                    total_upvotes: '20',
                    total_favors: '10'
                },
                {
                    category: 2,
                    pid: null,
                    count: '104',
                    total_views: '3700',
                    total_upvotes: '240',
                    total_favors: '70'
                },
                {
                    category: 8,
                    pid: null,
                    count: '30',
                    total_views: '800',
                    total_upvotes: '40',
                    total_favors: '12'
                }
            ]
        ],
        [/idx_paste_deleted/, [{ count: '44' }]],
        [/STRAIGHT_JOIN article_history/, [{ count: '4' }]],
        [/FROM article_history FORCE INDEX/, [{ count: '23' }]],
        [/STRAIGHT_JOIN article_comment/, [{ count: '15' }]],
        [/FROM article_comment FORCE INDEX/, [{ count: '275' }]],
        [/FROM judgement_record/, [{ count: '77' }]],
        [
            /idx_articles_author_deleted_created_at_id/,
            [
                { day: '2026-11-24', count: '6' },
                { day: '2026-11-26', count: '11' }
            ]
        ],
        [
            /idx_articles_author_deleted_publish_time_id/,
            [
                { year: 2024, hour: 2, count: '18' },
                { year: 2024, hour: 22, count: '7' },
                { year: 2025, hour: 22, count: '35' }
            ]
        ],
        [
            /idx_user_color_ccf_level/,
            [
                { color: 'Red', level: 8, count: '5' },
                { color: 'Red', level: 6, count: '15' },
                { color: 'Red', level: 0, count: '30' },
                { color: 'Orange', level: 0, count: '30' }
            ]
        ],
        [
            /idx_articles_stats_author_metrics/,
            [
                {
                    id: 1001,
                    name: 'Alice',
                    color: 'Red',
                    ccf_level: 8,
                    xcpc_level: 0,
                    badge: 'NOI',
                    article_count: '24',
                    total_upvotes: '180',
                    total_views: '2100'
                },
                {
                    id: 2002,
                    name: null,
                    color: null,
                    ccf_level: null,
                    xcpc_level: null,
                    badge: null,
                    article_count: '12',
                    total_upvotes: '20',
                    total_views: '300'
                }
            ]
        ],
        [
            /idx_articles_deleted_upvote/,
            [
                {
                    id: 'art00001',
                    title: '线段树笔记',
                    category: 4,
                    upvote: '150',
                    favor_count: '60',
                    view_count: '1200',
                    author_id: 1001,
                    author_name: 'Alice',
                    author_color: 'Red',
                    author_ccf_level: 8,
                    author_xcpc_level: 0,
                    author_badge: 'NOI'
                }
            ]
        ],
        [
            /ORDER BY view_count DESC/,
            [
                {
                    id: 'art00002',
                    title: '退役记',
                    category: 8,
                    upvote: '30',
                    favor_count: '10',
                    view_count: '3400',
                    author_id: null,
                    author_name: null,
                    author_color: null,
                    author_ccf_level: null,
                    author_xcpc_level: null,
                    author_badge: null
                }
            ]
        ]
    ];

    mocks.query.mockImplementation(async (sql: string) => {
        if (tracker) {
            tracker.active += 1;
            tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
        }
        await Promise.resolve();
        const match = responses.find(([pattern]) => pattern.test(sql));
        const rows = match ? match[1] : [];
        if (tracker) {
            tracker.active -= 1;
        }
        return rows;
    });
}

describe('SiteStatsService.getOverview', () => {
    beforeEach(() => {
        SiteStatsService.resetMemoryCache();
        mocks.query.mockReset();
        mocks.redisGet.mockReset();
        mocks.redisSet.mockReset();
        mocks.redisDel.mockReset();
        mocks.loggerError.mockReset();
        mocks.redisGet.mockResolvedValue(null);
        mocks.redisSet.mockResolvedValue('OK');
        mocks.redisDel.mockResolvedValue(1);
    });

    it('runs 13 covering-index queries with bounded concurrency=3 and omits updated_at/content', async () => {
        const tracker = { active: 0, maxActive: 0 };
        stubStandardQueries(tracker);
        const now = new Date(2026, 10, 26, 16, 0, 0);

        const overview = await SiteStatsService.getOverview(now);

        expect(tracker.maxActive).toBe(SITE_STATS_QUERY_CONCURRENCY);
        expect(mocks.query).toHaveBeenCalledTimes(13);
        for (const [sql] of mocks.query.mock.calls) {
            const lower = String(sql).toLowerCase();
            expect(lower).not.toContain('updated_at');
            expect(lower).not.toMatch(/\bcontent\b/);
        }

        const publishCall = mocks.query.mock.calls.find(([sql]) =>
            String(sql).includes('idx_articles_author_deleted_publish_time_id')
        );
        const maxPublishSec = Math.floor(now.getTime() / 1000) + 86400;
        expect(publishCall?.[1]).toEqual([MIN_PUBLISH_TIME_SECONDS, maxPublishSec]);

        expect(overview.generatedAt).toBe(now.toISOString());
        expect(overview.cachedTtlSeconds).toBe(SITE_STATS_CACHE_TTL_SECONDS);
        expect(overview.summary).toEqual({
            articles: 150,
            pastes: 44,
            users: 80,
            articleRevisions: 19,
            comments: 260,
            judgements: 77,
            totalViews: 5300,
            totalUpvotes: 350,
            totalFavors: 107,
            publishedTimeKnown: 60
        });

        expect(overview.categories).toEqual([
            { category: 2, count: 120, totalViews: 4500, totalUpvotes: 310, totalFavors: 95 },
            { category: 8, count: 30, totalViews: 800, totalUpvotes: 40, totalFavors: 12 }
        ]);
        expect(overview.topProblems).toEqual([
            { pid: 'P3372', solutionCount: 9 },
            { pid: 'P1001', solutionCount: 7 }
        ]);
        expect(overview.publishYearDistribution).toEqual([
            { year: 2024, count: 25 },
            { year: 2025, count: 35 }
        ]);
        expect(overview.publishHourDistribution).toHaveLength(24);
        expect(overview.publishHourDistribution[2]).toEqual({ hour: 2, count: 18 });
        expect(overview.publishHourDistribution[22]).toEqual({ hour: 22, count: 42 });
        expect(overview.userColors).toEqual([
            { color: 'Red', count: 50 },
            { color: 'Orange', count: 30 }
        ]);
        expect(overview.ccfLevels).toEqual([
            { level: 6, count: 15 },
            { level: 8, count: 5 }
        ]);
        expect(overview.topAuthors[1]).toEqual({
            id: 2002,
            name: '未知用户',
            color: 'Gray',
            ccfLevel: 0,
            xcpcLevel: 0,
            badge: null,
            articleCount: 12,
            totalUpvotes: 20,
            totalViews: 300
        });
        expect(overview.topArticlesByUpvote[0].author?.name).toBe('Alice');
        expect(overview.topArticlesByView[0].author).toBeNull();

        expect(mocks.redisSet).toHaveBeenCalledWith(
            SITE_STATS_CACHE_KEY,
            JSON.stringify(overview),
            'EX',
            SITE_STATS_RETENTION_TTL_SECONDS
        );
    });

    it('returns fresh cached overview without querying MariaDB', async () => {
        const now = new Date('2026-11-26T09:30:00.000Z');
        const cached = {
            generatedAt: '2026-11-26T09:00:00.000Z',
            cachedTtlSeconds: SITE_STATS_CACHE_TTL_SECONDS
        };
        mocks.redisGet.mockResolvedValue(JSON.stringify(cached));

        const result = await SiteStatsService.getOverview(now);

        expect(result).toEqual(cached);
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('serves stale cached overview immediately and refreshes in background with Redis lock', async () => {
        const stale = {
            generatedAt: '2026-11-26T07:00:00.000Z',
            cachedTtlSeconds: SITE_STATS_CACHE_TTL_SECONDS,
            summary: { articles: 10 }
        };
        mocks.redisGet.mockResolvedValue(JSON.stringify(stale));
        stubStandardQueries();

        const now = new Date('2026-11-26T09:30:00.000Z');
        const result = await SiteStatsService.getOverview(now);

        expect(result).toEqual(stale);

        await vi.waitFor(() => {
            expect(mocks.redisDel).toHaveBeenCalledWith(SITE_STATS_REFRESH_LOCK_KEY);
        });
        expect(mocks.redisSet).toHaveBeenCalledWith(
            SITE_STATS_REFRESH_LOCK_KEY,
            '1',
            'EX',
            SITE_STATS_REFRESH_LOCK_TTL_SECONDS,
            'NX'
        );
        expect(mocks.query).toHaveBeenCalledTimes(13);
    });

    it('skips background DB refresh when another process already holds the Redis lock', async () => {
        const stale = {
            generatedAt: '2026-11-26T07:00:00.000Z',
            cachedTtlSeconds: SITE_STATS_CACHE_TTL_SECONDS
        };
        mocks.redisGet.mockResolvedValue(JSON.stringify(stale));
        mocks.redisSet.mockResolvedValue(null);

        const result = await SiteStatsService.getOverview(new Date('2026-11-26T09:30:00.000Z'));

        expect(result).toEqual(stale);
        await vi.waitFor(() => {
            expect(mocks.redisSet).toHaveBeenCalledWith(
                SITE_STATS_REFRESH_LOCK_KEY,
                '1',
                'EX',
                SITE_STATS_REFRESH_LOCK_TTL_SECONDS,
                'NX'
            );
        });
        await Promise.resolve();
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.redisDel).not.toHaveBeenCalled();
    });

    it('degrades gracefully when Redis read or write fails', async () => {
        mocks.redisGet.mockRejectedValue(new Error('redis down'));
        mocks.redisSet.mockRejectedValue(new Error('redis readonly'));
        stubStandardQueries();

        const result = await SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));

        expect(result.summary.articles).toBe(150);
        expect(mocks.loggerError).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent cold misses via single-flight and resets after failure', async () => {
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();

        let calls = 0;
        mocks.query.mockImplementation(async () => {
            calls += 1;
            if (calls === 1) {
                await gate;
            }
            return [];
        });

        const first = SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));
        const second = SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));
        release();

        const [r1, r2] = await Promise.all([first, second]);
        expect(r1).toBe(r2);
        expect(calls).toBe(13);

        SiteStatsService.resetMemoryCache();
        mocks.query.mockRejectedValueOnce(new Error('db transient'));
        await expect(SiteStatsService.getOverview()).rejects.toThrow('db transient');

        stubStandardQueries();
        const recovered = await SiteStatsService.getOverview();
        expect(recovered.summary.articles).toBe(150);
    });
});
