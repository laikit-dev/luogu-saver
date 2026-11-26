import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    redisGet: vi.fn(),
    redisSet: vi.fn(),
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
        set: mocks.redisSet
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
    SiteStatsService
} from '../src/services/site-stats.service';

function stubStandardQueries() {
    const results: unknown[][] = [
        [
            {
                category: 2,
                count: '120',
                total_views: '4500',
                total_upvotes: '310',
                total_favors: '95'
            },
            {
                category: 8,
                count: '30',
                total_views: '800',
                total_upvotes: '40',
                total_favors: '12'
            }
        ],
        [{ count: '44' }],
        [{ count: '19' }],
        [{ count: '260' }],
        [{ count: '77' }],
        [
            { day: '2026-11-24', count: '6' },
            { day: '2026-11-26', count: '11' }
        ],
        [
            { hour: 2, count: '18' },
            { hour: 22, count: '42' }
        ],
        [
            { year: 2024, count: '25' },
            { year: 2025, count: '35' }
        ],
        [
            { color: 'Red', count: '50' },
            { color: 'Orange', count: '30' }
        ],
        [
            { level: 6, count: '15' },
            { level: 8, count: '5' }
        ],
        [
            { pid: 'P3372', count: '9' },
            { pid: 'P1001', count: '7' }
        ],
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
        ],
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
        ],
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
    ];

    let index = 0;
    mocks.query.mockImplementation(async () => results[index++] ?? []);
}

describe('SiteStatsService.getOverview', () => {
    beforeEach(() => {
        mocks.query.mockReset();
        mocks.redisGet.mockReset();
        mocks.redisSet.mockReset();
        mocks.loggerError.mockReset();
        mocks.redisGet.mockResolvedValue(null);
        mocks.redisSet.mockResolvedValue('OK');
    });

    it('aggregates archive overview without touching updated_at or content columns', async () => {
        stubStandardQueries();
        const now = new Date(2026, 10, 26, 16, 0, 0);

        const overview = await SiteStatsService.getOverview(now);

        expect(mocks.query).toHaveBeenCalledTimes(14);
        for (const [sql] of mocks.query.mock.calls) {
            expect(String(sql).toLowerCase()).not.toContain('updated_at');
            expect(String(sql).toLowerCase()).not.toMatch(/\bcontent\b/);
        }

        // Verify publish_time bounds are passed to hour and year queries.
        const maxPublishSec = Math.floor(now.getTime() / 1000) + 86400;
        expect(mocks.query.mock.calls[6][1]).toEqual([MIN_PUBLISH_TIME_SECONDS, maxPublishSec]);
        expect(mocks.query.mock.calls[7][1]).toEqual([MIN_PUBLISH_TIME_SECONDS, maxPublishSec]);

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

        expect(overview.recentDailyArchives).toHaveLength(30);
        expect(overview.recentDailyArchives[0].date).toBe('2026-10-28');
        expect(overview.recentDailyArchives[27]).toEqual({ date: '2026-11-24', count: 6 });
        expect(overview.recentDailyArchives[28]).toEqual({ date: '2026-11-25', count: 0 });
        expect(overview.recentDailyArchives[29]).toEqual({ date: '2026-11-26', count: 11 });

        expect(overview.publishHourDistribution).toHaveLength(24);
        expect(overview.publishHourDistribution[2]).toEqual({ hour: 2, count: 18 });
        expect(overview.publishHourDistribution[22]).toEqual({ hour: 22, count: 42 });
        expect(overview.publishHourDistribution[0]).toEqual({ hour: 0, count: 0 });

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
            SITE_STATS_CACHE_TTL_SECONDS
        );
    });

    it('returns cached overview on Redis hit without querying MariaDB', async () => {
        const cached = { generatedAt: '2026-11-26T00:00:00.000Z', cachedTtlSeconds: 600 };
        mocks.redisGet.mockResolvedValue(JSON.stringify(cached));

        const result = await SiteStatsService.getOverview();

        expect(result).toEqual(cached);
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('degrades gracefully when Redis read or write fails', async () => {
        mocks.redisGet.mockRejectedValue(new Error('redis down'));
        mocks.redisSet.mockRejectedValue(new Error('redis readonly'));
        stubStandardQueries();

        const result = await SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));

        expect(result.summary.articles).toBe(150);
        expect(mocks.loggerError).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent cache misses via single-flight and resets after failure', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        let calls = 0;
        mocks.query.mockImplementation(async () => {
            calls += 1;
            await gate;
            return [];
        });

        const first = SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));
        const second = SiteStatsService.getOverview(new Date(2026, 10, 26, 12, 0, 0));
        release();

        const [r1, r2] = await Promise.all([first, second]);
        expect(r1).toBe(r2);
        expect(calls).toBe(14);

        // Next call after rejection must not stay stuck on a rejected promise.
        mocks.query.mockRejectedValueOnce(new Error('db transient'));
        await expect(SiteStatsService.getOverview()).rejects.toThrow('db transient');

        stubStandardQueries();
        const recovered = await SiteStatsService.getOverview();
        expect(recovered.summary.articles).toBe(150);
    });
});
