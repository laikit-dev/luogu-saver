import { AppDataSource } from '@/data-source';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const SITE_STATS_CACHE_KEY = 'stats:overview';
export const SITE_STATS_CACHE_TTL_SECONDS = 600;
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

type CategoryRow = {
    category: string | number;
    count: string | number;
    total_views: string | number;
    total_upvotes: string | number;
    total_favors: string | number;
};

type DailyRow = {
    day: string;
    count: string | number;
};

type HourRow = {
    hour: string | number;
    count: string | number;
};

type YearRow = {
    year: string | number;
    count: string | number;
};

type ColorRow = {
    color: string | null;
    count: string | number;
};

type CcfRow = {
    level: string | number;
    count: string | number;
};

type ProblemRow = {
    pid: string;
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

export class SiteStatsService {
    private static inFlightOverview: Promise<SiteStatsOverviewResponse> | null = null;

    static async getOverview(now: Date = new Date()): Promise<SiteStatsOverviewResponse> {
        try {
            const cached = await redisClient.get(SITE_STATS_CACHE_KEY);
            if (cached) {
                return JSON.parse(cached) as SiteStatsOverviewResponse;
            }
        } catch (error) {
            logger.error({ error }, 'Failed to read site stats overview cache');
        }

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

        // None of these queries reference article.updated_at (corrupted during a historical batch
        // migration) or mediumtext content columns.
        const [
            categoryRows,
            pasteCountRows,
            revisionCountRows,
            commentCountRows,
            judgementCountRows,
            dailyRows,
            hourRows,
            yearRows,
            colorRows,
            ccfRows,
            problemRows,
            topAuthorRows,
            topUpvoteRows,
            topViewRows
        ] = (await Promise.all([
            manager.query(
                `SELECT category,
                        COUNT(*) AS count,
                        COALESCE(SUM(view_count), 0) AS total_views,
                        COALESCE(SUM(upvote), 0) AS total_upvotes,
                        COALESCE(SUM(favor_count), 0) AS total_favors
                 FROM article
                 WHERE deleted = 0
                 GROUP BY category
                 ORDER BY count DESC, category ASC`
            ),
            manager.query(`SELECT COUNT(*) AS count FROM paste WHERE deleted = 0`),
            manager.query(
                `SELECT COUNT(*) AS count
                 FROM article_history h
                 INNER JOIN article a ON a.id = h.article_id
                 WHERE a.deleted = 0 AND h.version > 1`
            ),
            manager.query(
                `SELECT COUNT(*) AS count
                 FROM article_comment c
                 INNER JOIN article a ON a.id = c.article_id
                 WHERE a.deleted = 0`
            ),
            manager.query(`SELECT COUNT(*) AS count FROM judgement_record`),
            manager.query(
                `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
                 FROM article
                 WHERE deleted = 0 AND created_at >= ?
                 GROUP BY day
                 ORDER BY day ASC`,
                [windowStart]
            ),
            manager.query(
                `SELECT MOD(FLOOR((publish_time + ${BEIJING_OFFSET_SECONDS}) / 3600), 24) AS hour,
                        COUNT(*) AS count
                 FROM article
                 WHERE deleted = 0 AND publish_time >= ? AND publish_time <= ?
                 GROUP BY hour
                 ORDER BY hour ASC`,
                [MIN_PUBLISH_TIME_SECONDS, maxPublishTimeSeconds]
            ),
            manager.query(
                `SELECT YEAR(TIMESTAMPADD(SECOND, publish_time + ${BEIJING_OFFSET_SECONDS}, '1970-01-01 00:00:00')) AS year,
                        COUNT(*) AS count
                 FROM article
                 WHERE deleted = 0 AND publish_time >= ? AND publish_time <= ?
                 GROUP BY year
                 ORDER BY year ASC`,
                [MIN_PUBLISH_TIME_SECONDS, maxPublishTimeSeconds]
            ),
            manager.query(
                `SELECT COALESCE(NULLIF(TRIM(color), ''), 'Gray') AS color, COUNT(*) AS count
                 FROM \`user\`
                 GROUP BY COALESCE(NULLIF(TRIM(color), ''), 'Gray')
                 ORDER BY count DESC, color ASC`
            ),
            manager.query(
                `SELECT ccf_level AS level, COUNT(*) AS count
                 FROM \`user\`
                 WHERE ccf_level > 0
                 GROUP BY ccf_level
                 ORDER BY ccf_level ASC`
            ),
            manager.query(
                `SELECT TRIM(solution_for_pid) AS pid, COUNT(*) AS count
                 FROM article
                 WHERE deleted = 0
                   AND solution_for_pid IS NOT NULL
                   AND TRIM(solution_for_pid) != ''
                 GROUP BY TRIM(solution_for_pid)
                 ORDER BY count DESC, pid ASC
                 LIMIT 10`
            ),
            manager.query(
                `SELECT t.author_id AS id,
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
                     FROM article
                     WHERE deleted = 0
                     GROUP BY author_id
                     ORDER BY article_count DESC, total_upvotes DESC, author_id ASC
                     LIMIT 10
                 ) t
                 LEFT JOIN \`user\` u ON u.id = t.author_id
                 ORDER BY t.article_count DESC, t.total_upvotes DESC, t.author_id ASC`
            ),
            manager.query(
                `SELECT a.id, a.title, a.category, a.upvote, a.favor_count, a.view_count,
                        u.id AS author_id, u.name AS author_name, u.color AS author_color,
                        u.ccf_level AS author_ccf_level, u.xcpc_level AS author_xcpc_level, u.badge AS author_badge
                 FROM (
                     SELECT id, title, category, upvote, favor_count, view_count, author_id
                     FROM article
                     WHERE deleted = 0
                     ORDER BY upvote DESC, id DESC
                     LIMIT 8
                 ) a
                 LEFT JOIN \`user\` u ON u.id = a.author_id
                 ORDER BY a.upvote DESC, a.id DESC`
            ),
            manager.query(
                `SELECT a.id, a.title, a.category, a.upvote, a.favor_count, a.view_count,
                        u.id AS author_id, u.name AS author_name, u.color AS author_color,
                        u.ccf_level AS author_ccf_level, u.xcpc_level AS author_xcpc_level, u.badge AS author_badge
                 FROM (
                     SELECT id, title, category, upvote, favor_count, view_count, author_id
                     FROM article
                     WHERE deleted = 0
                     ORDER BY view_count DESC, id DESC
                     LIMIT 8
                 ) a
                 LEFT JOIN \`user\` u ON u.id = a.author_id
                 ORDER BY a.view_count DESC, a.id DESC`
            )
        ])) as [
            CategoryRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            CountRow[],
            DailyRow[],
            HourRow[],
            YearRow[],
            ColorRow[],
            CcfRow[],
            ProblemRow[],
            TopAuthorRow[],
            TopArticleRow[],
            TopArticleRow[]
        ];

        const categories: CategoryStatItem[] = categoryRows.map(row => ({
            category: Number(row.category),
            count: Number(row.count),
            totalViews: Number(row.total_views),
            totalUpvotes: Number(row.total_upvotes),
            totalFavors: Number(row.total_favors)
        }));

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
        for (const row of hourRows) {
            const hour = Number(row.hour);
            if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
                hourMap.set(hour, Number(row.count));
            }
        }
        const publishHourDistribution: HourlyPublishPoint[] = Array.from(
            { length: 24 },
            (_, hour) => ({
                hour,
                count: hourMap.get(hour) ?? 0
            })
        );

        const publishYearDistribution: YearlyPublishPoint[] = yearRows.map(row => ({
            year: Number(row.year),
            count: Number(row.count)
        }));

        const userColors: UserColorStatItem[] = colorRows.map(row => ({
            color: row.color?.trim() || 'Gray',
            count: Number(row.count)
        }));

        const ccfLevels: CcfLevelStatItem[] = ccfRows.map(row => ({
            level: Number(row.level),
            count: Number(row.count)
        }));

        const topProblems: TopProblemStatItem[] = problemRows.map(row => ({
            pid: row.pid,
            solutionCount: Number(row.count)
        }));

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

        const summary: SiteStatsSummary = {
            articles: categories.reduce((sum, item) => sum + item.count, 0),
            pastes: Number(pasteCountRows[0]?.count ?? 0),
            users: userColors.reduce((sum, item) => sum + item.count, 0),
            articleRevisions: Number(revisionCountRows[0]?.count ?? 0),
            comments: Number(commentCountRows[0]?.count ?? 0),
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

        try {
            await redisClient.set(
                SITE_STATS_CACHE_KEY,
                JSON.stringify(payload),
                'EX',
                SITE_STATS_CACHE_TTL_SECONDS
            );
        } catch (error) {
            logger.error({ error }, 'Failed to write site stats overview cache');
        }

        return payload;
    }
}
