# Peering System Specification

## 1. Scope

Two archives of Luogu content ("peers") exchange the Luogu data each has copied from Luogu: lgzip
(`https://www.luogu.zip`) and luogu-saver (this backend). Each peer serves a read-only HTTP feed and
pulls the other peer's feed on a fixed interval. A peer writes only to its own database; no feed
endpoint accepts writes.

Sections 2–7 restate Peering Protocol v1, the contract shared with lgzip, in terms of luogu-saver's
tables. Sections 8–13 define how luogu-saver implements it. The wire format of Sections 3–6 SHALL NOT
change without a new protocol version agreed with lgzip.

Exchanged: Luogu users and their profile versions, articles with their versions and comments,
pastes, and judgement records. Not exchanged: registered accounts, tokens, summaries, embeddings,
view counts, tags, priorities, censorship results, deletion requests, takedowns (`deleted`,
`delete_reason`), profile-history recording preferences, and every other site-specific datum.

Each peer trusts the instants the other peer reports.

## 2. Notation

- `L` is the local record (possibly absent), `I` the incoming item.
- `Instant`: string `YYYY-MM-DDTHH:mm:ss.sssZ` (ISO 8601, UTC, exactly three fractional digits).
- `Uid`: integer in `[1, 4294967295]`.
- `Color`: string as Luogu gives it (`Gray`, `Blue`, `Green`, `Orange`, `Red`, `Purple`, `Cheater`).
- `Prize`: `{year: integer, contest: string, event: string | null, prize: string, score?: number, rank?: number}`.
- `Snapshot`: `{id: Uid, name: string, color: Color, ccfLevel: integer, xcpcLevel: integer, slogan: string | null, introduction: string | null, prizes: Prize[]}`.
- A "taken-down" article or paste is a row with `deleted = 1`.
- `µs(x)` is an instant represented as integer microseconds since the Unix epoch.

## 3. Transport

1. Request: `GET {base}/{stream}?after={cursor}`.
    - lgzip: `base = https://www.luogu.zip/api/peer/v1`.
    - luogu-saver: `base = https://api.luogu.me/peer/v1`; the backend route is `GET /peer/v1/:stream`.
    - `after` absent or empty denotes the start of the stream.
2. Authentication: header `Authorization: Bearer {token}`.
    - Each peer generates its export token (at least 32 random bytes, encoded as base64url or hex)
      and hands it to the other peer out of band. The token grants reading the feed and nothing else.
    - The server SHALL compare tokens in constant time.
    - When the server has no export token configured, every stream answers 404.
    - Missing or wrong token: 401 with an empty body.
3. Responses:
    - Success: 200, `Content-Type: application/json`, `Cache-Control: private, no-store`. The body
      MAY be compressed per `Accept-Encoding` (gzip, zstd or br).
    - Unknown stream: 404. Malformed `after`: 400.
4. Body: `{"items": Item[], "next": string, "more": boolean}`.
    - `next`: the cursor the client SHALL send as `after` on its next request for this stream. It is
      positioned after the last item; when `items` is empty it is equal to `after`.
    - `more`: `true` when the page stopped at a page limit (Section 4.3); `false` when every item
      servable at request time (Section 4.2) has been served.
5. Cursors are opaque to the client, which stores them verbatim. Each server defines its own encoding
   and SHALL keep accepting every cursor it has issued.

## 4. Server Rules

1. Order: each stream is ordered by `(cursor time, key)` ascending, where `key` is unique within the
   stream. Pages SHALL be produced with the keyset predicate `(time, key) > (cursor time, cursor key)`
   served by an index; `OFFSET` SHALL NOT be used. The cursor SHALL carry the cursor time at the full
   precision of the database column.
2. Settle window: an item SHALL be served only when its cursor time is earlier than the server's
   current time minus 5 minutes.
3. Page limits: a page holds at most 1000 items. The server SHALL stop adding items once the summed
   byte length of the page's text fields reaches 4 MiB (4194304 bytes). A page SHALL hold at least
   one item while any item is servable.
4. Exclusion: content taken down on the serving side SHALL NOT be served, nor items attached to it
   (versions and comments of a taken-down article). Taking content down after it was served sends
   nothing.
5. Instants: `Instant` per Section 2.
6. Unknown fields in items SHALL be ignored by clients; servers MAY add fields.

## 5. Client Rules

1. A client pulls from one peer at a time. A round requests the streams in this order: `users`,
   `profile-versions`, `articles`, `article-versions`, `comments`, `pastes`, `judgements`. Within a
   stream, pages are requested one after another until `more` is `false`.
2. The client SHALL apply each page in one database transaction and persist the stream's `next`
   cursor in that transaction.
3. A round starts when the previous round finished at least `interval` minutes ago (default 60,
   minimum 5).
4. Failure: on a network error, a status other than 200, or a body that is not the envelope of
   Section 3.4, the client stops the round, keeps its cursors, and tries again in the next round. An
   item failing validation is skipped and logged; the rest of the page applies.
