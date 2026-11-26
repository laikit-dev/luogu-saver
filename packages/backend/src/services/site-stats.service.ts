import { AppDataSource } from '@/data-source';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { runWithConcurrency } from '@/utils/concurrency';

export const SITE_STATS_CACHE_KEY = 'stats:overview';
export const SITE_STATS_REFRESH_LOCK_KEY = 'stats:overview:refresh_lock';
export const SITE_STATS_CACHE_TTL_SECONDS = 3600;
export const SITE_STATS_RETENTION_TTL_SECONDS = 86400;
export const SITE_STATS_REFRESH_LOCK_TTL_SECONDS = 300;
export const SITE_STATS_QUERY_CONCURRENCY = 3;
export const MIN_PUBLISH_TIME_SECONDS = 1356998400; // 2013-01-01T00:00:00Z
const RECENT_ARCHIVE_DAYS = 30;
const BEIJING_OFFSET_SECONDS = 8 * 3600;

export interface SiteStatsSummary {
    articles: number;
    pastes: number;
    users: number;
    articleRevisions: number;
    comments: number;
    judgements: number;
    totalViews: number;
    totalUpvotes: number;
    totalFavors: number;
    publishedTimeKnown: number;
}

export interface CategoryStatItem {
    category: number;
    count: number;
    totalViews: number;
    totalUpvotes: number;
    totalFavors: number;
}

export interface DailyArchivePoint {
    date: string;
    count: number;
}

export interface HourlyPublishPoint {
    hour: number;
    count: number;
}

export interface YearlyPublishPoint {
    year: number;
    count: number;
}

export interface UserColorStatItem {
    color: string;
    count: number;
}

export interface CcfLevelStatItem {
    level: number;
    count: number;
}

export interface TopProblemStatItem {
    pid: string;
    solutionCount: number;
}

export interface StatsAuthorIdentity {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

export interface TopAuthorStatItem extends StatsAuthorIdentity {
    articleCount: number;
    totalUpvotes: number;
    totalViews: number;
}

export interface TopArticleStatItem {
    id: string;
    title: string;
    category: number;
    upvote: number;
    favorCount: number;
    viewCount: number;
    author: StatsAuthorIdentity | null;
}

export interface SiteStatsOverviewResponse {
    generatedAt: string;
    cachedTtlSeconds: number;
    summary: SiteStatsSummary;
    categories: CategoryStatItem[];
    recentDailyArchives: DailyArchivePoint[];
    publishHourDistribution: HourlyPublishPoint[];
    publishYearDistribution: YearlyPublishPoint[];
    userColors: UserColorStatItem[];
    ccfLevels: CcfLevelStatItem[];
    topProblems: TopProblemStatItem[];
    topAuthors: TopAuthorStatItem[];
    topArticlesByUpvote: TopArticleStatItem[];
    topArticlesByView: TopArticleStatItem[];
}

type CountRow = { count: string | number };

type CategoryProblemRow = {
    category: string | number;
    pid: string | null;
    count: string | number;
    total_views: string | number;
    total_upvotes: string | number;
    total_favors: string | number;
};

type DailyRow = {
    day: string;
    count: string | number;
};

type PublishTimeRow = {
    year: string | number;
    hour: string | number;
    count: string | number;
};

type UserEcoRow = {
    color: string | null;
    level: string | number | null;
    count: string | number;
};

type TopAuthorRow = {
    id: string | number;
    name: string | null;
    color: string | null;
    ccf_level: string | number | null;
    xcpc_level: string | number | null;
    badge: string | null;
    article_count: string | number;
    total_upvotes: string | number;
    total_views: string | number;
};

type TopArticleRow = {
    id: string;
    title: string;
    category: string | number;
    upvote: string | number;
    favor_count: string | number;
    view_count: string | number;
    author_id: string | number | null;
    author_name: string | null;
    author_color: string | null;
    author_ccf_level: string | number | null;
    author_xcpc_level: string | number | null;
    author_badge: string | null;
};

function formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function mapTopArticleRows(rows: TopArticleRow[]): TopArticleStatItem[] {
    return rows.map(row => ({
        id: row.id,
        title: row.title,
        category: Number(row.category),
        upvote: Number(row.upvote),
        favorCount: Number(row.favor_count),
        viewCount: Number(row.view_count),
        author:
            row.author_id != null && row.author_name != null
                ? {
                      id: Number(row.author_id),
                      name: row.author_name,
                      color: row.author_color?.trim() || 'Gray',
                      ccfLevel: Number(row.author_ccf_level ?? 0),
                      xcpcLevel: Number(row.author_xcpc_level ?? 0),
                      badge: row.author_badge ?? null
                  }
                : null
    }));
}

function isFreshSnapshot(snapshot: SiteStatsOverviewResponse, now: Date): boolean {
    const generatedAtMs = Date.parse(snapshot.generatedAt);
    if (!Number.isFinite(generatedAtMs)) {
        return false;
    }
    return now.getTime() - generatedAtMs < SITE_STATS_CACHE_TTL_SECONDS * 1000;
}

export class SiteStatsService {
    private static inFlightOverview: Promise<SiteStatsOverviewResponse> | null = null;
    private static lastOverview: SiteStatsOverviewResponse | null = null;

