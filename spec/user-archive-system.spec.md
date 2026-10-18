# User Archive System Specification

## 1. Scope and Identity

This specification defines public user archive timelines, author article lists, article version comparison, public profile snapshots, public RSS feeds, private follows and saved articles, and opt-in archive digests.

`luoguUid` identifies a public `user.id`. `ownerId` identifies an authenticated `registered_user.id`. Public endpoints SHALL NOT expose registered-user bindings, account creation times, deletion requests, or the identity of a person who triggered archiving.

Public archive endpoints SHALL be read-only. They SHALL NOT create tasks, refresh profiles, crawl authors, or contact Luogu, an LLM, Meilisearch, or Chroma. Following or saving an article SHALL NOT trigger crawling. Existing manual refresh and administrator discovery permissions SHALL remain unchanged.

## 2. Public Profile History

The `user` entity SHALL add `profile_history_enabled BOOLEAN NOT NULL DEFAULT true` and `profile_history_version INT UNSIGNED NOT NULL DEFAULT 0`.

The `user_profile_history` table SHALL contain:

- `id INT UNSIGNED` as an auto-increment primary key.
- `user_id INT UNSIGNED NOT NULL`, referring to `user.id` with cascading deletion.
- `version INT UNSIGNED NOT NULL`.
- `snapshot JSON NOT NULL`.
- `created_at DATETIME NOT NULL` as the local observation time.
- A unique constraint over `(user_id, version)` and an index supporting `(user_id, created_at, id)` reads.

A snapshot SHALL contain exactly `id`, `name`, `color`, `ccfLevel`, `xcpcLevel`, `slogan`, `introduction`, and `prizes`. It SHALL NOT contain a login account, token, avatar file, task, or deletion-request data. Avatar images SHALL remain current upstream images, not historical assets.

A successful full-profile save SHALL compare normalized profile values within its database transaction. It SHALL append one snapshot when recording is enabled and either no retained snapshot exists or the values differ from the latest retained snapshot. The first snapshot is a baseline, not evidence of a new Luogu account or an upstream edit. An identical refresh with a retained matching snapshot SHALL NOT append another version. Timestamp changes alone SHALL NOT create versions.

Inline author-summary upserts SHALL NOT create full-profile history. Full-profile persistence and snapshot insertion SHALL commit or roll back together. Concurrent saves SHALL serialize the per-user version allocation; rolled-back attempts SHALL NOT leave a snapshot. Missing users SHALL be inserted without first holding a gap lock, with duplicate creation handled through the existing-row path. Transaction conflicts SHALL use the existing transaction-conflict retry helper with a new transaction per attempt.

Each appended snapshot SHALL increment `profile_history_version`. Clearing history SHALL NOT reset this counter. Existing snapshots SHALL NOT be mutated when later profile values change. User cache invalidation SHALL occur after the owning transaction completes, using the existing non-throwing cache eviction operation.

Recording SHALL be enabled by default, without opt-in. Retained snapshots SHALL be publicly readable and selectable like article versions. Existing installations SHALL not fabricate past snapshots: a baseline is recorded by the next successful full-profile save. The profile handler SHALL allow baseline recording even when the current profile values are unchanged; it SHALL emit the existing update event when the profile or its publicly visible history changes.

Only an authenticated account whose `registered_user.luogu_uid` equals the target UID SHALL change recording preferences or clear that user's history. Setting recording to false SHALL stop future snapshot creation while preserving the latest public profile and existing retained history. Clearing history SHALL delete all retained snapshots and disable recording in the same transaction. Re-enabling SHALL resume recording on the next full-profile save. Public history, timelines, and RSS SHALL immediately stop returning cleared snapshots; no history response cache SHALL bypass this rule.

Endpoints under the existing `/user` prefix:

- `GET /history/:id`: public; returns `{ versions: [{ version, observedAt, name }], latestVersion }`, ordered by version descending; `latestVersion` is null when no snapshot remains. There is no four-version cap.
- `GET /history/:id/:version`: public; returns `{ version, observedAt, profile }` for that UID and version, or 404.
- `GET /history/:id/settings`: owner-only; returns `{ recordingEnabled }`.
- `POST /history/:id/settings`: owner-only; accepts `{ recordingEnabled: boolean }` and returns that state.
- `POST /history/:id/clear`: owner-only; returns `{ deleted, recordingEnabled: false }` after the transaction commits.

UID and version inputs SHALL be integers in `1..4294967295`. Invalid inputs return 400; authentication failures return 401/403 according to existing middleware. An unknown version SHALL NOT silently return the current profile.