5. Takedowns: the client SHALL NOT create, update or restore content it has taken down, nor attach
   versions or comments to it.
6. Applying items SHALL NOT cause requests to Luogu or to paid external services (LLM summaries,
   embeddings). Search indexes and caches are updated as for a local copy.
7. Items a client received MAY be served back to the other peer. Merges are idempotent (Section 7), so
   this costs bandwidth only.

## 6. Streams

### 6.1 `users`

Item: `{uid: Uid, name: string, color: Color, ccfLevel: integer, xcpcLevel: integer, badge: string | null, changedAt: Instant, profile: null | {slogan: string | null, introduction: string | null, prizes: Prize[], fetchedAt: Instant}}`.

- `changedAt`: when the server last saw `name`, `color`, `ccfLevel`, `xcpcLevel` or `badge` differ
  from what it held; the first sighting counts.
- `profile`: `null` while the server has never fetched the user's profile page; `fetchedAt` is its
  latest fetch.
- Cursor time: `max(changedAt, profile.fetchedAt)`.

Merge, with `T(x) = max(x.changedAt, x.profile.fetchedAt)` (an absent profile contributes nothing):

1. If `L` is absent or `T(I) > T(L)`, and any of the five details differs: the details become `I`'s
   and `changedAt := max(L.changedAt, I.changedAt)`.
2. If `I.profile` is not null and (`L.profile` is null or `I.profile.fetchedAt > L.profile.fetchedAt`):
   `slogan`, `introduction`, `prizes` and `profile.fetchedAt` become `I`'s.
3. When `I.profile` is not null, the snapshot built from `I` (details of `I` plus `I.profile`) is an
   observation at `I.profile.fetchedAt` for the profile's version merge (Section 7).

### 6.2 `profile-versions`

Item: `{uid: Uid, observedAt: Instant, snapshot: Snapshot}`, one per stored profile version;
`observedAt` is when the server first observed the snapshot; `snapshot.id = uid`.

- Not served for users whose profile history is switched off on the serving side.
- Cursor time: `observedAt`.
- Merge: Section 7, texts compared as JSON values (key order is irrelevant). The local current
  observation is the user's current profile at `L.profile.fetchedAt`. Versions of a user unknown
  locally SHALL be stored.

### 6.3 `articles`

Item: `{id: string, title: string, content: string, authorId: Uid, category: integer, solutionForPid: string | null, upvote: integer, favorCount: integer, publishedAt: Instant | null, archivedAt: Instant, checkedAt: Instant}`.

- `archivedAt`: the server's first copy. `checkedAt`: the server's latest comparison with Luogu,
  whether or not anything changed.
- Cursor time: `checkedAt`.

Merge:

1. `L` taken down: skip the item.
2. `archivedAt := min(L.archivedAt, I.archivedAt)`.
3. If `L` is absent or `I.checkedAt > L.checkedAt`: `authorId`, `category`, `solutionForPid`,
   `upvote`, `favorCount`, `publishedAt` and `checkedAt` become `I`'s.
4. `(I.checkedAt, I.title, I.content)` is an observation for the article's version merge (Section 7).
   `title` and `content` become those of the newest version after the merge.

### 6.4 `article-versions`

Item: `{articleId: string, observedAt: Instant, title: string, content: string}`, one per stored
version; `observedAt` is when the server first observed the text.

- Cursor time: `observedAt`.
- Merge: Section 7, texts compared by `(title, content)`. Versions of an article unknown locally SHALL
  be stored, so that a later `articles` item merges them.

### 6.5 `comments`

Item: `{articleId: string, fetchedAt: Instant, comments: {id: integer, authorId: Uid, content: string, publishedAt: Instant}[]}`,
holding every comment the server keeps for the article; `fetchedAt` is the server's latest fetch of
the article's comments.

- Cursor time: `fetchedAt`. Only articles whose comments were fetched at least once are served.

Merge:

1. Article taken down locally: skip the item.
2. Comments are united by `id`. For a comment present on both sides, `content := I`'s when
   `I.fetchedAt > L.fetchedAt`. Comments present only locally are kept.
3. `L.fetchedAt := max(L.fetchedAt, I.fetchedAt)`.

### 6.6 `pastes`

Item: `{id: string, content: string, authorId: Uid, publishedAt: Instant | null, archivedAt: Instant, checkedAt: Instant}`.

- Cursor time: `checkedAt`.

Merge:

1. `L` taken down: skip the item.
2. `archivedAt := min(L.archivedAt, I.archivedAt)`.
3. If `L` is absent or `I.checkedAt > L.checkedAt`: `content`, `authorId`, `publishedAt` and
   `checkedAt` become `I`'s.

Pastes stay reachable by ID alone on both peers: they SHALL NOT be listed, searched, recommended, or
looked up by author.

### 6.7 `judgements`

Item: `{uid: Uid, name: string, reason: string | null, revokedPermission: integer, addedPermission: integer, time: Instant, user: object}`;
`user` is Luogu's user object as returned with the record.

