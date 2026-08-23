# User System Specification

## 1. Overview

The user system stores Luogu user records mirrored from the upstream platform. Beyond identity (`id`, `name`) and the dynamic color level (`color`), it records the user's award certification levels (OI / XCPC), the full award history when available, and metadata used to manage the freshness of the cached profile.

The system exposes:

1. Inline read paths used by content handlers (article, paste): `id`, `name`, `color`, `ccfLevel`, `xcpcLevel`.
2. A profile read path used by the user homepage: all of the above plus `prizes` and `profileFetchedAt`.
3. A `save:profile` task that fetches the full Luogu user page and refreshes the profile-only fields.

## 2. User Entity

### 2.1 Schema

Table name: `user`

| Column               | Type         | Constraints           | Description                                         |
| -------------------- | ------------ | --------------------- | --------------------------------------------------- |
| `id`                 | INT UNSIGNED | PRIMARY KEY           | Luogu user ID                                       |
| `name`               | VARCHAR      | NOT NULL              | Luogu user name                                     |
| `color`              | VARCHAR      | NOT NULL              | Dynamic level color (UserColor enum)                |
| `ccf_level`          | INT          | NOT NULL, DEFAULT `0` | OI / CCF certification level (`0` = none)           |
| `xcpc_level`         | INT          | NOT NULL, DEFAULT `0` | ICPC / CCPC certification level (`0` = none)        |
| `slogan`             | TEXT         | NULLABLE              | Short profile tagline as raw text                   |
| `introduction`       | MEDIUMTEXT   | NULLABLE              | Long profile introduction as raw Markdown           |
| `prizes`             | JSON         | NULLABLE              | Array of `UserPrize` records; `NULL` if not fetched |
| `profile_fetched_at` | DATETIME     | NULLABLE              | Timestamp of the last successful profile fetch      |
| `created_at`         | DATETIME     | NOT NULL              | Record creation timestamp                           |
| `updated_at`         | DATETIME     | NOT NULL              | Record update timestamp                             |

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
4. Does NOT mutate `slogan`, `introduction`, `prizes`, or `profile_fetched_at` even if `data` happens to contain them.

This invariant guarantees that the cheap inline path never clobbers richer data fetched by the profile task.

## 4. UserService API

All methods accept an optional `EntityManager` argument. If absent, the default repository manager is used.

### 4.1 `getUserById(id: number, manager?): Promise<User | null>`

1. Cached under `user:{id}` for 600 seconds.
2. Returns the full `User` row including `prizes` and `profileFetchedAt`.

### 4.2 `getUserByIdWithoutCache(id: number): Promise<User | null>`

Same query as `getUserById` but bypasses the cache.

### 4.3 `upsertLuoguUser(data: Partial<User>, manager?): Promise<User>`

Behavior defined in Section 3.

### 4.4 `saveLuoguUserProfile(data: { uid; name; color; ccfLevel; xcpcLevel; slogan; introduction; prizes }, manager?): Promise<User>`

Profile-task write path. MUST:

1. Upsert the user row using the primary key.
2. Set `ccf_level`, `xcpc_level`, `slogan`, `introduction`, `prizes`, AND
   `profile_fetched_at = now()` atomically.
3. Update `name` and `color` to the incoming values (the profile fetch is authoritative for the moment).
4. Evict cache key `user:{id}`.

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

1. Parse `targetId` to `uid: number`. Reject NaN, negative, or zero with `UnrecoverableError`.
2. Fetch `https://www.luogu.com/user/{uid}` via the shared `fetch` utility with `C3vkMode.MODERN`.
3. Validate that the response has shape `LentilleDataResponse<UserData>`; reject with `UnrecoverableError` otherwise.
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
6. Load the existing user row for `uid` without using the cache.
7. Compare the incoming profile snapshot with the existing user row snapshot using exactly the fields listed in step 5. The comparison MUST NOT include `profileFetchedAt`, `createdAt`, or `updatedAt`.
8. If an existing row exists and all compared fields are identical:
    - Do not call `UserService.saveLuoguUserProfile`.
    - Do not emit `user:{uid}:profile-updated`.
    - Return `{ skipNextStep: true, data: { text: '' } }`.
9. If no existing row exists, or if any compared field differs, build the payload for `UserService.saveLuoguUserProfile`:
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
10. Call `UserService.saveLuoguUserProfile`.
11. Emit Socket.IO event `user:{uid}:profile-updated` to room `user_{uid}` with no required payload.
12. Return `{ skipNextStep: false, data: { text: introduction ?? '' } }`. The handler emits the raw Markdown introduction so that downstream LLM tasks (none exist today; profile refresh is single-step) can consume it via `job.getChildrenValues()`. This mirrors the contract of `save:article` and `save:paste` handlers. Empty string indicates no introduction is set.

### 5.4 Idempotency

Successive `save:profile` invocations for the same `uid` are idempotent. If any compared profile field differs, the row is upserted, `profile_fetched_at` is bumped, and the compared profile fields are replaced wholesale. No history is preserved.

If the compared profile fields are identical before and after a successful `save:profile` fetch, the handler skips the database write and websocket update event. Updating `profile_fetched_at`, `created_at`, or `updated_at` alone MUST NOT require a write or emit an update event.

## 6. User Router

Routes are mounted under `/user` and registered in `packages/backend/src/routers/index.ts`.

### 6.1 `GET /user/query/:id`

Retrieve a stored user profile by Luogu UID.

**Request:**

- Path parameter: `id` (string of digits) - Luogu UID

**Response:**

- 200: `User` object (full row including `prizes`, `profileFetchedAt`, plus a derived boolean `profileStale`)
- 400: `id` is not a valid positive integer
- 404: User not in database (i.e., the saver has never observed this user via any content)
- 500: Server error

**Side Effects:**

- If the user exists in the database AND `isProfileStale(user)` returns `true`, the router MUST dispatch a `save:profile` task for this UID. The task is created via `TaskService.createTask` + `dispatchTask` and is fire-and-forget; the route handler does NOT wait for it to complete.
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

## 7. Invariants

1. The inline content path (`buildUser` → `upsertLuoguUser`) never writes `prizes` or `profile_fetched_at`.
2. The profile task path (`ProfileHandler` → `saveLuoguUserProfile`) always writes `prizes` and bumps `profile_fetched_at`.
3. `ccf_level` and `xcpc_level` are non-null integers with default `0`; missing upstream values map to `0`.
4. The cache key `user:{id}` is evicted by every write path that touches the row.
5. A stale profile is served immediately; refresh happens asynchronously and does not block the GET response.

## 8. File Locations

- User entity: `packages/backend/src/entities/user.ts`
- User color enum: `packages/backend/src/shared/user.ts`
- `UserPrize` type: `packages/backend/src/shared/user.ts`
- `PROFILE_TTL_MS` constant: `packages/backend/src/shared/user.ts`
- `buildUser` helper: `packages/backend/src/utils/luogu-api.ts`
- `UserService`: `packages/backend/src/services/user.service.ts`
- Profile handler: `packages/backend/src/workers/handlers/task/save/profile.handler.ts`
- Handler registration: `packages/backend/src/workers/index.ts`
- User router: `packages/backend/src/routers/user.router.ts`
- Router registration: `packages/backend/src/routers/index.ts`
