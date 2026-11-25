# Comment System Specification

## 1. Overview

The comment system fetches the comments shown beneath an article on Luogu and displays them, read-only, beneath the corresponding article on LGS. The original interactive features (posting, replying, voting) are NOT reproduced; LGS only mirrors existing comments for archival and display.

Comments are fetched when an article save workflow runs or when explicitly requested via `POST /article/comments/:id/refresh`. Opening an article or calling `GET /article/comments/:id` SHALL NOT automatically trigger a comment fetch. Comment content is plain text.

## 2. Data Source

Luogu exposes article comments at:

```
GET https://www.luogu.com/article/{lid}/replies?sort=&after={cursor}
```

- `sort` is empty for the default order, or `time-d` for newest-first. The saver always uses the default order.
- Pagination is cursor-based: `after` is the `id` of the last comment from the previous page (NOT a user id). Omitting `after` returns the first page.
- Response shape: `{ replySlice: Reply[] }`. An empty `replySlice` signals the end of pagination.
- Each entry matches the existing `Reply` type: `{ id: number, author: UserSummary, time: number (unix seconds), content: string }`.
- `content` is plain text and MAY contain newline characters.

Verified against live luogu.com on 2026-05.

## 3. Entity

Table name: `article_comment`.

| Column         | Type            | Constraints     | Description                            |
| -------------- | --------------- | --------------- | -------------------------------------- |
| `id`           | BIGINT UNSIGNED | PRIMARY KEY     | Luogu comment id (site-wide unique)    |
| `article_id`   | VARCHAR(8)      | NOT NULL, INDEX | Owning article lid                     |
| `author_id`    | INT UNSIGNED    | NOT NULL        | Comment author's Luogu uid             |
| `content`      | MEDIUMTEXT      | NOT NULL        | Plain-text comment body                |
| `comment_time` | BIGINT          | NOT NULL        | Original Luogu timestamp, unix seconds |

`author_id` joins to the `user` table. Comment authors are upserted into `user` via the inline path (`buildUser` / `upsertLuoguUser`) so their colors, certification levels, and badge text are available, exactly like article authors.

The `article` table gains one nullable column `comments_fetched_at DATETIME`, written ONLY by the comment handler and by peer import (section 5.3). Index `idx_article_comments_fetched_at_id (comments_fetched_at, id)` serves the peering feed. The article save path never touches it (it is absent from `saveLuoguArticle`'s `incomingData` and `defaults`), so re-saving an article does not reset comment staleness.

## 4. TTL

`COMMENTS_TTL_MS = 6 * 60 * 60 * 1000` (6 hours) is local to `packages/backend/src/services/comment.service.ts`. `CommentService.isCommentsStale(article)` returns true when the article is unknown, `comments_fetched_at` is null, or the last fetch is older than the TTL.

`COMMENTS_MAX_PAGES = 200` is local to `packages/backend/src/workers/handlers/task/save/comments.handler.ts` and bounds pagination defensively.

## 5. Task Handler (`save:comments`)

A new `SaveTarget.COMMENTS` value and a `CommentsHandler` registered on the save processor.

### 5.1 Processing Flow

1. Validate `targetId` is a 1–8 char alphanumeric article lid; reject otherwise with `UnrecoverableError`.
2. Read `metadata.forceUpdate`; it is true only when the value is exactly boolean `true`.
3. Load the article without cache and call `CommentService.isCommentsStale(article)`.
4. If `forceUpdate=false` and comments are not stale, return `{ skipNextStep: true, data: { text: '' } }` without fetching Luogu, without writing comment rows, and without emitting a websocket event.
5. Page through `/article/{lid}/replies?sort=` using `C3vkMode.MODERN`, following the `after` cursor (last comment id of each page), stopping when `replySlice` is empty, the cursor fails to advance, or `COMMENTS_MAX_PAGES` is reached. Duplicate comment ids are de-duplicated defensively.
6. Upsert every distinct comment author into `user` via `buildUser` / `upsertLuoguUser`.
7. Map entries to `LuoguComment` (`{ id, authorId, time, content }`), defined by `packages/backend/src/services/comment.service.ts` beside `saveLuoguComments`.
8. Call `CommentService.saveLuoguComments(lid, comments)`, which transactionally replaces the article's full comment set and bumps `comments_fetched_at`.
9. Emit Socket.IO event `article:{lid}:comments-updated` to room `article_{lid}`.
10. Return `{ skipNextStep: false, data: { text: '' } }` (single-step task, no downstream consumers).

### 5.2 Idempotency

Re-running `save:comments` for the same article replaces the comment set wholesale; no history is kept. Deletions on Luogu propagate (comments absent upstream are removed locally on next fetch).

### 5.3 Peer Import

Peer import (`peering-system.spec.md` Sections 6.5 and 12.6) SHALL NOT replace comment sets. It
unites stored comments with the peer's comments by `id`, replaces `content` of a comment present on
both sides only when the peer's fetch is newer, and sets `comments_fetched_at` to the later of the
two fetch instants without changing `updated_at`. Peer import MAY store comments of an article that
has no local `article` row. It SHALL NOT dispatch `save:comments`, emit Socket.IO events, or contact
Luogu.

## 6. API

### 6.1 `GET /article/comments/:id`

Returns the stored comments for the article. This endpoint is read-only and SHALL NOT dispatch a `save:comments` task or contact Luogu, even when `commentsStale` is `true`.

If the article does not exist, return 404. If the article has `deleted = true`, return 403 with `deleteReason`.

Response:

```typescript
{
    comments: {
        id: string,           // comment id as string (avoids JS number precision concerns)
        content: string,
        time: number,         // unix seconds
        author: { id, name, color, ccfLevel, xcpcLevel, badge: string | null } | { id }
    }[],
    commentsStale: boolean,
    commentsFetchedAt: Date | null
}
```

The response uses the extended `author` form when the author row exists; otherwise it returns only the comment's `authorId` as `author.id`.

### 6.2 `POST /article/comments/:id/refresh`

Explicitly dispatches a `save:comments` task. Returns `{ taskId }`.

If the article does not exist, return 404. If the article has `deleted = true`, return 403 with `deleteReason` and do not dispatch a refresh task.

## 7. Frontend

- `ArticleComments.vue`: a read-only comment list rendered beneath the article body in `ArticleDetailView`. It shows each commenter via the shared `UserLink` (avatar, colored name, certification icons, badge text), the comment time, and the plain-text content with `white-space: pre-wrap` to preserve newlines.
- There is NO reply box and NO voting UI.
- The component subscribes to `article:{lid}:comments-updated` and reloads silently when a comment refresh task completes.
- A manual refresh button dispatches `POST /article/comments/:id/refresh`.

## 8. Invariants

1. The system is display-only: it never posts, edits, votes on, or deletes comments on Luogu.
2. The article save path never writes `comments_fetched_at` or `article_comment` rows. Only the
   `save:comments` handler and peer import (section 5.3) write them.
3. Comment content is rendered as plain text (escaped by Vue), never as HTML or Markdown.
4. Reading comments via `GET /article/comments/:id` is read-only and SHALL NOT dispatch a refresh task or contact Luogu, even when comments are stale.