- Cursor time: the server's persistence time of the record.
- Merge: the duplicate key is the lowercase hexadecimal SHA-256 of
  `JSON.stringify([uid, unixSeconds(time), reason ?? "", revokedPermission, addedPermission])`. The
  record is inserted when its key is absent; existing records stay unchanged. The receiver fills its
  own bookkeeping columns.

## 7. Version Merge

For one article (or one user's profile), the observation sequence `O` is, in this order:

1. every locally stored version `(createdAt, text)`, in ascending `version` order;
2. the local current text at the local `checkedAt` (`profile.fetchedAt`), when the record exists
   locally (for a profile: when `L.profile` is not null);
3. every incoming version;
4. the incoming current text at its `checkedAt` (`profile.fetchedAt`), when the item carries one.

`O` is sorted by time ascending; the sort is stable. Every observation whose text equals the text of
the observation kept before it is removed. The remaining sequence, numbered from 1, is the new
version list, each version's creation time being its observation time. The current text is the text
of the last version.

- Version numbers are local and MAY change when an earlier version is inserted.
- Applying the same items again yields the same version list.

## 8. Configuration

The optional top-level `config.yml` section `peer` is preprocessed as an empty object when absent.

| Field             | Type    | Default | Constraint                                              | Description                                     |
| ----------------- | ------- | ------- | ------------------------------------------------------- | ----------------------------------------------- |
| `baseUrl`         | string  | `""`    | `""` or an absolute `http(s)` URL; trailing `/` removed | Base URL of the other peer's feed               |
| `token`           | string  | `""`    | Printable ASCII without spaces (`0x21`–`0x7E`)          | Bearer token sent to the other peer             |
| `exportToken`     | string  | `""`    | `""` or at least 43 characters of `[A-Za-z0-9_-]`       | Bearer token accepted on `GET /peer/v1/:stream` |
| `intervalMinutes` | integer | 60      | At least 5                                              | Minimum minutes between round end and start     |

The production value of `baseUrl` is `https://www.luogu.zip/api/peer/v1`.

- Import is enabled iff `baseUrl ≠ ""` and `token ≠ ""`.
- Export is enabled iff `exportToken ≠ ""`. A hex token of 32 bytes has 64 characters; a base64url
  token of 32 bytes has 43 characters.

## 9. Persistence

### 9.1 Columns and Indexes Added for Peering

| Table                  | Change                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `article`              | Column `checked_at DATETIME(3) NULL`                                      |
| `article`              | Index `idx_article_checked_at_id (checked_at, id)`                        |
| `article`              | Index `idx_article_checked_at_updated_at_id (checked_at, updated_at, id)` |
| `article`              | Index `idx_article_comments_fetched_at_id (comments_fetched_at, id)`      |
| `article_history`      | Index `idx_article_history_created_at_id (created_at, id)`                |
| `paste`                | Column `checked_at DATETIME(3) NULL`                                      |
| `paste`                | Index `idx_paste_checked_at_id (checked_at, id)`                          |
| `paste`                | Index `idx_paste_checked_at_updated_at_id (checked_at, updated_at, id)`   |
| `user`                 | Index `idx_user_updated_at_id (updated_at, id)`                           |
| `user_profile_history` | Index `idx_user_profile_history_created_at_id (created_at, id)`           |
| `judgement_record`     | Index `idx_judgement_record_created_at_id (created_at, id)`               |
| `judgement_fetch_log`  | Column `source VARCHAR(16) NOT NULL DEFAULT 'luogu'`                      |
| `peer_cursor`          | New table (Section 9.2)                                                   |

TypeORM schema synchronization applies these changes at startup. Every added column is nullable or
has a constant default and is appended as the last column, so MariaDB adds it with
`ALGORITHM=INSTANT` without rebuilding the table. Every added index is a secondary index built with
MariaDB's default online algorithm (`ALGORITHM=INPLACE`, `LOCK=NONE`); it reads the clustered index
once and does not copy the table. No existing column changes type or precision, so the `article`
table is not rebuilt.

`checked_at` of `article` and `paste` is the instant of the row's latest comparison with Luogu.
Rows whose `checked_at` is `NULL` were last saved before this column existed; for them `updated_at`
SHALL be used wherever `checked_at` is read (`COALESCE(checked_at, updated_at)`). No backfill is
performed.

### 9.2 `peer_cursor`

| Column            | Type         | Constraints              | Description                                            |
| ----------------- | ------------ | ------------------------ | ------------------------------------------------------ |
| `peer`            | VARCHAR(255) | PRIMARY KEY (1st column) | `config.peer.baseUrl` the cursor belongs to            |
| `stream`          | VARCHAR(32)  | PRIMARY KEY (2nd column) | Stream name                                            |
| `cursor_value`    | TEXT         | NOT NULL                 | Last `next` received and applied, stored verbatim      |
| `deferred_cursor` | TEXT         | NULLABLE                 | `after` value of the page deferred once (Section 12.4) |
| `updated_at`      | DATETIME(6)  | NOT NULL                 | Last write                                             |

An absent row denotes cursor `""`. Changing `config.peer.baseUrl` therefore restarts every stream
from the beginning.

### 9.3 Local Saves Maintain `checked_at`

1. Every successful `ArticleService.saveLuoguArticle` and `PasteService.saveLuoguPaste` SHALL set
   `checked_at` to the instant at which its transaction attempt started, on insert, on update, and
   when the save is skipped because the content is unchanged.
2. A skipped save SHALL write `checked_at` with exactly one statement that assigns `updated_at` to
   itself, so `updated_at` does not change.
3. No other local write path writes `checked_at`.

## 10. Instants and Time Zone

1. MariaDB `DATETIME` columns store wall-clock values without zone. Values written by
   `CURRENT_TIMESTAMP` use the MariaDB session time zone (production: `time_zone=SYSTEM`, CST,
   UTC+8).
2. The TypeORM data source does not set the mysql2 `timezone` option, so mysql2 uses `local`: it
   formats `Date` parameters as the Node.js process's local wall-clock time and parses `DATETIME`
   results with `new Date('YYYY-MM-DD HH:MM:SS[.ffffff]')`, i.e. in the Node.js process's local time
   zone. The backend therefore requires the Node.js process UTC offset to equal the MariaDB session
   UTC offset. Peering code SHALL use the same convention: a database wall-clock value
   `YYYY-MM-DD HH:MM:SS.ffffff` denotes the instant at that wall-clock time in the Node.js local time
   zone, with microsecond precision.
3. Before serving a feed page and before starting an import round, the backend SHALL compare
   `TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(6), NOW(6))` with the Node.js process's current UTC offset in
   seconds. If they differ, the feed SHALL answer 500 with an empty body, the round SHALL NOT start,
   and an error log containing both offsets SHALL be written. A successful comparison MAY be reused
   for 600 seconds.
4. Database wall-clock values SHALL be read with `DATE_FORMAT(column, '%Y-%m-%d %H:%i:%s.%f')` and
   written as strings of that form; peering code SHALL NOT pass `Date` objects for cursor-time
   columns.
5. Legacy rows MAY hold MariaDB's zero date `0000-00-00 00:00:00.000000`. A zero date denotes an
   unknown instant. Merges SHALL treat a stored zero date as the instant 0 (earlier than every
   incoming instant), and the feed SHALL NOT serve a row whose cursor time is a zero date
   (Section 11.3).
6. Emitted instants: the microsecond instant truncated to milliseconds, as `Instant`.
7. Incoming instants SHALL be truncated to the precision of the column that stores them before any
   merge comparison: `user.profile_fetched_at` and `article.comments_fetched_at` are `DATETIME`
   (seconds); `checked_at` is `DATETIME(3)`; `created_at`, `updated_at`, `article_history.created_at`
   and `user_profile_history.created_at` are `DATETIME(6)`.
8. Local instants SHALL be truncated to milliseconds before any merge comparison. Peers exchange
   millisecond instants, so a local microsecond value served to the other peer and received back
   compares equal to itself; without truncation the echo would sort before the local value and
   rewrite it. Stored values keep their precision unless a merge rule writes them.
9. Unix-second columns (`publish_time`, `article_comment.comment_time`, `judgement_record.time`) map
   to `Instant` as `seconds × 1000` milliseconds; incoming instants map to `floor(ms / 1000)`.
   `publishedAt` maps through `normalizePublishTime` of `article-system.spec.md` Section 7.1, so an
   instant outside `[1, 4294967295]` seconds is stored as `NULL`.

## 11. Export (`GET /peer/v1/:stream`)

### 11.1 Request Handling

The router `packages/backend/src/routers/peer.router.ts` SHALL handle `GET /peer/v1/:stream` in this
order:

1. If `config.peer.exportToken = ""`: status 404, body `Not Found`.
2. If the `Authorization` header is absent, does not have the form `Bearer {token}` (scheme matched
   case-insensitively), or `{token}` differs from `config.peer.exportToken`: status 401, empty body.
   The comparison SHALL compute SHA-256 of both strings and compare the digests with
   `crypto.timingSafeEqual`.
3. If `:stream` is not one of the seven stream names: status 404, body `Not Found`.
4. If the query parameter `after` occurs more than once or is not a cursor issued by this server
   (Section 11.2): status 400, empty body.
5. If the time-zone check of Section 10.3 fails, or building the page throws: status 500, empty body,
   one error log.
6. Otherwise status 200 with the envelope of Section 3.4, `Content-Type: application/json`,
   `Cache-Control: private, no-store`, and `Vary: Accept-Encoding`. When the serialized body exceeds
   1024 bytes and `Accept-Encoding` accepts `br`, the body SHALL be Brotli-compressed (quality 4);
   otherwise when it accepts `gzip`, gzip-compressed (level 6); otherwise sent uncompressed.
   `Content-Encoding` SHALL name the applied encoding.

The response SHALL NOT use the `{ code, message, data }` envelope of `ctx.success` or `ctx.fail`.

A request is an authorized peer request iff export is enabled, its path starts with `/peer/v1/`, and
its bearer token passes the check of step 2. Authorized peer requests are exempt from API rate
limiting (`api-middleware.spec.md` Section 3).

### 11.2 Cursor Encoding

A cursor is `base64url(JSON.stringify([t, k]))` without padding, where `t` is the item's cursor time
as a database wall-clock string `YYYY-MM-DD HH:MM:SS.ffffff` (six fractional digits) and `k` is its
key. `k` is a string of 1–8 characters for `articles`, `comments` and `pastes`, and a positive safe
integer otherwise. A cursor is valid iff it decodes to such a pair whose date and time components
form an existing calendar date-time. An absent or empty `after` denotes the start of the stream.

### 11.3 Page Construction

All reads of one page SHALL run in one `REPEATABLE READ` transaction.

1. `cutoff := NOW(6) - INTERVAL 5 MINUTE`, read once per page.
2. Candidate scan: rows satisfying the stream's filter, `time >= '1970-01-02 00:00:00'` (which
   excludes zero dates, Section 10.5), `time < cutoff`, and, when `after` is
   non-empty, `time > t OR (time = t AND key > k)` (written as `time >= t AND (time > t OR key > k)`),
   ordered by `(time, key)` ascending. The scan SHALL be issued in chunks of at most `chunk` rows
   (Section 11.4) and SHALL select only the key, `DATE_FORMAT(time, ...)`, and the item's text byte
   length computed with `LENGTH()` in SQL.
