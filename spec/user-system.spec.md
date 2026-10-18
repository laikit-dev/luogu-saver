# User System Specification

## 1. Overview

The user system stores Luogu user records mirrored from the upstream platform. Beyond identity (`id`, `name`) and the dynamic color level (`color`), it records the user's award certification levels (OI / XCPC), the full award history when available, and metadata used to manage the freshness of the cached profile.

The system exposes:

1. Inline read paths used by content handlers (article, paste): `id`, `name`, `color`, `ccfLevel`, `xcpcLevel`.
2. A profile read path used by the user homepage: all of the above plus `prizes` and `profileFetchedAt`.
3. A `save:profile` task that fetches the full Luogu user page and refreshes the profile-only fields.
4. Public, default-on full-profile snapshots with arbitrary retained-version selection and owner-only pause/resume/clear controls, as defined in `spec/user-archive-system.spec.md` Section 2.

## 2. User Entity

### 2.1 Schema

Table name: `user`

| Column                    | Type         | Constraints              | Description                                                 |
| ------------------------- | ------------ | ------------------------ | ----------------------------------------------------------- |
| `id`                      | INT UNSIGNED | PRIMARY KEY              | Luogu user ID                                               |
| `name`                    | VARCHAR      | NOT NULL                 | Luogu user name                                             |
| `color`                   | VARCHAR      | NOT NULL                 | Dynamic level color (UserColor enum)                        |
| `ccf_level`               | INT          | NOT NULL, DEFAULT `0`    | OI / CCF certification level (`0` = none)                   |
| `xcpc_level`              | INT          | NOT NULL, DEFAULT `0`    | ICPC / CCPC certification level (`0` = none)                |
| `slogan`                  | TEXT         | NULLABLE                 | Short profile tagline as raw text                           |
| `introduction`            | MEDIUMTEXT   | NULLABLE                 | Long profile introduction as raw Markdown                   |
| `prizes`                  | JSON         | NULLABLE                 | Array of `UserPrize` records; `NULL` if not fetched         |
| `profile_fetched_at`      | DATETIME     | NULLABLE                 | Timestamp of the last successful profile fetch              |
| `profile_history_enabled` | BOOLEAN      | NOT NULL, DEFAULT `true` | Whether future full-profile saves record public snapshots   |
| `profile_history_version` | INT UNSIGNED | NOT NULL, DEFAULT `0`    | Monotonic snapshot counter, retained after clearing history |
| `created_at`              | DATETIME     | NOT NULL                 | Record creation timestamp                                   |
| `updated_at`              | DATETIME     | NOT NULL                 | Record update timestamp                                     |

### 2.2 UserColor Enum

Unchanged from `packages/backend/src/shared/user.ts`. Values: `Gray`, `Blue`, `Green`, `Orange`, `Red`, `Purple`, `Cheater`.

### 2.3 UserPrize Type

```typescript
interface UserPrize {
    year: number; // Award year, e.g. 2023
    contest: string; // Contest name, free-form string from Luogu (e.g. "NOI", "CSP-S")
    event: string | null; // Contest sub-event, free-form string or null (e.g. "The 2026 Universal Cup Finals")
    prize: string; // Award level, free-form string from Luogu (e.g. "金牌", "一等奖")
    score?: number; // Score achieved at the contest, if available
    rank?: number; // Rank achieved at the contest, if available
}
```

`UserPrize` is stored as one element of the `prizes` JSON array. The shape mirrors the inner `prize` object inside `response.data.prizes[i].prize` from Luogu's user-page response. See `packages/backend/src/types/luogu-api.d.ts`, interface `LuoguPrize`.

### 2.4 Level Semantics

- `ccfLevel === 0` means the user has no OI certification, OR the user has chosen not to display it on Luogu. The system treats these cases identically.
- `xcpcLevel === 0` means the user has no XCPC certification, OR has chosen not to display it. Identical treatment.
- A non-zero level always implies the certification is publicly visible.

The display layer is responsible for mapping `ccfLevel` / `xcpcLevel` to badge colors; this entity holds only the integer value.

### 2.5 Profile Freshness

A user profile (`prizes`, `profile_fetched_at`) is **stale** if any of the following hold:

1. `profile_fetched_at IS NULL`.
2. `now() - profile_fetched_at > PROFILE_TTL_MS` where `PROFILE_TTL_MS = 24 * 60 * 60 * 1000` (24 hours).

A stale profile MAY still be returned to clients; staleness only triggers a background refresh task as described in Section 5.

### 2.6 Public Profile History

