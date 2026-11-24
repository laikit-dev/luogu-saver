# User Archive System Specification

## 1. Scope and Identity

This specification defines public user archive timelines, author article lists, and public profile snapshots.

`luoguUid` identifies a public `user.id`. Public endpoints SHALL NOT expose registered-user bindings, account creation times, deletion requests, or the identity of a person who triggered archiving.

Public archive endpoints SHALL be read-only. They SHALL NOT create tasks, refresh profiles, crawl authors, or contact Luogu, an LLM, Meilisearch, or Chroma. Existing manual refresh permissions SHALL remain unchanged.

Backend archive types SHALL be declared in their owning modules, with paths relative to `packages/backend`:

- `src/utils/archive-query.ts`: `ArchiveKind`, `TimelineQuery`, `AuthorArticlesQuery`, and `ArchiveArticleSummary`.
- `src/services/user-timeline.service.ts`: `ArchiveEvent`, `TimelinePage`, `ArchiveArticlePage`, and `ArchiveStats`.
- `src/entities/user-profile-history.ts`: `ProfileSnapshotData`.
- `src/services/user-profile-history.service.ts`: `ProfileVersionMetadata` and `ProfileVersionSnapshot`.

These declarations SHALL NOT be duplicated or re-exported from `src/shared`. Their fields and wire representations SHALL remain unchanged by type relocation.

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

Each appended snapshot SHALL increment `profile_history_version`. Existing snapshots SHALL NOT be mutated when later profile values change. User cache invalidation SHALL occur after the owning transaction completes, using the existing non-throwing cache eviction operation.

Recording SHALL be enabled by default, without opt-in. Retained snapshots SHALL be publicly readable and selectable like article versions. Existing installations SHALL not fabricate past snapshots: a baseline is recorded by the next successful full-profile save. The profile handler SHALL allow baseline recording even when the current profile values are unchanged; it SHALL emit the existing update event when the profile or its publicly visible history changes.

Only an authenticated account whose `registered_user.luogu_uid` equals the target UID SHALL change recording preferences. Setting recording to false SHALL stop future snapshot creation while preserving the latest public profile and existing retained history. Re-enabling SHALL resume recording on the next full-profile save. The backend SHALL NOT expose a public-profile history clearing endpoint or a service method that clears retained profile snapshots. Existing profiles, snapshots, recording preferences, and version counters SHALL remain unchanged by removal of the clearing feature.

Endpoints under the existing `/user` prefix:

- `GET /history/:id`: public; returns `{ versions: [{ version, observedAt, name }], latestVersion }`, ordered by version descending; `latestVersion` is null when no snapshot remains. There is no four-version cap.
- `GET /history/:id/:version`: public; returns `{ version, observedAt, profile }` for that UID and version, or 404.
- `GET /history/:id/settings`: owner-only; returns `{ recordingEnabled }`.
- `POST /history/:id/settings`: owner-only; accepts `{ recordingEnabled: boolean }` and returns that state.

UID and version inputs SHALL be integers in `1..4294967295`. Invalid inputs return 400; authentication failures return 401/403 according to existing middleware. An unknown version SHALL NOT silently return the current profile.

## 3. Timeline Events

Supported kinds SHALL be `article`, `version`, and `profile`, with fixed sort ranks 1, 2, and 3.

- `article`: one first-archive event per currently non-deleted article; local time comes from `article.created_at`; event ID is `article:{article.id}`.
- `version`: one event per `article_history` row with `version > 1` whose owning article is currently non-deleted; local time comes from history `created_at`; event ID is `version:{history.id}`.
- `profile`: one event per retained public profile snapshot; local time comes from snapshot `created_at`; event ID is `profile:{history.id}`.

Article history version 1 SHALL NOT duplicate the first-archive event. A forced save can create an identical article snapshot; the UI SHALL describe it as an archive version, not proof of an upstream edit. Summary, search-index, view-count, and publish-time-only updates SHALL NOT create timeline events.

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

Archive queries SHALL interpret stored `DATETIME` values through the same database-driver date conversion as entity reads. They SHALL NOT use the database session timezone to independently convert those values to Unix timestamps. Timeline and author-article dates, UTC filter bounds, and cursor bounds SHALL use that same interpretation without rewriting retained data or changing the connection timezone.

Generated archive labels SHALL use Chinese. Source titles and names SHALL remain unchanged.

Public timeline requests SHALL filter by the requested Luogu UID.

Clipboard records SHALL NOT enter a public timeline: the current storage does not preserve their upstream public flag. Existing judgement records SHALL remain in their existing UI/API, not be copied into the archive event projection.

Queries SHALL project metadata only, apply current visibility in the database before pagination, and avoid per-event hydration queries. They SHALL not depend on a search index. Timelines SHALL aggregate the authoritative tables without a separate event log or generic event bus.

## 4. Timeline Query Contract

`UserTimelineService` SHALL provide:

- `listForUser(uid, query = {})`.
- `articlesForUser(uid, query = {})`.
- `statsForUser(uid)`.

