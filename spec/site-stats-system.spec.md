# Site Statistics System Specification

## 1. Scope

This specification defines the public archive statistics endpoint `GET /stats/overview` and its backing service `SiteStatsService`.

Public queue telemetry (`GET /stats/queues` and Socket.IO room `stats:queues`) remains specified by `task-queue.spec.md` and `socket-system.spec.md`.

## 2. Data Integrity Invariants

1. `SiteStatsService` SHALL NOT query, filter, group by, or order by `article.updated_at`. Historical batch corruption made `article.updated_at` non-representative across long time windows.
2. `SiteStatsService` SHALL NOT read `article.content`, `paste.content`, or `article_comment.content`.
3. `SiteStatsService` SHALL exclude soft-deleted articles (`article.deleted = 0`) and soft-deleted pastes (`paste.deleted = 0`) from every count, distribution, and ranking.
4. `SiteStatsService` SHALL NOT expose `registered_user`, deletion requests, tokens, or unpublished/private metadata.
5. `article_history` revision counts SHALL count only rows with `version > 1` joined to non-deleted articles (`article.deleted = 0`).
6. `article_comment` counts SHALL count only rows joined to non-deleted articles (`article.deleted = 0`).
7. Statistics derived from `article.publish_time` SHALL include only non-deleted rows whose `publish_time` satisfies `1356998400 <= publish_time <= floor(nowMs / 1000) + 86400` (`2013-01-01T00:00:00Z` through `now + 1 day`). Rows with `NULL` or out-of-range `publish_time` SHALL be excluded from publish-time distributions and SHALL NOT be substituted with `created_at` or `updated_at`.

## 3. HTTP Endpoint

### 3.1 `GET /stats/overview`

- Authentication: none (public read-only endpoint).
- Response: HTTP 200 with standard envelope `{ code: 200, message: "success", data: SiteStatsOverviewResponse }`.

```typescript
interface SiteStatsSummary {
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

interface CategoryStatItem {
    category: number;
    count: number;
    totalViews: number;
    totalUpvotes: number;
    totalFavors: number;
}

interface DailyArchivePoint {
    date: string; // YYYY-MM-DD in server local date matching article.created_at
    count: number;
}

interface HourlyPublishPoint {
    hour: number; // integer 0..23 in UTC+8
    count: number;
}

interface YearlyPublishPoint {
    year: number; // integer >= 2013 in UTC+8
    count: number;
}

interface UserColorStatItem {
    color: string;
    count: number;
}

interface CcfLevelStatItem {
    level: number; // integer >= 1
    count: number;
}

interface TopProblemStatItem {
    pid: string;
    solutionCount: number;
}

interface StatsAuthorIdentity {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

interface TopAuthorStatItem extends StatsAuthorIdentity {
    articleCount: number;
    totalUpvotes: number;
    totalViews: number;
}

interface TopArticleStatItem {
    id: string;
    title: string;
    category: number;
    upvote: number;
    favorCount: number;
    viewCount: number;
    author: StatsAuthorIdentity | null;
}

interface SiteStatsOverviewResponse {
    generatedAt: string; // ISO-8601 UTC string
    cachedTtlSeconds: number; // 3600 (freshness window before background revalidation)
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
```

## 4. Computation Rules

### 4.1 Summary Totals

- `summary.articles`, `summary.totalViews`, `summary.totalUpvotes`, and `summary.totalFavors` SHALL equal the respective sums over `categories`.
- `summary.users` SHALL equal the sum of `count` over `userColors`.
- `summary.publishedTimeKnown` SHALL equal the sum of `count` over `publishHourDistribution`.
- `summary.pastes`, `summary.articleRevisions`, `summary.comments`, and `summary.judgements` SHALL be non-negative integers.

### 4.2 Distributions

1. `categories`: grouped by `article.category` for non-deleted articles, sorted by `count DESC, category ASC`.
2. `recentDailyArchives`: exactly 30 contiguous calendar days ending on the current server local date, derived from `article.created_at >= windowStart` (where `windowStart` is local `00:00:00.000` 29 days prior to today) for non-deleted articles. Days with no archived articles SHALL have `count = 0`.
3. `publishHourDistribution`: exactly 24 entries for `hour = 0..23` in ascending order, computed in UTC+8 via `MOD(FLOOR((publish_time + 28800) / 3600), 24)`. Hours with no matching articles SHALL have `count = 0`.
4. `publishYearDistribution`: grouped by UTC+8 year via `YEAR(TIMESTAMPADD(SECOND, publish_time + 28800, '1970-01-01 00:00:00'))`, sorted by `year ASC`.
5. `userColors`: grouped by `user.color` (blank/null normalized to `'Gray'`), sorted by `count DESC, color ASC`.
6. `ccfLevels`: grouped by `user.ccf_level` where `ccf_level > 0`, sorted by `level ASC`.