3. Items are appended in scan order. Before appending a row, if the page already holds 1000 items or
   its summed text bytes are at least 4194304, the scan stops with `more = true`. When the scan
   reaches the end of the servable rows, `more = false`.
4. Full rows SHALL be loaded only for the appended keys, after step 3, with one query per stream
   (plus one query for the comments of a `comments` page).
5. `next` is the cursor of the last appended item; when no item was appended, `next` equals the
   received `after` (`""` when absent).

For `articles` and `pastes`, the candidate scan SHALL be the union of two keyset scans over disjoint
partitions, each served by its own index and limited to the chunk size, merged in SQL by
`(time, key)`:

- `checked_at IS NOT NULL`, time `checked_at`, index `(checked_at, id)`;
- `checked_at IS NULL`, time `updated_at`, index `(checked_at, updated_at, id)`.

### 11.4 Stream Sources

| Stream             | Rows and filter                                                            | Cursor time                        | Key                       | Text bytes                                          | `chunk` |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------- | ------------------------- | --------------------------------------------------- | ------- |
| `users`            | every `user` row                                                           | `user.updated_at`                  | `user.id`                 | `name`, `badge`, `slogan`, `introduction`, `prizes` | 1001    |
| `profile-versions` | `user_profile_history` joined to `user` with `profile_history_enabled = 1` | `user_profile_history.created_at`  | `user_profile_history.id` | `snapshot`                                          | 1001    |
| `articles`         | `article` with `deleted = 0`                                               | `COALESCE(checked_at, updated_at)` | `article.id`              | `title`, `content`                                  | 100     |
| `article-versions` | `article_history` joined to an existing `article` with `deleted = 0`       | `article_history.created_at`       | `article_history.id`      | `title`, `content`                                  | 100     |
| `comments`         | `article` with `deleted = 0` and `comments_fetched_at IS NOT NULL`         | `article.comments_fetched_at`      | `article.id`              | sum of `article_comment.content` of the article     | 100     |
| `pastes`           | `paste` with `deleted = 0`                                                 | `COALESCE(checked_at, updated_at)` | `paste.id`                | `content`                                           | 100     |
| `judgements`       | every `judgement_record` row                                               | `judgement_record.created_at`      | `judgement_record.id`     | `name`, `reason`, `user_snapshot`                   | 1001    |