`user_profile_history` SHALL contain an unsigned auto-increment `id`, `user_id` referencing `user.id` with cascading deletion, unsigned `version`, immutable `snapshot JSON`, and local observation time `created_at DATETIME`. `(user_id, version)` SHALL be unique; `(user_id, created_at, id)` SHALL be indexed.

Each snapshot SHALL contain exactly `id`, `name`, `color`, `ccfLevel`, `xcpcLevel`, `slogan`, `introduction`, and `prizes`. Normalization maps missing certification levels to zero, absent/empty slogans and introductions to null, absent prizes to an empty array, and each prize to its defined public fields. No account, token, task, avatar asset, or deletion-request data is retained. Historical avatar assets are not stored.

Recording SHALL be enabled by default. Existing installations record a baseline on the next successful full-profile save, even when current profile values are unchanged. Enabled recording appends only when no retained baseline exists or normalized values differ from the latest retained snapshot. Timestamps alone do not create versions. Later input mutations and profile changes SHALL NOT mutate prior snapshots.

Clearing deletes all retained snapshots and disables recording atomically, without resetting the version counter or changing the current profile. Pausing retains public history; re-enabling records on the next full-profile save. All fresh public history, timeline, and RSS output SHALL reflect clearing without a history response cache.

## 3. Upsert Semantics (from Luogu UserSummary)

Inline content handlers (article, paste) call `UserService.upsertLuoguUser(data)` with the result of `buildUser(luoguUser)`.

`buildUser(user: UserSummary): Partial<User>` MUST produce:

```typescript
{
    id: user.uid,
    name: user.name,
    color: user.color as UserColor,
    ccfLevel: user.ccfLevel ?? 0,
    xcpcLevel: user.xcpcLevel ?? 0
}
```

`buildUser` MUST NOT touch `slogan`, `introduction`, `prizes`, or `profileFetchedAt`. These fields are only written by the profile task handler (Section 5).

`UserService.upsertLuoguUser`:

1. Requires `data.id` to be defined; throws otherwise.
2. Performs a TypeORM upsert on the primary key.
3. Evicts the cache key `user:{id}`.
4. Does NOT mutate `slogan`, `introduction`, `prizes`, `profile_fetched_at`, or profile-history controls/counter even if `data` happens to contain them.
5. Does NOT record full-profile snapshots.

This invariant guarantees that the cheap inline path never clobbers richer data fetched by the profile task or records a partial historical profile.

## 4. UserService API

Repository read and inline-write methods accept an optional `EntityManager`. The full-profile save and history-control writes own their transactions so each transaction-conflict retry starts a new transaction and user-cache eviction occurs only after commit.

### 4.1 `getUserById(id: number, manager?): Promise<User | null>`

1. Cached under `user:{id}` for 600 seconds.
2. Returns the full `User` row including `prizes` and `profileFetchedAt`.

### 4.2 `getUserByIdWithoutCache(id: number): Promise<User | null>`

Same query as `getUserById` but bypasses the cache.

### 4.3 `upsertLuoguUser(data: Partial<User>, manager?): Promise<User>`

Behavior defined in Section 3.

### 4.4 `saveLuoguUserProfile(data: { uid; name; color; ccfLevel; xcpcLevel; slogan; introduction; prizes }): Promise<{ user: User; changed: boolean; recorded: boolean }>`

Profile-task write path. MUST:

1. Normalize and compare full-profile values within the transaction; `changed` reports a new user or changed public profile values, not timestamp changes.
2. Read missing users without a gap lock, attempt insertion first, then use the existing-row path after duplicate creation. Existing rows SHALL be locked before comparison, history-preference checks, and version allocation. Latest retained history SHALL use a current locking read so an initial consistent-read snapshot cannot hide a concurrent committed baseline.
3. Replace the incoming public profile fields and set `profile_fetched_at = now()` atomically with any snapshot insertion.
4. Append one immutable snapshot iff recording is enabled and the latest retained snapshot is absent or differs. Increment `profile_history_version` for each snapshot; return `recorded=true` iff one was appended.
5. Serialize concurrent per-UID saves with row locks, preserve counters across clear/resume, and roll profile/history changes back together on failure.
6. Retry database transaction conflicts through the existing retry helper, starting a new transaction on every attempt.
7. Evict `user:{id}` after the owning transaction commits with the existing non-throwing eviction helper; failed attempts SHALL NOT invalidate the cache.

### 4.5 `isProfileStale(user: User | null): boolean`

Returns `true` iff:

1. `user === null`, OR
2. `user.prizes === null`, OR
3. `user.profileFetchedAt === null`, OR
4. `Date.now() - user.profileFetchedAt.getTime() > PROFILE_TTL_MS`.

## 5. Save Profile Task

### 5.1 Task Type

| Handler Key    | Handler Class  | Description                                 |
| -------------- | -------------- | ------------------------------------------- |
| `save:profile` | ProfileHandler | Fetch and save full Luogu user profile data |

The handler is registered in `packages/backend/src/workers/index.ts` alongside `ArticleHandler` and `PasteHandler`.

### 5.2 Payload

```typescript
{
    target: 'profile',
    targetId: string,  // String form of Luogu UID; parsed to number internally
    metadata: {
        forceUpdate?: boolean  // Reserved; currently unused, profile fetch always overwrites
    }
}
```

`targetId` MUST be a non-empty string of decimal digits. The handler MUST reject any other input by throwing an `UnrecoverableError`.

### 5.3 Processing Flow

1. Parse `targetId` to `uid: number`. Reject values outside the unsigned integer range `1..4294967295` with `UnrecoverableError`.
2. Fetch `https://www.luogu.com/user/{uid}` via the shared `fetch` utility with `C3vkMode.MODERN`.
3. Validate that the response has shape `LentilleDataResponse<UserData>` and that its user UID matches the requested UID; reject with `UnrecoverableError` otherwise.
4. Extract:
    - `user: UserDetails` from `response.data.user`
    - `slogan: string | null` from `response.data.user.slogan`; treat empty strings and non-strings as `null`
    - `introduction: string | null` from `response.data.user.introduction`; treat empty strings and non-strings as `null`
    - `prizes: UserPrize[]` from `response.data.prizes`. Each element of `response.data.prizes` is a one-level wrapper `{ prize: LuoguPrize }`; the handler MUST unwrap the inner `prize` object before storing. Despite the name, `response.data.user.prize` is unrelated and may be empty; do NOT read from it. Default to `[]` if `response.data.prizes` is absent or non-array.
5. Build the incoming profile snapshot:
    ```typescript
    {
        id: user.uid,
        name: user.name,
        color: user.color,
        ccfLevel: user.ccfLevel ?? 0,
        xcpcLevel: user.xcpcLevel ?? 0,
        slogan,
        introduction,
        prizes
    }
    ```
6. Build the payload for `UserService.saveLuoguUserProfile` without an early current-profile equality skip. The service compares normalized values and retained history under the user row lock, so rollout baselines and concurrent clear/resume operations remain reachable.
    ```typescript
    {
        uid: user.uid,
        name: user.name,
        color: user.color,
        ccfLevel: user.ccfLevel ?? 0,
        xcpcLevel: user.xcpcLevel ?? 0,
        slogan,
        introduction,
        prizes
    }
    ```
7. Call `UserService.saveLuoguUserProfile`.
8. If neither `changed` nor `recorded` is true, do not emit an update and return `{ skipNextStep: true, data: { text: '' } }`.
9. Otherwise emit Socket.IO event `user:{uid}:profile-updated` to room `user_{uid}` with no required payload, including for an unchanged current profile that gains a baseline snapshot.
10. Return `{ skipNextStep: false, data: { text: introduction ?? '' } }`. The handler emits the raw Markdown introduction so that downstream LLM tasks (none exist today; profile refresh is single-step) can consume it via `job.getChildrenValues()`. This mirrors the contract of `save:article` and `save:paste` handlers. Empty string indicates no introduction is set.

### 5.4 Idempotency

Successive identical full-profile saves retain one matching snapshot while refreshing fetch metadata. A changed public profile replaces the current fields and, when enabled, records a new version only if it differs from the latest retained snapshot. Paused recording still updates the current profile. If recording is enabled with no retained baseline, an unchanged current profile records one.

The handler skips its downstream step and websocket event only when neither public profile values nor retained public history changed. Timestamp-only changes SHALL NOT emit an update event.

## 6. User Router

Routes are mounted under `/user` and registered in `packages/backend/src/routers/index.ts`.

### 6.1 `GET /user/query/:id`

Retrieve a stored user profile by Luogu UID.

**Request:**

- Path parameter: `id` (string of digits) - Luogu UID

**Response:**

- 200: Public profile projection including `prizes`, `profileFetchedAt`, derived boolean `profileStale`, and nullable `profileRefreshTaskId`
- 400: `id` is not a valid positive integer
- 404: User not in database (i.e., the saver has never observed this user via any content)
- 500: Server error

**Side Effects:**