    static resetMemoryCache(): void {
        this.lastOverview = null;
        this.inFlightOverview = null;
    }

    static async getOverview(now: Date = new Date()): Promise<SiteStatsOverviewResponse> {
        let cached: SiteStatsOverviewResponse | null = null;

        try {
            const raw = await redisClient.get(SITE_STATS_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as SiteStatsOverviewResponse;
                if (parsed && typeof parsed.generatedAt === 'string') {
                    cached = parsed;
                    this.lastOverview = parsed;
                }
            }
        } catch (error) {
            logger.error({ error }, 'Failed to read site stats overview cache');
        }

        const candidate = cached ?? this.lastOverview;
        if (candidate) {
            if (!isFreshSnapshot(candidate, now)) {
                this.triggerBackgroundRefresh(now);
            }
            return candidate;
        }

        return this.runSingleFlight(now);
    }

    private static triggerBackgroundRefresh(now: Date): void {
        if (this.inFlightOverview) {
            return;
        }

        void (async () => {
            let lockAcquired = false;
            try {
                const lockResult = await redisClient.set(
                    SITE_STATS_REFRESH_LOCK_KEY,
                    '1',
                    'EX',
                    SITE_STATS_REFRESH_LOCK_TTL_SECONDS,
                    'NX'
                );
                if (lockResult !== 'OK') {
                    return;
                }
                lockAcquired = true;
            } catch (error) {
                logger.error({ error }, 'Failed to acquire site stats refresh lock');
            }

            try {
                await this.runSingleFlight(now);
            } catch (error) {
                logger.error({ error }, 'Failed to refresh site stats overview in background');
            } finally {
                if (lockAcquired) {
                    try {
                        await redisClient.del(SITE_STATS_REFRESH_LOCK_KEY);
                    } catch (error) {
                        logger.error({ error }, 'Failed to release site stats refresh lock');
                    }
                }
            }
        })();
    }

    private static runSingleFlight(now: Date): Promise<SiteStatsOverviewResponse> {
        if (!this.inFlightOverview) {
            this.inFlightOverview = this.computeOverview(now).finally(() => {
                this.inFlightOverview = null;
            });
        }
        return this.inFlightOverview;
    }

    private static async computeOverview(now: Date): Promise<SiteStatsOverviewResponse> {
        const manager = AppDataSource.manager;
        // Aligns windowStart with mysql2's local-timezone DATETIME serialization for created_at.
        const windowStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - (RECENT_ARCHIVE_DAYS - 1),
            0,
            0,
            0,
            0
        );
        const maxPublishTimeSeconds = Math.floor(now.getTime() / 1000) + 86400;