The profile UI SHALL also allow comparison of any two retained profile snapshots. It SHALL show
name, color, level, slogan, prize-list, and introduction differences without interpreting observation
times as upstream edit times. It MAY retrieve the two snapshots through the existing version-detail
endpoint. Identical fields SHALL be identified as unchanged, and introduction diffs SHALL use escaped
Markdown source. A missing or cleared snapshot SHALL not fall back to the current profile.

## 3. Timeline Events

Supported kinds SHALL be `article`, `version`, and `profile`, with fixed sort ranks 1, 2, and 3.

- `article`: one first-archive event per currently non-deleted article; local time comes from `article.created_at`; event ID is `article:{article.id}`.
- `version`: one event per `article_history` row with `version > 1` whose owning article is currently non-deleted; local time comes from history `created_at`; event ID is `version:{history.id}`.
- `profile`: one event per retained public profile snapshot; local time comes from snapshot `created_at`; event ID is `profile:{history.id}`.

Article history version 1 SHALL NOT duplicate the first-archive event. A forced save can create an identical article snapshot; the UI and RSS SHALL describe it as an archive version, not proof of an upstream edit. Summary, search-index, view-count, and publish-time-only updates SHALL NOT create timeline events.

Each event SHALL return:

```typescript
interface ArchiveEvent {
    eventId: string;
    kind: 'article' | 'version' | 'profile';
    observedAt: string;
    uid: number;
    title: string;
    articleId: string | null;
    version: number | null;
    publishedAt: string | null;
}
```

Dates in responses SHALL be ISO-8601 UTC strings. `observedAt` SHALL denote local archive observation, never a claimed upstream edit time. `publishedAt` SHALL use the valid persisted Luogu publication time when available, and otherwise be null. It SHALL NOT substitute a local timestamp. Article event titles describe the current article link; version event titles come from the stored version. Profile titles SHALL identify a profile snapshot without including the biography or slogan.

Archive queries SHALL interpret stored `DATETIME` values through the same database-driver date conversion as entity reads. They SHALL NOT use the database session timezone to independently convert those values to Unix timestamps. Timeline and author-article dates, UTC filter bounds, cursor bounds, and RSS dates SHALL use that same interpretation without rewriting retained data or changing the connection timezone.

Generated archive labels and RSS descriptions SHALL use Chinese. Source titles and names SHALL
remain unchanged, and RSS pubDate SHALL retain the standard machine-readable RFC date format.

Public timeline requests SHALL filter by the requested Luogu UID. Private feed requests SHALL include article events matched by either a followed UID or a saved article ID, and profile events matched by a followed UID. A record matching both private sources SHALL appear once.

Clipboard records SHALL NOT enter a public timeline or RSS feed: the current storage does not preserve their upstream public flag. Existing judgement records SHALL remain in their existing independently redacted UI/API, not be copied into the archive event projection.

Queries SHALL project metadata only, apply current visibility in the database before pagination, and avoid per-event hydration queries. They SHALL not depend on a search index. Timelines SHALL aggregate the authoritative tables without a separate event log or generic event bus.

## 4. Timeline Query Contract

`UserTimelineService` SHALL provide:

- `listForUser(uid, query = {})`.
- `listForOwner(ownerId, query = {})`.
- `countForOwner(ownerId, from: Date, to: Date, manager?)` for digest generation.
- `articlesForUser(uid, query = {})`.
- `statsForUser(uid)`.

Timeline query fields SHALL be `kinds?: ArchiveKind[]`, `from?: string`, `to?: string`, `cursor?: string`, and `limit?: number`. HTTP `kinds` is comma-separated. Missing kinds means all kinds. Bounds use `[from, to)`, and supplied bounds SHALL be valid UTC ISO dates with `from < to`. Unknown kinds, malformed bounds, and malformed cursors return 400. Limit defaults to 20 and is bounded to 1..50.

The page shape SHALL be `{ items: ArchiveEvent[], nextCursor: string | null }`. Queries SHALL use keyset pagination, not OFFSET. Sort keys SHALL be `(observedAtMs DESC, kindRank DESC, sortId DESC)`; IDs of numeric history rows SHALL use a fixed-width decimal sort key, and article IDs SHALL use their stable string key. The SQL cursor predicate SHALL use the same millisecond normalization as ordering, including for database timestamps with finer precision. Cursors SHALL bind to the scope and filters that created them. A static visible dataset SHALL paginate without duplicate or missing events. Cross-request snapshot isolation is not promised when source data changes.

SQL projections SHALL truncate sub-millisecond fractions while retaining the `DATETIME` type. Filter and cursor times SHALL be bound as `Date` parameters through the database driver. Archive cursors SHALL use format version 2; version-1 cursors based on the former session-timezone conversion SHALL return 400 rather than silently skip or repeat records. Restarting with a first-page request SHALL issue the current cursor format.