- If the user exists in the database AND `isProfileStale(user)` returns `true`, the router MUST submit a `save:profile` task for this UID via `TaskService.createTask` + `dispatchTask`. The route handler SHALL wait only for submission, not task execution, and return its ID as `profileRefreshTaskId` after successful submission.
- `profileRefreshTaskId` SHALL be null when no refresh is needed or submission fails. Submission failure SHALL be logged without hiding the stored profile or turning the profile query into an error response. `profileStale` SHALL continue to describe stored-data freshness, not task execution.
- If user does NOT exist in the database, the router MUST NOT dispatch a profile task. (Rationale: a stranger UID could be invalid; we only refresh users the saver has already seen.)

**Response shape:**

```typescript
{
    id: number,
    name: string,
    color: UserColor,
    ccfLevel: number,
    xcpcLevel: number,
    slogan: string | null,
    introduction: string | null,  // Raw Markdown introduction
    prizes: UserPrize[] | null,
    profileFetchedAt: Date | null,
    profileStale: boolean,
    profileRefreshTaskId: string | null,
    createdAt: Date,
    updatedAt: Date
}
```

### 6.2 `POST /user/:id/refresh`

Explicitly trigger a `save:profile` task for the given UID.

**Request:**

- Path parameter: `id` (string of digits) - Luogu UID
- Body: ignored

**Response:**

- 200: `{ taskId: string }`
- 400: `id` is not a valid positive integer
- 500: Server error

**Side Effects:**

- Unconditionally dispatches a `save:profile` task (no staleness check, no requirement that the user already exists).

### 6.3 Public History and Owner Controls

- `GET /user/history/:id`: public metadata `{ versions: [{ version, observedAt, name }], latestVersion }`, descending by version, without a version cap. Known users without retained history return an empty list and null latestVersion; unknown users return 404.
- `GET /user/history/:id/:version`: public `{ version, observedAt, profile }` for that user's exact retained version; unknown UIDs/versions return 404, never the current profile as a fallback.
- `GET /user/history/:id/settings`: owner-only `{ recordingEnabled }`.
- `POST /user/history/:id/settings`: owner-only; requires a boolean `recordingEnabled` and returns the resulting state.
- `POST /user/history/:id/clear`: owner-only; atomically deletes retained snapshots and disables recording, returning `{ deleted, recordingEnabled: false }` after commit.

UIDs and versions SHALL be integers in `1..4294967295`; malformed inputs return 400. Dates SHALL be ISO-8601 UTC strings. Owner routes require LOGIN and strict equality between trusted `ctx.user.luoguUid` and the target UID; local account `ctx.user.id` SHALL NOT authorize another UID. Authentication/permission failures return 401/403; known-owner requests for an unknown public user return 404. Static settings routes SHALL be registered before the dynamic version route. History reads are local, uncached, and never dispatch a refresh task.

## 7. Invariants

1. The inline content path (`buildUser` → `upsertLuoguUser`) never writes `prizes` or `profile_fetched_at`.
2. The profile task path (`ProfileHandler` → `saveLuoguUserProfile`) atomically writes the normalized full profile and fetch timestamp together with any recorded snapshot.
3. `ccf_level` and `xcpc_level` are non-null integers with default `0`; missing upstream values map to `0`.
4. The user cache is evicted after successful full-profile/history-control transaction commits; rollback does not evict it.
5. A stale current profile remains readable when refresh submission fails. Its GET response waits only for task submission, never for the upstream fetch or task completion. Public historical reads never trigger refresh.
6. Snapshot recording is default-on and snapshots are publicly readable until cleared. Pause/clear controls remain owner-only.
7. Version counters are monotonic per UID and never reset by clearing; retained snapshot values remain immutable.

## 8. File Locations

- User entity: `packages/backend/src/entities/user.ts`
- User color enum: `packages/backend/src/shared/user.ts`
- `UserPrize` type: `packages/backend/src/shared/user.ts`
- `PROFILE_TTL_MS` constant: `packages/backend/src/shared/user.ts`
- `buildUser` helper: `packages/backend/src/utils/luogu-api.ts`
- `UserService`: `packages/backend/src/services/user.service.ts`
- Profile-history entity: `packages/backend/src/entities/user-profile-history.ts`
- Profile-history service: `packages/backend/src/services/user-profile-history.service.ts`
- Profile handler: `packages/backend/src/workers/handlers/task/save/profile.handler.ts`
- Handler registration: `packages/backend/src/workers/index.ts`
- User router: `packages/backend/src/routers/user.router.ts`
- Router registration: `packages/backend/src/routers/index.ts`