        // Every query below is covered by secondary indexes (zero clustered scans of article/user/
        // history/comment/paste) and bounded to 3 concurrent connections so refreshes finish fast
        // without starving the default 10-connection MariaDB pool.
        const queries: Array<{ sql: string; params?: unknown[] }> = [
            {
                sql: `SELECT category,
                             CASE
                                 WHEN solution_for_pid IS NOT NULL AND TRIM(solution_for_pid) != ''
                                     THEN TRIM(solution_for_pid)
                                 ELSE NULL
                             END AS pid,
                             COUNT(*) AS count,
                             COALESCE(SUM(view_count), 0) AS total_views,
                             COALESCE(SUM(upvote), 0) AS total_upvotes,
                             COALESCE(SUM(favor_count), 0) AS total_favors
                      FROM article FORCE INDEX (idx_articles_stats_category_pid)
                      WHERE deleted = 0
                      GROUP BY category,
                               CASE
                                   WHEN solution_for_pid IS NOT NULL AND TRIM(solution_for_pid) != ''
                                       THEN TRIM(solution_for_pid)
                                   ELSE NULL
                               END`
            },
            {
                sql: `SELECT COUNT(*) AS count FROM paste FORCE INDEX (idx_paste_deleted) WHERE deleted = 0`
            },
            {
                sql: `SELECT COUNT(*) AS count
                      FROM article_history FORCE INDEX (idx_article_id_version)
                      WHERE version > 1`
            },
            {
                sql: `SELECT COUNT(*) AS count
                      FROM article a FORCE INDEX (idx_articles_deleted_view_count)
                      STRAIGHT_JOIN article_history h FORCE INDEX (idx_article_id_version)
                          ON h.article_id = a.id AND h.version > 1
                      WHERE a.deleted = 1`
            },
            {
                sql: `SELECT COUNT(*) AS count
                      FROM article_comment FORCE INDEX (idx_article_comment_article)`
            },
            {
                sql: `SELECT COUNT(*) AS count
                      FROM article a FORCE INDEX (idx_articles_deleted_view_count)
                      STRAIGHT_JOIN article_comment c FORCE INDEX (idx_article_comment_article)
                          ON c.article_id = a.id
                      WHERE a.deleted = 1`
            },
            {
                sql: `SELECT COUNT(*) AS count FROM judgement_record`
            },
            {
                sql: `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
                      FROM article FORCE INDEX (idx_articles_author_deleted_created_at_id)
                      WHERE deleted = 0 AND created_at >= ?
                      GROUP BY day
                      ORDER BY day ASC`,
                params: [windowStart]
            },
            {
                sql: `SELECT YEAR(TIMESTAMPADD(SECOND, publish_time + ${BEIJING_OFFSET_SECONDS}, '1970-01-01 00:00:00')) AS year,
                             MOD(FLOOR((publish_time + ${BEIJING_OFFSET_SECONDS}) / 3600), 24) AS hour,
                             COUNT(*) AS count
                      FROM article FORCE INDEX (idx_articles_author_deleted_publish_time_id)
                      WHERE deleted = 0 AND publish_time >= ? AND publish_time <= ?
                      GROUP BY YEAR(TIMESTAMPADD(SECOND, publish_time + ${BEIJING_OFFSET_SECONDS}, '1970-01-01 00:00:00')),
                               MOD(FLOOR((publish_time + ${BEIJING_OFFSET_SECONDS}) / 3600), 24)`,
                params: [MIN_PUBLISH_TIME_SECONDS, maxPublishTimeSeconds]
            },
            {
                sql: `SELECT COALESCE(NULLIF(TRIM(color), ''), 'Gray') AS color,
                             ccf_level AS level,
                             COUNT(*) AS count
                      FROM \`user\` FORCE INDEX (idx_user_color_ccf_level)
                      GROUP BY COALESCE(NULLIF(TRIM(color), ''), 'Gray'), ccf_level`
            },
            {
                sql: `SELECT t.author_id AS id,
                             u.name AS name,
                             u.color AS color,
                             u.ccf_level AS ccf_level,
                             u.xcpc_level AS xcpc_level,
                             u.badge AS badge,
                             t.article_count AS article_count,
                             t.total_upvotes AS total_upvotes,
                             t.total_views AS total_views
                      FROM (
                          SELECT author_id,
                                 COUNT(*) AS article_count,
                                 COALESCE(SUM(upvote), 0) AS total_upvotes,
                                 COALESCE(SUM(view_count), 0) AS total_views
                          FROM article FORCE INDEX (idx_articles_stats_author_metrics)
                          WHERE deleted = 0
                          GROUP BY author_id
                          ORDER BY article_count DESC, total_upvotes DESC, author_id ASC
                          LIMIT 10
                      ) t
                      LEFT JOIN \`user\` u ON u.id = t.author_id
                      ORDER BY t.article_count DESC, t.total_upvotes DESC, t.author_id ASC`
            },
            {
                sql: `SELECT a.id, a.title, a.category, a.upvote, a.favor_count, a.view_count,
                             u.id AS author_id, u.name AS author_name, u.color AS author_color,
                             u.ccf_level AS author_ccf_level, u.xcpc_level AS author_xcpc_level, u.badge AS author_badge
                      FROM (
                          SELECT id, title, category, upvote, favor_count, view_count, author_id
                          FROM article FORCE INDEX (idx_articles_deleted_upvote)
                          WHERE deleted = 0
                          ORDER BY upvote DESC, id DESC
                          LIMIT 8
                      ) a
                      LEFT JOIN \`user\` u ON u.id = a.author_id
                      ORDER BY a.upvote DESC, a.id DESC`
            },
            {
                sql: `SELECT a.id, a.title, a.category, a.upvote, a.favor_count, a.view_count,
                             u.id AS author_id, u.name AS author_name, u.color AS author_color,
                             u.ccf_level AS author_ccf_level, u.xcpc_level AS author_xcpc_level, u.badge AS author_badge
                      FROM (
                          SELECT id, title, category, upvote, favor_count, view_count, author_id
                          FROM article FORCE INDEX (idx_articles_deleted_view_count)
                          WHERE deleted = 0
                          ORDER BY view_count DESC, id DESC
                          LIMIT 8
                      ) a
                      LEFT JOIN \`user\` u ON u.id = a.author_id
                      ORDER BY a.view_count DESC, a.id DESC`
            }
        ];