`NULL` text columns contribute 0 bytes. `chunk` is additionally bounded by `1001 − (items already
appended)`.

Every keyset scan SHALL name its index with `FORCE INDEX`, so that no optimizer choice replaces the
index range scan with a full scan and filesort: `idx_user_updated_at_id`,
`idx_user_profile_history_created_at_id`, `idx_article_checked_at_id` and
`idx_article_checked_at_updated_at_id`, `idx_article_history_created_at_id`,
`idx_article_comments_fetched_at_id`, `idx_paste_checked_at_id` and
`idx_paste_checked_at_updated_at_id`, `idx_judgement_record_created_at_id`. Joined tables
(`user` for `profile-versions`, `article` for `article-versions`) are read by primary key after the
scanned table (`STRAIGHT_JOIN`).

### 11.5 Item Mapping

- `users`: `{uid: id, name, color, ccfLevel: ccf_level, xcpcLevel: xcpc_level, badge, changedAt: updated_at, profile}`;
  `profile` is `null` when `profile_fetched_at IS NULL`, else
  `{slogan, introduction, prizes: prizes ?? [], fetchedAt: profile_fetched_at}`.
  Every user write path keeps `profile_fetched_at IS NULL OR profile_fetched_at <= updated_at`
  (Section 13 invariant 3), so `max(changedAt, profile.fetchedAt) = updated_at` is the cursor time.
