# Article System Specification

## 1. Overview

The article system manages articles archived from Luogu. It provides storage, retrieval, caching, history tracking, and content rendering.

## 2. Article Entity

### 2.1 Schema

Table name: `article`

| Column                | Type         | Constraints             | Description                        |
| --------------------- | ------------ | ----------------------- | ---------------------------------- |
| `id`                  | VARCHAR(8)   | PRIMARY KEY             | Article ID (Luogu LID)             |
| `title`               | VARCHAR      | NOT NULL                | Article title                      |
| `content`             | MEDIUMTEXT   | NOT NULL                | Markdown content                   |
| `author_id`           | INT UNSIGNED | NOT NULL, FK -> user.id | Author user ID                     |
| `category`            | INT          | NOT NULL                | Article category (ArticleCategory) |
| `upvote`              | INT          | DEFAULT 0               | Upvote count                       |
| `favor_count`         | INT          | DEFAULT 0               | Favorite count                     |
| `solution_for_pid`    | VARCHAR(50)  | NULLABLE                | Problem ID if this is a solution   |
| `priority`            | INT          | DEFAULT 0               | Display priority                   |
| `deleted`             | TINYINT      | DEFAULT 0               | Soft delete flag                   |
| `tags`                | JSON         | NOT NULL                | Array of tag strings               |
| `publish_time`        | INT UNSIGNED | NULLABLE                | Luogu publish time in Unix seconds |
| `created_at`          | DATETIME     | NOT NULL                | Local persistence time             |
| `updated_at`          | DATETIME     | NOT NULL                | Local update time                  |
| `delete_reason`       | VARCHAR      | NULLABLE                | Reason for deletion                |
| `content_hash`        | VARCHAR      | NULLABLE                | SHA-256 hash of content            |
| `view_count`          | INT          | DEFAULT 0               | View count                         |
| `summary`             | TEXT         | NULLABLE                | LLM-generated article summary      |
| `comments_fetched_at` | DATETIME     | NULLABLE                | Last successful comment fetch time |

### 2.2 Indexes

- `idx_articles_author`: (`author_id`)
- `idx_articles_deleted_priority_updated_at`: (`deleted`, `priority`, `updated_at`)
- `idx_articles_deleted_view_count`: (`deleted`, `view_count`)
- `idx_created_at`: (`created_at`)
- `idx_priority`: (`priority`)
- `idx_updated_at`: (`updated_at`)
- `idx_articles_deleted_updated_at_id`: (`deleted`, `updated_at`, `id`)

### 2.3 ArticleCategory Enum

| Value | Name       | Description         |
| ----- | ---------- | ------------------- |
| 1     | RECORD     | Competition records |
| 2     | SOLUTION   | Problem solutions   |
| 3     | TECHNOLOGY | Technical articles  |
| 4     | ALGORITHM  | Algorithm tutorials |
| 5     | LIFE       | Life/personal       |
| 6     | STUDY      | Study notes         |
| 7     | AMUSEMENT  | Entertainment       |
| 8     | GOSSIP     | Discussion/chat     |

## 3. Article History Entity

### 3.1 Schema

Table name: `article_history`

| Column       | Type       | Constraints     | Description                |
| ------------ | ---------- | --------------- | -------------------------- |
| `id`         | INT        | PRIMARY KEY, AI | Auto-increment ID          |
| `articleId`  | VARCHAR(8) | NOT NULL        | Reference to article.id    |
| `version`    | INT        | NOT NULL        | Version number (1-indexed) |
| `title`      | VARCHAR    | NOT NULL        | Title at this version      |
| `content`    | MEDIUMTEXT | NOT NULL        | Content at this version    |
| `created_at` | DATETIME   | NOT NULL        | Version creation timestamp |

### 3.2 Indexes

- `idx_article_id_version`: (`articleId`, `version`)

## 4. API Endpoints

### 4.1 GET /article/query/:id

Retrieve a single article by ID.

**Request:**

- Path parameter: `id` (string) - Article ID

**Response:**