        const results: unknown[] = new Array(queries.length);
        await runWithConcurrency(queries, SITE_STATS_QUERY_CONCURRENCY, async (q, index) => {
            results[index] = q.params
                ? await manager.query(q.sql, q.params)
                : await manager.query(q.sql);
        });

        const [
            categoryProblemRows,
            pasteCountRows,
            totalRevisionRows,
            deletedRevisionRows,
            totalCommentRows,
            deletedCommentRows,
            judgementCountRows,
            dailyRows,
            publishTimeRows,
            userEcoRows,
            topAuthorRows,
            topUpvoteRows,
            topViewRows
        ] = results as [
            CategoryProblemRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            DailyRow[],
            PublishTimeRow[],
            UserEcoRow[],
            TopAuthorRow[],
            TopArticleRow[],
            TopArticleRow[]
        ];

        const categoryMap = new Map<number, CategoryStatItem>();
        const problemMap = new Map<string, number>();
        for (const row of categoryProblemRows) {
            const category = Number(row.category);
            const count = Number(row.count);
            const views = Number(row.total_views);
            const upvotes = Number(row.total_upvotes);
            const favors = Number(row.total_favors);

            const existing = categoryMap.get(category);
            if (existing) {
                existing.count += count;
                existing.totalViews += views;
                existing.totalUpvotes += upvotes;
                existing.totalFavors += favors;
            } else {
                categoryMap.set(category, {
                    category,
                    count,
                    totalViews: views,
                    totalUpvotes: upvotes,
                    totalFavors: favors
                });
            }

            if (row.pid) {
                problemMap.set(row.pid, (problemMap.get(row.pid) ?? 0) + count);
            }
        }

        const categories = Array.from(categoryMap.values()).sort(
            (a, b) => b.count - a.count || a.category - b.category
        );
        const topProblems: TopProblemStatItem[] = Array.from(problemMap.entries())
            .map(([pid, solutionCount]) => ({ pid, solutionCount }))
            .sort((a, b) => b.solutionCount - a.solutionCount || a.pid.localeCompare(b.pid))
            .slice(0, 10);

        const dailyMap = new Map<string, number>();
        for (const row of dailyRows) {
            dailyMap.set(String(row.day), Number(row.count));
        }
        const recentDailyArchives: DailyArchivePoint[] = [];
        for (let i = 0; i < RECENT_ARCHIVE_DAYS; i++) {
            const d = new Date(
                windowStart.getFullYear(),
                windowStart.getMonth(),
                windowStart.getDate() + i
            );
            const dateKey = formatLocalDate(d);
            recentDailyArchives.push({
                date: dateKey,
                count: dailyMap.get(dateKey) ?? 0
            });
        }