- Every emitted prize has exactly the `Prize` fields; a stored `score` or `rank` that is not a
  number is omitted.
- `profile-versions`: `{uid: user_id, observedAt: created_at, snapshot}`; `snapshot` is the stored
  snapshot normalized as in `user-system.spec.md` Section 2.6 with `id = user_id`.
- `articles`: `{id, title, content, authorId: author_id, category, solutionForPid: solution_for_pid, upvote, favorCount: favor_count, publishedAt: publish_time, archivedAt: created_at, checkedAt: COALESCE(checked_at, updated_at)}`.
- `article-versions`: `{articleId: article_id, observedAt: created_at, title, content}`.
- `comments`: `{articleId: article.id, fetchedAt: comments_fetched_at, comments}`; `comments` holds every
  `article_comment` row with `article_id = article.id`, ordered by `id`, as
  `{id, authorId: author_id, content, publishedAt: comment_time}`.
- `pastes`: `{id, content, authorId: author_id, publishedAt: publish_time, archivedAt: created_at, checkedAt: COALESCE(checked_at, updated_at)}`.
- `judgements`: `{uid, name, reason, revokedPermission: revoked_permission, addedPermission: added_permission, time, user: user_snapshot}`.

Instants follow Section 10.

## 12. Import

### 12.1 Scheduler

`PeerSyncScheduler.start()` SHALL do nothing except write one info log when import is disabled.
Otherwise it SHALL call `tick()` once immediately and then every 60000 milliseconds with a timer that
calls `unref()`. `tick()` SHALL:

1. Return if a round is already running in this process.
2. Acquire Redis lock `scheduler:peer-sync` with `SET NX PX 900000` and a random owner token; return
   if not acquired.
3. Read Redis key `scheduler:peer-sync:finished-at` (milliseconds since the epoch). If it exists and
   `now − value < intervalMinutes × 60000`, release the owned lock and return.
4. Run one round (Section 12.2).
5. After the round ends, successfully or not, set `scheduler:peer-sync:finished-at` to the current
   time and release the lock only when it still holds the owner token.

Before each page request the round SHALL extend the lock's TTL to 900000 milliseconds when it still
holds the owner token, and SHALL stop when it no longer does.

### 12.2 Round

1. Stop if the time-zone check of Section 10.3 fails.
2. Read `@@max_allowed_packet` as `P`. Let `textLimit = min(16777215, floor(P / 2) − 1048576)` and
   `statementBudget = min(4194304, textLimit)`.
3. For each stream in the order of Section 5.1, load its cursor and request pages one after another:
    1. Request `GET {baseUrl}/{stream}` with `after` set to the stored cursor when it is non-empty,
       headers `Authorization: Bearer {token}`, `Accept: application/json`,
       `Accept-Encoding: br, gzip`, a timeout of 120000 milliseconds, at most 268435456 decoded
       response bytes, and no redirects.
    2. Stop the round, keeping every cursor, on a network error, a status other than 200, a body that
       is not JSON, or a JSON value that is not an object with an array `items`, a string `next`,
       and a boolean `more`.
    3. Apply the page (Section 12.3). Stop the round when the page is deferred (Section 12.4).
    4. Run the page's side effects (Section 12.7).
    5. Continue with the next stream when `more = false`, or when `items` is empty and
       `next` equals the cursor sent; otherwise request the next page with `next`.
4. Every failure SHALL be logged with stream and reason; logs SHALL NOT contain tokens or item
   texts.

### 12.3 Page Application

1. Each item is validated (Section 12.5). An invalid item is skipped and logged with the stream, its
   index in the page, and the validation path; the rest of the page applies.
2. All valid items of the page and the upsert of `peer_cursor(peer, stream).cursor_value := next`
   (with `deferred_cursor := NULL`) SHALL run in one transaction, retried as a whole through
   `retryOnTransactionConflict` with a new transaction per attempt.
3. Items are processed in ascending key order (uid or article/paste ID); items with equal keys keep
   page order and are applied one after another. `profile-versions` and `article-versions` items are
   grouped by uid or article ID; the groups are processed in ascending ID order and the items of a
   group are folded in page order, each fold step being one application of Section 7.
4. Rows are locked in that order: an existing row is read with `SELECT ... FOR UPDATE` by primary
   key only after an unlocked read found it; a missing row is inserted without a prior locking read,
   and a duplicate-key error on that insert continues through the locked existing-row path. The
   owning `user` or `article` row is locked before its `user_profile_history`, `article_history` or
   `article_comment` rows.
5. Taken-down rows SHALL NOT be written.
6. Every statement carrying item text SHALL carry at most `statementBudget` bytes of text, except
   that a statement MAY carry one row whose text exceeds it.

### 12.4 Missing Users

`article.author_id`, `paste.author_id` and `article_comment.author_id` reference `user.id` through
foreign keys. An item needs a user when it would write that user's ID: an `articles` or `pastes` item
that inserts a row or whose merge rule 3 applies, and each comment of a `comments` item that is
inserted.