Timeline query fields SHALL be `kinds?: ArchiveKind[]`, `from?: string`, `to?: string`, `cursor?: string`, and `limit?: number`. HTTP `kinds` is comma-separated. Missing kinds means all kinds. Bounds use `[from, to)`, and supplied bounds SHALL be valid UTC ISO dates with `from < to`. Unknown kinds, malformed bounds, and malformed cursors return 400. Limit defaults to 20 and is bounded to 1..50. HTTP route handlers in `archive.router.ts` SHALL parse and validate raw request parameters once at the boundary; service methods SHALL consume validated typed inputs without re-stringifying and re-parsing them.
The page shape SHALL be `{ items: ArchiveEvent[], nextCursor: string | null }`. Queries SHALL use keyset pagination, not OFFSET. Sort keys SHALL be `(observedAtMs DESC, kindRank DESC, sortId DESC)`; IDs of numeric history rows SHALL use a fixed-width decimal sort key, and article IDs SHALL use their stable string key. The SQL cursor predicate SHALL use the same millisecond normalization as ordering, including for database timestamps with finer precision. Cursors SHALL bind to the scope and filters that created them. A static visible dataset SHALL paginate without duplicate or missing events. Cross-request snapshot isolation is not promised when source data changes.

SQL projections SHALL truncate sub-millisecond fractions while retaining the `DATETIME` type. Filter and cursor times SHALL be bound as `Date` parameters through the database driver. Archive cursors SHALL use format version 2; version-1 cursors based on the former session-timezone conversion SHALL return 400 rather than silently skip or repeat records. Restarting with a first-page request SHALL issue the current cursor format.

Timeline and author-article outer queries SHALL construct optional filters, ordering, and row limits with TypeORM QueryBuilder instead of interpolating complete clauses into a SELECT template. The author-article projection SHALL resolve persisted article columns through `Article` entity metadata. Publication-time normalization, null placement, and keyset sort keys SHALL remain unchanged.

Cursor decoding SHALL catch only JSON parsing failures. Base64url round-trip validation and decoded-envelope validation SHALL execute outside that catch block. Every rejected encoding, JSON value, or cursor envelope SHALL continue to return application error code 400.

Public endpoints under `/archive`:

- `GET /user/:uid/timeline`: timeline query above.
- `GET /user/:uid/stats`: returns `{ articles, versions, profiles }`; versions counts history rows above version 1 for visible articles.
- `GET /user/:uid/articles`: returns `{ items, nextCursor }` for non-deleted articles. Query fields are `cursor`, `limit` (20, maximum 50), optional integer `category`, and `sort=archived|published` (default archived). Published sorting SHALL put unknown publication times last, without inventing them. Article cards SHALL return `{ id, title, category, summary, createdAt, publishedAt }`; summary is a plain preview of at most 200 characters and body content is omitted.

## 5. Removed Article Version Comparison

The backend SHALL NOT expose `GET /archive/article/:id/versions` or `GET /archive/article/:id/compare`, and `ArticleHistoryService` SHALL NOT expose `listVersionMetadata` or `compareVersions`.

The article page SHALL NOT expose version comparison controls, Markdown source diff computation, or `?compareFrom` / `?compareTo` comparison mode. Stored `article_history` records SHALL remain unchanged and readable via `GET /article/history/:id`.

The article permalink SHALL preserve `?version=N`. Profile snapshot links SHALL use `/user/:uid?version=N`.

## 6. Removed Private Library

The backend SHALL NOT mount `/library` endpoints, register private follow/saved-article/digest
entities, query private archive feeds, or start an archive digest scheduler. The frontend SHALL NOT
expose a private library route, follow/save-for-later actions, digest preferences, or digest navigation.
Recommendations SHALL NOT read private follow or saved-article tables. Existing public archives,
local paragraph bookmarks, and generic user notifications SHALL remain.
Removing these entity modules SHALL NOT execute data-deletion commands against existing tables.

## 7. Frontend Surfaces

The public profile page SHALL offer current profile, selectable historical profile snapshots, author article list, and existing judgement records. The frontend SHALL NOT expose profile clearing actions, confirmation dialogs, clearing API calls, or cleared-event refresh wiring. The read-only profile history panel SHALL NOT fetch owner-only recording settings. A historical profile SHALL be visibly labeled and SHALL not masquerade as the current avatar or current profile.

The profile page SHALL distinguish stored-profile freshness from refresh execution. The running indicator SHALL be driven by a refresh submission in progress or a tracked `profileRefreshTaskId`, never by `profileStale`. Both automatically submitted and manually submitted task IDs SHALL use the existing task-room completion/failure events and terminal-state replay on room join. Terminal failure SHALL stop the running indicator without marking stale data fresh. Automatic submission/task failure SHALL leave the stored profile visible with a retryable error state.

Task completion SHALL reload the current profile even when the saved values are unchanged and no `profile-updated` event is emitted. Events for a task already tracked by the page SHALL not additionally prompt an update before task completion. Changing UID or unmounting SHALL discard the old task listener and prevent its callbacks from changing the new page state.

The profile page's judgement-record pagination SHALL clear retained rows and totals on both unsuccessful API response codes and rejected requests. A failed page SHALL show an error without rendering records retained from another page.

All archive surfaces SHALL use existing theme tokens and Naive UI primitives, support desktop/narrow layouts and light/dark themes, show loading/empty/error states, and avoid stale request results when route/filter/version changes. No control may report success without its underlying API operation succeeding.

## 8. Verification Requirements

Behavior checks SHALL cover unknown/deleted targets, identical snapshots, UID/version mismatches, malformed cursors and time bounds, same-millisecond pagination ties, profile save rollback/concurrency/unchanged refresh, pause/resume semantics, and disabled-search independence.
Runtime smoke SHALL exercise actual database/Redis-backed backend operations and the rendered frontend. Tests SHALL not pin incidental wording or source text. Temporary fixtures SHALL not modify production data.