        const hourMap = new Map<number, number>();
        const yearMap = new Map<number, number>();
        for (const row of publishTimeRows) {
            const year = Number(row.year);
            const hour = Number(row.hour);
            const count = Number(row.count);
            if (Number.isInteger(year)) {
                yearMap.set(year, (yearMap.get(year) ?? 0) + count);
            }
            if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
                hourMap.set(hour, (hourMap.get(hour) ?? 0) + count);
            }
        }
        const publishHourDistribution: HourlyPublishPoint[] = Array.from(
            { length: 24 },
            (_, hour) => ({
                hour,
                count: hourMap.get(hour) ?? 0
            })
        );
        const publishYearDistribution: YearlyPublishPoint[] = Array.from(yearMap.entries())
            .map(([year, count]) => ({ year, count }))
            .sort((a, b) => a.year - b.year);

        const colorMap = new Map<string, number>();
        const ccfMap = new Map<number, number>();
        for (const row of userEcoRows) {
            const color = row.color?.trim() || 'Gray';
            const level = Number(row.level ?? 0);
            const count = Number(row.count);
            colorMap.set(color, (colorMap.get(color) ?? 0) + count);
            if (Number.isInteger(level) && level > 0) {
                ccfMap.set(level, (ccfMap.get(level) ?? 0) + count);
            }
        }
        const userColors: UserColorStatItem[] = Array.from(colorMap.entries())
            .map(([color, count]) => ({ color, count }))
            .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
        const ccfLevels: CcfLevelStatItem[] = Array.from(ccfMap.entries())
            .map(([level, count]) => ({ level, count }))
            .sort((a, b) => a.level - b.level);

        const topAuthors: TopAuthorStatItem[] = topAuthorRows.map(row => ({
            id: Number(row.id),
            name: row.name || '未知用户',
            color: row.color?.trim() || 'Gray',
            ccfLevel: Number(row.ccf_level ?? 0),
            xcpcLevel: Number(row.xcpc_level ?? 0),
            badge: row.badge ?? null,
            articleCount: Number(row.article_count),
            totalUpvotes: Number(row.total_upvotes),
            totalViews: Number(row.total_views)
        }));

        const articleRevisions = Math.max(
            0,
            Number(totalRevisionRows[0]?.count ?? 0) - Number(deletedRevisionRows[0]?.count ?? 0)
        );
        const comments = Math.max(
            0,
            Number(totalCommentRows[0]?.count ?? 0) - Number(deletedCommentRows[0]?.count ?? 0)
        );

        const summary: SiteStatsSummary = {
            articles: categories.reduce((sum, item) => sum + item.count, 0),
            pastes: Number(pasteCountRows[0]?.count ?? 0),
            users: userColors.reduce((sum, item) => sum + item.count, 0),
            articleRevisions,
            comments,
            judgements: Number(judgementCountRows[0]?.count ?? 0),
            totalViews: categories.reduce((sum, item) => sum + item.totalViews, 0),
            totalUpvotes: categories.reduce((sum, item) => sum + item.totalUpvotes, 0),
            totalFavors: categories.reduce((sum, item) => sum + item.totalFavors, 0),
            publishedTimeKnown: publishHourDistribution.reduce((sum, item) => sum + item.count, 0)
        };

        const payload: SiteStatsOverviewResponse = {
            generatedAt: now.toISOString(),
            cachedTtlSeconds: SITE_STATS_CACHE_TTL_SECONDS,
            summary,
            categories,
            recentDailyArchives,
            publishHourDistribution,
            publishYearDistribution,
            userColors,
            ccfLevels,
            topProblems,
            topAuthors,
            topArticlesByUpvote: mapTopArticleRows(topUpvoteRows),
            topArticlesByView: mapTopArticleRows(topViewRows)
        };

        this.lastOverview = payload;

        try {
            await redisClient.set(
                SITE_STATS_CACHE_KEY,
                JSON.stringify(payload),
                'EX',
                SITE_STATS_RETENTION_TTL_SECONDS
            );
        } catch (error) {
            logger.error({ error }, 'Failed to write site stats overview cache');
        }

        return payload;
    }
}