- 200: Article object with rendered content when `deleted = false`
- 200: Article object with rendered content when `deleted = true` and `ctx.user.role = ROLE_ADMIN`
- 403: If `deleted = true` and the requester is not an authenticated administrator, returns
  `deleteReason` as error message
- 404: Article not found
- 500: Server error

**Side Effects:**

- Tracks `VIEW_ARTICLE` event if tracking is enabled and `deleted = false`

If `deleted = true` and the requester is an authenticated administrator, the endpoint SHALL render
the article content and SHALL NOT track `VIEW_ARTICLE`.

If `deleted = true`, the frontend article detail view SHALL:

1. Render the stored article title and content only when the backend returns code `200`.
2. Render the title in `--ui-error-color`.
3. Render one error tag with exact text `已删除` beside the title.
4. Not request related articles or article history.
5. Not render article comments.
6. Not trigger automatic article updates.
7. Hide update and knowledge-base commands.
8. For an authenticated administrator, replace the deletion-request command with one command whose
   label is `恢复` and whose icon is the Lucide `RotateCcw` icon.
9. The restore command SHALL show a confirmation dialog before calling
   `POST /admin/articles/:id/restore`. Canceling SHALL make no request. A successful request SHALL
   reload the current article data.

The deleted-article administrator exception SHALL NOT apply to relevant-article, history, comment,
or comment-refresh endpoints.

### 4.2 GET /article/relevant/:id

Get articles relevant to the specified article.

**Request:**

- Path parameter: `id` (string) - Article ID

**Response:**

- 200: Array of relevant articles with `reason` field
- 403: If source article `deleted = true`, returns `deleteReason` as error message
- 404: Source article not found
- 500: Server error

### 4.3 GET /article/history/:id

Get version history of an article.

**Request:**

- Path parameter: `id` (string) - Article ID

**Response:**

- 200: Array of `ArticleHistory` entries ordered by version ASC
- 403: If article `deleted = true`, returns `deleteReason` as error message
- 404: Article not found
- 500: Server error

### 4.4 GET /article/recent

Get recently updated articles.

**Request:**

- Query parameters:
    - `count` (number, optional): Maximum articles to return (default: 20, max: 100)
    - `updated_after` (string, optional): ISO date string to filter articles updated after
    - `truncated_count` (number, optional): Max content length (default: 200, max: 600)

**Response:**

- 200: Array of articles with truncated content
- 500: Server error

### 4.5 GET /article/count

Get total count of non-deleted articles.

**Response:**

- 200: `{ count: number }`
- 500: Server error

## 5. Service Layer

### 5.1 ArticleService

| Method                            | Cache TTL | Cache Key Pattern                             |
| --------------------------------- | --------- | --------------------------------------------- |
| `getArticleById(id)`              | 600s      | `article:${id}`                               |
| `getRecentArticles(count, after)` | 600s      | `article:recent:${count}:${after?.getTime()}` |
| `getArticleCount()`               | 600s      | `article:count`                               |
| `saveArticle(article)`            | evicts    | `article:${id}`, `article:count`              |

Each ArticleService read/write method that accepts an optional `manager` argument SHALL use that `EntityManager` for database access when it is provided.
When a cached read method receives a manager argument, it SHALL bypass Redis cache reads and writes.

### 5.2 ArticleHistoryService

| Method                             | Cache TTL | Cache Key Pattern              |
| ---------------------------------- | --------- | ------------------------------ |
| `getHistoryByArticleId(articleId)` | 600s      | `article_history:${articleId}` |
| `pushNewVersion(articleId, ...)`   | evicts    | `article_history:${articleId}` |

### 5.3 Version Management

When `pushNewVersion` is called:

1. Lock the owning article row by ID and select only its ID.
2. Query only the `version` column from the latest history entry for the article, ordered by version DESC.
3. Calculate `newVersion = latestVersion + 1` (or 1 if no history exists).
4. Create and save a new `ArticleHistory` record.
5. Evict the history cache.