`countForOwner` SHALL count only currently visible events in `[from, to)` that occurred at or after the matching follow/save relationship was created. It SHALL accept an existing EntityManager so digest creation and its checkpoint can share a transaction. Ordinary private feed listing MAY include older matching history.

Public endpoints under `/archive`:

- `GET /user/:uid/timeline`: timeline query above.
- `GET /user/:uid/stats`: returns `{ articles, versions, profiles }`; versions counts history rows above version 1 for visible articles.
- `GET /user/:uid/articles`: returns `{ items, nextCursor }` for non-deleted articles. Query fields are `cursor`, `limit` (20, maximum 50), optional integer `category`, and `sort=archived|published` (default archived). Published sorting SHALL put unknown publication times last, without inventing them. Article cards SHALL return `{ id, title, category, summary, createdAt, publishedAt }`; summary is a plain preview of at most 200 characters and body content is omitted.

## 5. Article Version Comparison

Endpoints under `/archive`:

- `GET /article/:id/versions`: returns `{ versions: [{ version, createdAt, title }], latestVersion }`, descending by version, without article bodies. All existing versions SHALL be selectable; there is no four-version cap.
- `GET /article/:id/compare?from=N&to=M`: returns `{ from, to }`, each containing `{ version, createdAt, title, content }` for that article's existing version. N and M SHALL be distinct integers in `1..4294967295`. Missing versions return 404, invalid inputs return 400.

These endpoints SHALL verify the owning article's current existence and deletion state before returning any historical data. They SHALL not return historical content for a deleted article, including when invoked from an old link. Frontend comparison SHALL support any two existing versions, show title changes and Markdown source line additions/deletions, and report identical content accurately. Comparison SHALL be computed only when opened, not for every timeline item. Raw diff text SHALL be escaped, not inserted as HTML.

The article permalink SHALL preserve `?version=N`. Comparison links SHALL use `?compareFrom=N&compareTo=M`. Profile snapshot links SHALL use `/user/:uid?version=N`.

## 6. RSS

`GET /archive/user/:uid/rss` SHALL return RSS 2.0 XML rather than the JSON API envelope. Optional `kinds` SHALL use the public timeline kinds. The feed SHALL contain at most the latest 50 currently visible public events in timeline order. A valid UID with no visible events SHALL produce an empty valid feed.

Items SHALL have stable non-permalink GUIDs derived from event IDs, absolute frontend links, an observation-based pubDate, and a textual description identifying local archive observation. Feed titles, links, and descriptions SHALL be XML-safe. Neither article/profile bodies, authentication data, private follows, saved lists, nor deletion requests SHALL be embedded in RSS.

`archive.publicBaseUrl` SHALL be an exact HTTP(S) frontend origin without credentials, query, fragment, or path; its development default is `http://localhost:5173`. Operators SHALL configure the public frontend origin for production. Links SHALL not trust a request Host header.

Responses SHALL use `application/rss+xml; charset=utf-8`, an ETag derived from the currently rendered feed, and `Cache-Control: no-cache`. Matching If-None-Match may return 304 only after visibility has been re-evaluated. Removing an article or clearing profile history SHALL change the feed when it removes an included item. RSS readers' previously downloaded copies cannot be revoked by the server.

The profile page SHALL expose a visible RSS link/copy action and an HTML alternate-feed link for its UID. The URL SHALL use the frontend's configured API base URL. Public RSS SHALL not include a private personal feed token or infer private relationships.

## 7. Private Follows and Saved Articles

`user_follow` SHALL contain an auto-increment `id`, `owner_id` referencing `registered_user.id`, `luogu_uid`, and `created_at`; `(owner_id, luogu_uid)` SHALL be unique. The target UID need not yet be mirrored in `user`; no implicit lookup or crawl is permitted.

`saved_article` SHALL contain an auto-increment `id`, `owner_id` referencing `registered_user.id`, `article_id` referencing `article.id`, and `created_at`; `(owner_id, article_id)` SHALL be unique. Owner deletion SHALL cascade these private rows.

Both relationship `created_at` columns SHALL use `DATETIME(3)` with `CURRENT_TIMESTAMP(3)` as
their default. The default expression precision SHALL match the column precision so initial schema
synchronization can create these tables on MySQL-compatible databases.

All `/library` endpoints SHALL require LOGIN and derive ownerId exclusively from `ctx.user.id`. They SHALL not accept an alternate ownerId from a request. Follows and saved articles SHALL not expose public counts or public owner lists.

