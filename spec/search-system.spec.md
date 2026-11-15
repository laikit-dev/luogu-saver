# Search System Specification

## 1. Scope

This specification defines article full-text search behavior implemented under `packages/backend`.

The search system uses Meilisearch as the full-text index. Article database rows remain the source of truth. The Meilisearch index is a derived cache that can be rebuilt from the database.

## 2. Configuration

The `meilisearch` configuration object SHALL contain:

| Field              | Type    | Default                 | Description                    |
| ------------------ | ------- | ----------------------- | ------------------------------ |
| `enable`           | boolean | `false`                 | Whether Meilisearch is enabled |
| `host`             | string  | `http://127.0.0.1:7700` | Meilisearch server URL         |
| `apiKey`           | string  | empty string            | Meilisearch API key            |
| `articleIndexName` | string  | `lgs_articles`          | Article index name             |

If `enable=false`, search APIs SHALL return an empty result set and index update tasks SHALL complete without writing to Meilisearch.

## 3. Article Search Document

The article index primary key SHALL be `id`.

Each indexed document SHALL have this shape:

| Field        | Type     | Source                                |
| ------------ | -------- | ------------------------------------- |
| `id`         | string   | `article.id`                          |
| `title`      | string   | `article.title`                       |
| `content`    | string   | `article.content`                     |
| `summary`    | string   | `article.summary` or empty string     |
| `authorId`   | number   | `article.authorId`                    |
| `authorName` | string   | `article.author.name` or empty string |
| `category`   | number   | `article.category`                    |
| `tags`       | string[] | `article.tags`                        |
| `updatedAt`  | number   | `article.updatedAt.getTime()`         |
| `viewCount`  | number   | `article.viewCount`                   |
| `priority`   | number   | `article.priority`                    |
| `deleted`    | boolean  | `article.deleted`                     |

Soft-deleted articles SHALL remain indexed with `deleted=true`. Restored and active articles SHALL
be indexed with `deleted=false`. Soft deletion and restoration SHALL NOT delete a Meilisearch
document.

## 4. Index Settings

When `SearchService.ensureArticleIndex()` is called and `enable=true`, the service SHALL ensure these settings:

1. Primary key: `id`.
2. Searchable attributes in order: `title`, `summary`, `content`, `authorName`, `tags`.
3. Filterable attributes: `category`, `authorId`, `tags`, `deleted`.
4. Sortable attributes: `updatedAt`, `viewCount`, `priority`.

## 5. Search API

### 5.1 GET `/search/articles`

Input query parameters:

| Parameter  | Type   | Required | Default | Constraint            |
| ---------- | ------ | -------- | ------- | --------------------- |
| `q`        | string | no       | empty   | Trimmed before use    |
| `page`     | number | no       | 1       | Minimum 1             |
| `limit`    | number | no       | 10      | Minimum 1, maximum 50 |
| `category` | number | no       | absent  | Exact filter          |
| `authorId` | number | no       | absent  | Exact filter          |

Response data shape:

```json
{
    "hits": [],
    "page": 1,
    "limit": 10,
    "total": 0,
    "processingTimeMs": 0
}
```

Postconditions:

1. If `meilisearch.enable=false`, return `hits=[]`, `total=0`, `processingTimeMs=0`.
2. Every search SHALL include the filter `deleted = false` in addition to caller-provided filters.
3. If `q` is empty and filters are absent, return recent non-deleted indexed articles sorted by `updatedAt:desc`.
4. If `q` is non-empty, search non-deleted indexed articles by Meilisearch default ranking.
5. The response SHALL not include raw `content`.
6. Every returned `summary` string SHALL be at most 220 Unicode code points. If truncation occurs, append `...`.
7. Every returned `formatted.summary` string SHALL be at most 260 Unicode code points excluding `<mark>` and `</mark>` tags. If truncation occurs, append `...` after any open mark tag is closed.

## 6. Workflow Integration

### 6.1 Article Save Pipeline Index Update

The workflow template `article-save-pipeline` SHALL include task `update-search-index`.

Task `update-search-index` SHALL:

1. Have type `update`.
2. Have target `search_index`.
3. Have `targetId` equal to the saved article ID.
4. Depend on task `update-summary`.
5. Set `track=true`.
6. Set `report=true`.

Because `update-search-index` depends on `update-summary`, Meilisearch article indexing SHALL occur only after summary generation and summary persistence both succeed.

### 6.2 Search Reindex Pipeline

The workflow template `search-reindex-pipeline` SHALL include exactly one task named `reindex-search`.

Input parameter:

| Parameter   | Type   | Required | Default | Constraint            |
| ----------- | ------ | -------- | ------- | --------------------- |
| `batchSize` | number | no       | 100     | Integer in `[1, 500]` |

Task `reindex-search` SHALL:

1. Have type `update`.
2. Have target `search_reindex`.
3. Have `targetId='articles'`.
4. Have `metadata.batchSize` equal to normalized `batchSize`.
5. Set `track=true`.
6. Set `report=true`.
7. Require permission `MANAGE_SEARCH`.

## 7. Update Handlers

### 7.1 `update:search_index`

1. If an upstream result has `skipNextStep=true`, return
   `{ skipNextStep: true, data: { indexed: false, articleId: targetId } }` without loading an article
   or writing to Meilisearch.
2. Otherwise call `SearchService.upsertArticleById(targetId)` without a separate article lookup.
3. If the service returns `exists=false`, fail permanently with
   `Article with id {targetId} not found for search index`, including when search is disabled.
4. Return `{ skipNextStep: false, data: { indexed, articleId: targetId } }` using the service's
   `indexed` result.

`SearchService.upsertArticleById(articleId)` SHALL return `{ exists: boolean, indexed: boolean }`:

1. Read the authoritative article row with author relation through
   `ArticleService.getArticleByIdWithoutCache(articleId)`.
2. If no row exists, return `{ exists: false, indexed: false }` without writing to Meilisearch.
3. If the row exists and search is disabled, return `{ exists: true, indexed: false }` without
   writing to Meilisearch.
4. When search is enabled, ensure the article index and upsert the authoritative article document,
   including its current `deleted` value. Wait for the Meilisearch document addition task to finish.
5. After writing, read the article row again without cache. If `deleted` changed during the write,
   upsert the latest complete document and wait for that addition task to finish before returning.
6. Return `{ exists: true, indexed: true }` after the enabled upsert and any deletion-state repair
   complete. Provider or database errors SHALL propagate.

### 7.2 `update:search_reindex`

1. If `meilisearch.enable=false`, return `{ indexed: 0 }`.
2. Do not delete any existing document from the configured article index.
3. Load all articles, including soft-deleted articles, from the database in ascending `(updatedAt, id)` order.
4. Use keyset pagination with the last `(updatedAt, id)` pair from the previous batch; do not use SQL `OFFSET`.
5. Upsert articles into Meilisearch in batches.
6. Wait for each Meilisearch document addition task to finish before loading the next batch.
7. Return `{ indexed: number }` where `number` is the count of documents accepted by Meilisearch.
8. Existing Meilisearch documents whose IDs have no database row SHALL remain unchanged.

## 8. Search Task

Task type `search` is available for workflow pipelines.

### 8.1 `search:article`

Payload shape:

```json
{
    "type": "search",
    "payload": {
        "target": "article",
        "query": "text",
        "metadata": {
            "limit": 5,
            "category": 1,
            "authorId": 1
        }
    }
}
```

Behavior:

1. Use `payload.query` as the search query.
2. If `payload.query` is absent, use upstream `data.text` from the first father task that returns text.
3. Use `metadata.limit` as the number of hits. If absent, use 5. Clamp the value to `[1, 100]`.
4. Use optional `metadata.category` and `metadata.authorId` as filters.
5. Return `{ hits, total }` where `hits` has the same item shape as `GET /search/articles`.
6. Set `query` on each hit to the text query used by the task.
7. Set `source='keyword'` on each hit.
8. If any father task has `skipNextStep=true`, return `{ hits: [], total: 0 }` with `skipNextStep=true`.

### 8.2 `search:vector`

Payload shape:

```json
{
    "type": "search",
    "payload": {
        "target": "vector",
        "metadata": {
            "limit": 10
        }
    }
}
```

Behavior:

1. Read `embedding` from the first father task whose result has `data.embedding` as an array.
2. Use `metadata.limit` as the number of distinct article hits. If absent, use 10. Clamp the value to `[1, 100]`.
3. Query Chroma by `EmbeddingService.getNearestArticleCandidates(embedding, limit, rawLimit)` where `rawLimit` defaults to 500 and the Chroma query filter is `deleted=false`.
4. Return `{ hits, total }` where each hit has `{ id, distance, score, source, vectorId, vectorKind }` and may include chunk metadata.
5. Set `source` to `vector`.
6. Set `score=max(0, 1 - distance)`.
7. Set `query` on each hit to the text query used to produce the embedding, if present in the embedding task result.
8. If any father task has `skipNextStep=true`, return `{ hits: [], total: 0 }` with `skipNextStep=true`.

## 9. Removed RAG Feature