If ArticleHistoryService receives an optional `manager` argument, it SHALL use that `EntityManager` for database access.
When a cached read method receives a manager argument, it SHALL bypass Redis cache reads and writes.

## 6. Content Rendering

The `article.renderContent()` method:

1. If `content` is non-empty, render Markdown to HTML using the `renderMarkdown` library.
2. Store the result in `article.renderedContent`.
3. Math rendering SHALL ignore HAST element nodes that do not have a `properties` object.
4. A HAST element without `properties` SHALL NOT cause `article.renderContent()` to return a failure paragraph.

## 7. Content Hashing

When saving an article:

1. Compute `SHA-256(content)` as hex string.
2. Read only `id`, `title`, and `contentHash` when checking whether an existing article changed.
3. If hashes match AND titles match, skip the update.
4. For a missing row, attempt the insert before requesting a pessimistic row lock.
5. For an existing or concurrently inserted row, acquire a pessimistic row lock before updating.
6. Retry the complete database transaction at most three times for MariaDB deadlock or lock-wait timeout errors.
7. Otherwise, save the new content and update `contentHash`.
8. After a successful update, delete Redis keys `article:{id}` and `article:count` before returning.

Article candidate methods used by recommendation SHALL select article IDs only. They SHALL NOT
select `content`, `summary`, or author relations. Full article rows SHALL be loaded only for the
final selected recommendation IDs.

### 7.1 Publish Time Persistence

Let `t = normalizePublishTime(data.time)`, where `normalizePublishTime(v)` returns `v` if `v` is an
integer satisfying `1 <= v <= 4294967295`, and `null` otherwise. The upper bound is the maximum of
the `INT UNSIGNED` column; the lower bound rejects `0`, which Luogu uses for no value.

`saveLuoguArticle(data, forceUpdate)` SHALL write `t` into `publish_time` on the insert of step 4 and
on the update of step 7. If `t` is `null`, `publish_time` SHALL be absent from both write payloads,
so that a malformed `time` neither inserts nor overwrites a value.

Step 3 returns without writing, so a row whose stored `contentHash` and `title` both match the
incoming values keeps whatever `publish_time` it already had, including `NULL` for a row inserted
before this column existed. When step 3 skips and `t` is not `null`, `saveLuoguArticle` SHALL
therefore execute exactly one additional statement, inside the transaction that already holds the
pessimistic lock of step 5:

```sql
UPDATE article SET publish_time = :t WHERE id = :id AND publish_time IS NULL
```

That statement SHALL leave `updated_at` unchanged, SHALL NOT create an `article_history` version,
and SHALL affect zero rows once `publish_time` is set. It is therefore idempotent, and repeating a
skipped save does not move the article in any ordering by `updated_at`.

`publish_time` SHALL NOT be written from any source other than the `time` field of the Luogu article
payload.

## 8. Invariants

1. `version` numbers are strictly monotonically increasing per article.
2. Non-deleted articles (`deleted = false`) are returned in queries unless explicitly filtered.
3. All article queries include the `author` relation.
4. Content truncation preserves UTF-8 character boundaries.
5. `publish_time` and `created_at` denote different instants and SHALL NOT be substituted for one
   another. `publish_time` is the instant Luogu reports for the article itself; `created_at` is the
   instant this system first persisted the row. For an article archived long after publication the
   two differ without bound.
6. `publish_time` is `NULL` if and only if no save has yet observed a Luogu `time` that
   `normalizePublishTime` accepts for that article. It is never `0` and never derived from
   `created_at`.
7. Writing `publish_time` into a row that stored `NULL` is not an update of the archived article.
   It SHALL NOT advance `updated_at`, because `updated_at` orders `GET /article/recent` of section
   4.4 and is read by clients as the instant the archived content last changed.

## 9. Summary Rebuild Workflow

The workflow template `article-summary-rebuild-pipeline` SHALL rebuild summaries for all non-deleted articles.

Input parameters:

| Parameter     | Type   | Required | Default | Constraint            |
| ------------- | ------ | -------- | ------- | --------------------- |
| `batchSize`   | number | no       | 20      | Integer in `[1, 100]` |
| `concurrency` | number | no       | 5       | Integer in `[1, 20]`  |

Task `rebuild-summary` SHALL:

1. Have type `update`.
2. Have target `article_summary_rebuild`.
3. Have `targetId='articles'`.
4. Have `metadata.batchSize` equal to normalized `batchSize`.
5. Have `metadata.concurrency` equal to normalized `concurrency`.
6. Set `track=true`.
7. Set `report=true`.
8. Require permission `MANAGE_SEARCH`.

The update handler for `article_summary_rebuild` SHALL:

1. Load non-deleted articles from the database in ascending `id` order.
2. Process each loaded batch with at most `metadata.concurrency` articles running at the same time.
3. For each article, call the summary LLM scenario with the same summary prompt semantics as `llm:summary`.
4. Persist the generated summary to `article.summary`.
5. After persisting a summary, update the search index document for that article if search indexing is enabled.
6. Continue processing if one article fails and record that article ID in `failedArticleIds`.
7. Return `{ processed, updated, failed, failedArticleIds }`.

## 10. Embedding Rebuild Workflow

The workflow template `article-embedding-rebuild-pipeline` SHALL rebuild Chroma embeddings for all non-deleted articles.

Input parameters:

| Parameter     | Type   | Required | Default | Constraint            |
| ------------- | ------ | -------- | ------- | --------------------- |
| `batchSize`   | number | no       | 20      | Integer in `[1, 100]` |
| `concurrency` | number | no       | 5       | Integer in `[1, 50]`  |

Task `rebuild-embedding` SHALL:

1. Have type `update`.
2. Have target `article_embedding_rebuild`.
3. Have `targetId='articles'`.
4. Have `metadata.batchSize` equal to normalized `batchSize`.
5. Have `metadata.concurrency` equal to normalized `concurrency`.
6. Set `track=true`.
7. Set `report=true`.
8. Require permission `MANAGE_SEARCH`.

The update handler for `article_embedding_rebuild` SHALL:

1. Load non-deleted articles from the database in ascending `id` order.
2. Process each loaded batch with at most `metadata.concurrency` articles running at the same time.
3. For each article, call the embedding LLM scenario with `article.summary` when it is a non-empty string, otherwise with `article.content`; upsert that vector as the summary vector.
4. For each article, split `article.content` into chunks of 4000 characters with 300 characters overlap; call the embedding LLM scenario for each chunk; upsert each chunk vector.
5. Before inserting chunk vectors for an article, delete existing Chroma chunk vectors with metadata `articleId=article.id` and `kind="chunk"`.
6. Summary vectors SHALL use ID `article.id`; chunk vectors SHALL use ID `${article.id}:chunk:${index}`.
7. Vector metadata SHALL include `{ articleId, kind, title, authorId, category, tags, deleted }` where
   `deleted=article.deleted`; chunk vectors SHALL also include `{ chunkIndex, start, end }`.
8. The Chroma metadata field `tags` SHALL be a comma-separated string built from `article.tags`.
9. Continue processing if one article fails and record that article ID in `failedArticleIds`.
10. Return `{ processed, updated, failed, failedArticleIds }`.

The update handler for `article_embedding` SHALL:

1. Read the article from the database by `targetId`.
2. If upstream summary output contains non-empty `data.summary`, use that value for the summary vector document.
3. If upstream summary output is absent, use `article.summary` when non-empty, otherwise `article.content`.
4. Split `article.content` into chunks and upsert chunk vectors as specified for `article_embedding_rebuild`.
5. Not modify `article.content` or any article row.

## 11. File Locations

- Article entity: `packages/backend/src/entities/article.ts`
- Article history entity: `packages/backend/src/entities/article-history.ts`
- Article router: `packages/backend/src/routers/article.router.ts`
- Article service: `packages/backend/src/services/article.service.ts`
- Article history service: `packages/backend/src/services/article-history.service.ts`
- Article category enum: `packages/backend/src/shared/article.ts`