### 4.3 Rankings

1. `topProblems`: at most 10 entries grouped by trimmed non-empty `article.solution_for_pid` for non-deleted articles, sorted by `solutionCount DESC, pid ASC`.
2. `topAuthors`: at most 10 entries grouped by `article.author_id` for non-deleted articles, left-joined to `user`, sorted by `articleCount DESC, totalUpvotes DESC, id ASC`. Missing `user` rows SHALL fall back to `name = '未知用户'`, `color = 'Gray'`, `ccfLevel = 0`, `xcpcLevel = 0`, `badge = null`.
3. `topArticlesByUpvote`: at most 8 non-deleted articles sorted by `upvote DESC, id DESC`, left-joined to `user`. Missing `user` rows SHALL yield `author = null`.
4. `topArticlesByView`: at most 8 non-deleted articles sorted by `view_count DESC, id DESC`, left-joined to `user`. Missing `user` rows SHALL yield `author = null`.

## 5. Query Execution, Caching, and Concurrency

1. `SiteStatsService` SHALL execute its 13 independent MariaDB aggregation queries with a bounded
   concurrency of `3` (`runWithConcurrency(..., 3)`), keeping cold-refresh latency low while
   leaving the majority of the default 10-connection MariaDB pool available for live traffic.
2. Every aggregation query in `SiteStatsService` SHALL avoid clustered-table scans on `article`,
   `user`, `article_history`, `article_comment`, and `paste` by using covering secondary indexes:
    - Combine `categories` and `topProblems` into one index-only scan on
      `idx_articles_stats_category_pid (deleted, category, solution_for_pid, view_count, upvote, favor_count)`.
    - Compute `recentDailyArchives` via an index-only scan on
      `idx_articles_author_deleted_created_at_id` rather than `idx_created_at` bookmark lookups.
    - Combine `publishYearDistribution` and `publishHourDistribution` into one index-only scan on
      `idx_articles_author_deleted_publish_time_id`.
    - Compute `topAuthors` via one index-only scan on
      `idx_articles_stats_author_metrics (deleted, author_id, upvote, view_count)` returning the top
      10 authors ordered by `article_count DESC, total_upvotes DESC, author_id ASC`, left-joined to
      `user` for those 10 rows only.
    - Compute `articleRevisions` as the index-only count of `article_history` rows with
      `version > 1` on `idx_article_id_version` minus deleted-article revisions joined via
      `article` (`deleted = 1`, `idx_articles_deleted_view_count`) `STRAIGHT_JOIN`
      `article_history` (`idx_article_id_version`), clamped to `>= 0`.
    - Compute `comments` as the index-only count of `article_comment` on
      `idx_article_comment_article` minus deleted-article comments joined via `article`
      (`deleted = 1`, `idx_articles_deleted_view_count`) `STRAIGHT_JOIN` `article_comment`
      (`idx_article_comment_article`), clamped to `>= 0`.
    - Combine `userColors` and `ccfLevels` into one index-only scan on
      `idx_user_color_ccf_level (color, ccf_level)`.
3. `SiteStatsService.getOverview()` SHALL cache the serialized JSON response in Redis at key
   `stats:overview` with a retention TTL of `86400` seconds (24 hours) and a freshness window of
   `3600` seconds (1 hour, reported in `cachedTtlSeconds`).
4. Stale-while-revalidate behavior:
    - When a cached entry exists and `nowMs - Date.parse(cached.generatedAt) < 3600_000`, return
      the cached entry immediately without querying MariaDB.
    - When a cached entry exists and is stale (`age >= 3600_000` or unparseable `generatedAt`),
      return the stale entry immediately and trigger at most one background refresh guarded by both
      an in-process single-flight promise and a Redis lock key `stats:overview:refresh_lock`
      (`SET ... EX 300 NX`). If another process holds the lock, the background refresh SHALL skip
      querying MariaDB.
    - When no cached entry exists in Redis, fall back to any in-process cached snapshot if present
      (using the same freshness/SWR rule); otherwise run the single-flight computation and await it.
5. On Redis read failure or invalid cached JSON, the service SHALL log the error and fall back to
   the in-process cache or compute fresh data from MariaDB.
6. On Redis write or lock failure, the service SHALL log the error without failing the response.
7. The in-flight slot SHALL be cleared when the computation settles, whether fulfilled or rejected,
   and the Redis refresh lock SHALL be released in a `finally` block when acquired.

## 6. File Locations

- Site stats service: `packages/backend/src/services/site-stats.service.ts`
- Stats router: `packages/backend/src/routers/stats.router.ts`
- Frontend API client: `packages/frontend/src/api/statistic.ts`
- Frontend view: `packages/frontend/src/views/statistic/StatisticView.vue`