The backend SHALL NOT register a `rag` task type, RAG handlers, or the
`rag-search-pipeline` workflow template. The frontend SHALL NOT expose RAG question answering or
a local RAG knowledge base. The generic search/read tasks, LLM adapter and processing handlers,
article embeddings, recommendation service, and public full-text search SHALL remain available.

## 10. Read Tasks

Task type `read` is available for workflow pipelines.

### 10.1 `read:text`

Return `{ text }` where `text` equals `payload.metadata.text`.

### 10.2 `read:article`

Load an article by `payload.targetId` and return `{ id, title, summary, content, text, authorId, authorName, category, tags }`.

### 10.3 `read:paste`

Load a paste by `payload.targetId` and return `{ id, content, text }`.

## 11. Deletion Marker Synchronization

### 11.1 Runtime Synchronization

For an article row `article`, runtime deletion-state synchronization SHALL:

1. Call `SearchService.upsertArticleById(article.id)`. The complete Meilisearch document SHALL be
   retained and its `deleted` field SHALL follow the authoritative database state, including the
   post-write repair specified in section 7.1.
2. Call `EmbeddingService.updateArticleDeletionState(article.id, article.deleted)`.
3. Load every existing Chroma vector whose metadata has `articleId=article.id`.
4. Preserve every existing metadata field and set only `deleted=article.deleted`.
5. Not delete a Meilisearch document, Chroma vector, Chroma document, or embedding.
6. Not generate a new embedding. If the article has no Chroma vectors, the Chroma operation is a
   successful no-op.

Any article embedding upsert SHALL read the current article deletion state immediately before
writing metadata. After writing, it SHALL re-read the deletion state and repair metadata when a
concurrent state change is detected. A stale embedding task SHALL NOT leave `deleted=false` after
the database row has become deleted.

Every newly generated Chroma article vector SHALL include boolean metadata
`deleted=article.deleted`.

### 11.2 Production Backfill Script

The repository SHALL provide the compiled script
`packages/backend/dist/scripts/backfill-search-deletion-markers.js`, built from
`packages/backend/src/scripts/backfill-search-deletion-markers.ts`.

The TypeScript source SHALL remain under `packages/backend/src/scripts` so the backend
TypeScript build emits its JavaScript output under `packages/backend/dist/scripts`. The
top-level `packages/backend/scripts` directory SHALL contain only directly executable
deployment scripts such as `.mjs` files and SHALL NOT contain the TypeScript build output.

The script SHALL:

1. Initialize the configured MariaDB data source without starting the HTTP server or workers.
2. Accept optional argument `--batch-size=N`; normalize `N` to an integer in `[1, 1000]`, default
   `100`.
3. Page through existing Meilisearch documents. For each document, read the corresponding database
   article's `deleted` value. If no database row exists, use `deleted=true`.
4. Partially update each existing Meilisearch document with only `{ id, deleted }` and wait for each
   batch task to finish.
5. Page through existing Chroma vectors. Resolve the article ID from metadata `articleId`, or from
   the vector ID for legacy records. For each vector, read the corresponding database article's
   `deleted` value. If no database row exists, use `deleted=true`.
6. Preserve every existing Chroma metadata field and set `deleted` to the resolved value. If a
   legacy vector has no `articleId` metadata, add `articleId` using the ID parsed in step 5.
7. Not insert a missing Meilisearch document or Chroma vector.
8. Not delete any record, document, vector, or embedding.
9. Not invoke an embedding provider.
10. Be idempotent: running the script multiple times against unchanged inputs produces the same
    marker values.
11. Skip a disabled Meilisearch or Chroma subsystem and report that subsystem as skipped.
12. Print one final JSON result containing processed and updated counts for both subsystems.
13. Destroy the MariaDB data source before exit. On failure, print the error and exit with status 1.

### 11.3 Query Enforcement

All public Meilisearch searches, generic keyword search tasks, and Chroma vector searches SHALL
exclude records with `deleted=true`.

## 12. File Locations

- Search service: `packages/backend/src/services/search.service.ts`
- Search router: `packages/backend/src/routers/search.router.ts`
- Update handlers: `packages/backend/src/workers/handlers/task/update/*.handler.ts`
- Search handlers: `packages/backend/src/workers/handlers/task/search/*.handler.ts`
- Read handlers: `packages/backend/src/workers/handlers/task/read/*.handler.ts`
- Workflow templates: `packages/backend/src/lib/workflow-templates.ts`
- Search configuration: `packages/backend/src/config/schemas/infrastructure.ts`
- Backfill script: `packages/backend/src/scripts/backfill-search-deletion-markers.ts`