- `GET /library/follows?page=1&pageSize=20`: returns `{ items: [{ uid, name, color, followedAt }], total, page, pageSize }`; absent public user data yields null name/color.
- `GET /library/follows/:uid`: returns `{ following }` for the current owner.
- `PUT /library/follows/:uid` and `DELETE /library/follows/:uid`: idempotently add/remove and return `{ following }`.
- `GET /library/saved?page=1&pageSize=20`: returns `{ items: [{ articleId, savedAt, available, article }], total, page, pageSize }`. A deleted/missing target returns `available=false, article=null`, without title, content, or deletion reason. Available article uses the article-card shape of section 4.
- `GET /library/saved/:articleId`: returns `{ saved }` for the owner.
- `PUT /library/saved/:articleId`: requires a currently non-deleted article and idempotently returns `{ saved: true }`.
- `DELETE /library/saved/:articleId`: idempotently returns `{ saved: false }`, including for an unavailable target.
- `GET /library/feed`: returns `UserTimelineService.listForOwner(ctx.user.id, query)` with section 4 pagination.

List page sizes SHALL default to 20 and be bounded to 1..100. Entries SHALL be ordered by local creation time descending, then relation ID descending. Joins SHALL be batched, not one query per item. The existing local paragraph bookmarks SHALL remain separate and unchanged.

## 8. Opt-in Archive Digests

`archive_digest_preference` SHALL have `owner_id` as primary key referencing registered_user, `enabled BOOLEAN NOT NULL DEFAULT false`, nullable `last_digest_at` and `next_digest_at`, and an index for due enabled preferences.

- `GET /library/digest`: returns `{ enabled, nextDigestAt }`; absence means disabled.
- `POST /library/digest`: accepts `{ enabled: boolean }`. First enable or re-enable SHALL start its checkpoint at now and set nextDigestAt to now plus 24 hours. Repeating the current state SHALL be idempotent. Disable SHALL prevent future sends and clear nextDigestAt.

`ArchiveDigestScheduler.start()` SHALL check due preferences on startup and every `archive.digestPollIntervalMs` (default 900000, minimum 60000). It SHALL not overlap its own running pass and its timer SHALL be unref'd. `stop()` SHALL clear the timer. `sendDueDigests(now = new Date())` SHALL be callable without starting a timer.

For each due owner, the scheduler SHALL lock that preference in a transaction, recheck enabled/due state, count visible eligible events from lastDigestAt inclusive to now exclusive, and, when the count is positive, create one `user_notification` with type `archive_digest` through the same EntityManager. It SHALL then advance lastDigestAt to now and nextDigestAt to now plus 24 hours, including when the count is zero. Notification and checkpoint SHALL commit or roll back together. Concurrent scheduler instances SHALL not create duplicate digests for one due checkpoint. Per-owner failures SHALL not prevent other due owners from being processed.

Digest title/content SHALL be generic and contain an event count, not archived titles, biographies, slogans, or article bodies. Metadata SHALL be `{ kind: 'archive_digest', eventCount, from, to }`. UI navigation SHALL map that known kind to `/library?tab=feed`, not render an arbitrary metadata URL. The feed SHALL re-evaluate current visibility when opened. A digest summarizes records committed and visible when generated; it is not a guaranteed delivery log for every archive event.

## 9. Frontend Surfaces

The public profile page SHALL offer current profile, selectable historical profile snapshots, archive timeline, author article list, existing judgement records, RSS, and a private follow action. Its timeline SHALL distinguish archive observation from source publication, group by month, support kind/date filters, and load more by cursor. Owner-only history controls SHALL support pause/resume and confirm before clearing history. A historical profile SHALL be visibly labeled and SHALL not masquerade as the current avatar or current profile.

The profile page's judgement-record pagination SHALL clear retained rows and totals on both unsuccessful API response codes and rejected requests. A failed page SHALL show an error without rendering records retained from another page.

The article page SHALL offer arbitrary two-version comparison, a shareable comparison URL, and a private save-for-later action. The library page SHALL expose feed, followed authors, saved articles, and digest preference controls. Logged-out visitors SHALL see a real login action, not fake private data. Navigation SHALL include the library entry; notifications SHALL support the controlled digest link.

All new surfaces SHALL use existing theme tokens and Naive UI primitives, support desktop/narrow layouts and light/dark themes, show loading/empty/error states, and avoid stale request results when route/filter/version changes. No control may report success without its underlying API operation succeeding.

## 10. Verification Requirements

Behavior checks SHALL cover owner isolation, duplicate relationship requests, unknown/deleted targets, arbitrary article versions including versions above 4, identical snapshots, UID/version mismatches, malformed cursors and time bounds, same-millisecond pagination ties, profile save rollback/concurrency/unchanged refresh, pause/clear semantics, RSS XML escaping and stable GUIDs, conditional requests after deletion, digest checkpoint rollback and concurrent execution, and disabled-search independence.

Runtime smoke SHALL exercise actual database/Redis-backed backend operations and the rendered frontend. Tests SHALL not pin incidental wording or source text. Temporary fixtures SHALL not modify production data.