1. When a page contains an item that needs a user absent locally and the stored `deferred_cursor`
   differs from the page's `after`, the page transaction SHALL roll back, `deferred_cursor` SHALL be
   set to `after` in a separate transaction, and the round SHALL stop. The next round pulls `users`
   first.
2. When `deferred_cursor` equals the page's `after`, each item (or comment) that needs an absent user
   SHALL be skipped and logged, and the rest of the page applies.

### 12.5 Item Validation

Common: `Uid` integers in `[1, 4294967295]`; `integer` fields are safe integers in
`[−2147483648, 2147483647]` unless stated; `Instant` strings match Section 2 and denote a valid
date-time; `textLimit` is in UTF-8 bytes.

| Stream             | Additional constraints                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`            | `name` 1–255 characters; `color` 1–255 characters; `ccfLevel`, `xcpcLevel` ≥ 0; `badge` ≤ 65535 bytes; `slogan` ≤ 65535 bytes; `introduction` ≤ `textLimit`; each prize has integer `year` and string `contest`, `prize` |
| `profile-versions` | `snapshot.id = uid`; snapshot fields as for `users`                                                                                                                                                                      |
| `articles`         | `id` matches `^[A-Za-z0-9]{1,8}$`; `title` ≤ 255 characters; `content` ≤ `textLimit`; `solutionForPid` ≤ 50 characters; `upvote`, `favorCount` integers                                                                  |
| `article-versions` | `articleId` matches `^[A-Za-z0-9]{1,8}$`; `title` ≤ 255 characters; `content` ≤ `textLimit`                                                                                                                              |
| `comments`         | `articleId` matches `^[A-Za-z0-9]{1,8}$`; every comment `id` is a positive safe integer, `content` ≤ `textLimit`                                                                                                         |
| `pastes`           | `id` matches `^[A-Za-z0-9]{1,8}$`; `content` ≤ `textLimit`                                                                                                                                                               |
| `judgements`       | `name` 1–255 characters; `reason` ≤ 65535 bytes; permissions integers in `[0, 4294967295]`; `unixSeconds(time)` in `[1, 4294967295]`; `user` a JSON object                                                               |

Unknown fields are dropped. A prize's `event` absent maps to `null`; a non-number `score` or `rank`
is dropped. A `badge` is trimmed and the empty string maps to `null`; empty `slogan` and
`introduction` map to `null` (`user-system.spec.md` Sections 2.6 and 3).

### 12.6 Merge Mapping

The merge rules of Sections 6 and 7 are implemented as pure functions in
`packages/backend/src/services/helpers/peer-merge.helper.ts` and applied by
`packages/backend/src/services/peer-import.service.ts`.

`users`:

- `L.changedAt := user.updated_at`; `L.profile := null` iff `profile_fetched_at IS NULL`, else
  `{slogan, introduction, prizes ?? [], fetchedAt: profile_fetched_at}`.
- A missing user is inserted with the merged values, `profile_history_enabled = 1`,
  `profile_history_version = 0` and `created_at = NOW(6)`.
- When rule 1 or rule 2 applies, the `user` row is updated with the merged values and
  `updated_at := max(changedAt, profile.fetchedAt)` of the merged values, written explicitly. When
  neither applies, the `user` row is not updated.
- Rule 3 (version merge) SHALL be skipped for a local user with `profile_history_enabled = 0`; rules 1
  and 2 still apply.

`profile-versions`:

- Groups of a local user with `profile_history_enabled = 0` are skipped.
- A user absent locally is inserted from the snapshot with the latest `observedAt` of its group:
  details from the snapshot, `badge = NULL`, profile fields `NULL` (`L.profile = null`),
  `profile_history_enabled = 1`, `updated_at` = that `observedAt`.
- Snapshot texts are compared as the JSON serialization of the snapshot normalized as in
  `user-system.spec.md` Section 2.6, with prizes reduced to the `Prize` fields (a `score` or `rank`
  that is not a number is omitted). The fixed key order makes equal JSON values equal strings.
- The current profile is changed only by Section 6.1 rules 1 and 2; a `profile-versions` item never
  changes `user` profile fields.

Profile version lists are written by deleting every `user_profile_history` row of the user whose
version number changes or which leaves the list and inserting the rows of the new list that are not
stored with their new number, preserving `created_at` and the stored snapshot text of retained
versions. `user.profile_history_version` SHALL then equal the number of versions; this write assigns
`updated_at` to itself.

`articles`:

- `L.checkedAt := COALESCE(checked_at, updated_at)`; `L.archivedAt := created_at`; texts are compared
  by `(title, SHA2(content, 256))`.
- Rule 2 writes `created_at`; rule 3 writes `author_id`, `category`, `solution_for_pid`, `upvote`,
  `favor_count`, `publish_time` and `checked_at`, including `NULL` for `solutionForPid` and
  `publishedAt`.
- A missing article is inserted with `deleted = 0`, `priority = 0`, `view_count = 0`, `tags = []`,
  `summary = NULL`, `comments_fetched_at = NULL` and `content_hash = SHA-256(content)`.
- When the merge changes `title` or `content`, or inserts the article, `updated_at` SHALL be the
  creation time of the newest version after the merge; otherwise `updated_at` is assigned to itself.

`article-versions`:

- Groups whose article is taken down are skipped. For an article absent locally the observation
  sequence has no local current text, the versions are stored, and no `article` row is written.
- For an existing article, `title`, `content` and `content_hash` become those of the newest version;
  `updated_at` follows the `articles` rule; `checked_at` is unchanged.

Article version lists are written by: inserting the new list's rows that are neither stored versions
nor relocated rows (copying text with `INSERT ... SELECT` from `article` or `article_history` when
the text is local); then updating the `article` row; then deleting stored versions that left the
list; then relocating; then updating `version` of retained rows whose number changed. A retained row
keeps its `id`, `created_at` and text. A stored row that leaves the list while a new entry with the
same text enters it is relocated instead of deleted: its `version` and `created_at` become the new
entry's, and no text is copied. The resulting version list is the one of Section 7.

`comments`:

- `L.fetchedAt := article.comments_fetched_at` (`NULL` compares below every instant).
- Comments are inserted with `INSERT ... ON DUPLICATE KEY UPDATE id = id`; a comment ID stored under
  another article stays unchanged. `authorId` and `publishedAt` of an existing comment stay
  unchanged.
- `comments_fetched_at := max(L.fetchedAt, I.fetchedAt)`, assigning `updated_at` to itself.
- For an article absent locally the comments are stored and `fetchedAt` is discarded, because the
  article row that would hold it does not exist.

`pastes`: as `articles` for rules 1–3 with `content`, `content_hash`, `author_id`, `publish_time` and
`checked_at`; a missing paste is inserted with `deleted = 0` and the default `delete_reason`. When
the merge changes `content` or inserts the paste, `updated_at := I.checkedAt`; otherwise `updated_at`
is assigned to itself.

`judgements`:

- The duplicate key is `createJudgementDedupKey` of `judgement-system.spec.md` Section 2.1, which
  equals Section 6.7's key.
- When a page inserts at least one record, one `judgement_fetch_log` row with `source = 'peer'`,
  `status = 'success'`, `record_count` = number of valid judgement items, `new_record_count`,
  `skipped_count = record_count − new_record_count` and `raw_response = NULL` is written in the page
  transaction, and its ID is the inserted records' `fetch_log_id`.
- `user_snapshot := I.user`; `full_record := {user, time: unixSeconds(I.time), reason, revokedPermission, addedPermission}`.

### 12.7 Side Effects

After a page transaction commits, and never before:

1. Delete in one Redis call every affected key: `user:{uid}` for every written user or profile
   version list; `article:{id}` for every written article row; `article_history:{id}` for every
   written article version list; `article:count` when an article was inserted; `paste:{id}` for every
   written paste; `paste:count` when a paste was inserted. Failures are logged by `evictCache`.
2. Call `SearchService.upsertArticlesByIds(ids)` once with the IDs of every written `article` row
   (`search-system.spec.md` Section 7.3). A failure SHALL be logged and SHALL NOT stop the round.
3. Applying a page SHALL NOT create tasks or workflows, emit Socket.IO events, request Luogu, call an
   LLM, write Chroma, or change censorship data.

## 13. Invariants

1. No feed request writes the database.
2. Every page transaction either commits all of its item writes together with its cursor or none of
   them.
3. Every `user` row satisfies `profile_fetched_at IS NULL OR profile_fetched_at <= updated_at`.
   Local profile saves write `profile_fetched_at` (truncated to seconds) and
   `updated_at = CURRENT_TIMESTAMP` in one statement; peer merges write
   `updated_at := max(changedAt, profile.fetchedAt)`.
4. A taken-down article or paste is never served, written by import, or given versions or comments by
   import. Versions and comments of a taken-down article are never served.
5. Profile versions of a user with `profile_history_enabled = 0` are neither served nor imported.
6. Re-applying a page that was already applied leaves every row unchanged except `peer_cursor`.

## 14. File Locations

- Feed router: `packages/backend/src/routers/peer.router.ts`
- Feed queries: `packages/backend/src/services/peer-export.service.ts`
- Import writes: `packages/backend/src/services/peer-import.service.ts`
- Scheduler and HTTP client: `packages/backend/src/services/peer-sync-scheduler.service.ts`
- Pure merge functions: `packages/backend/src/services/helpers/peer-merge.helper.ts`
- Item validation: `packages/backend/src/services/helpers/peer-items.helper.ts`
- Profile snapshot normalization: `packages/backend/src/services/helpers/profile-snapshot.helper.ts`
- Instants and cursors: `packages/backend/src/services/helpers/peer-time.helper.ts`
- Cursor entity: `packages/backend/src/entities/peer-cursor.ts`
- Configuration schema: `packages/backend/src/config/schemas/peer.ts`
