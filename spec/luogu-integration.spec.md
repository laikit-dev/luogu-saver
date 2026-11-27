# Luogu Integration Specification

## 1. Overview

The Luogu integration handles HTTP communication with Luogu's API endpoints to fetch articles, pastes, and user information. It includes C3VK challenge handling and cookie management.

## 2. HTTP Client Configuration

### 2.1 Default Headers

All requests to Luogu include:

| Header               | Value                               |
| -------------------- | ----------------------------------- |
| `User-Agent`         | Chrome 98 on Windows 10 (see below) |
| `Accept`             | `application/json; charset=UTF-8`   |
| `x-luogu-type`       | `content-only`                      |
| `x-lentille-request` | `content-only`                      |

User-Agent string:

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36
```

### 2.2 Request Configuration

| Setting          | Value                  | Description                           |
| ---------------- | ---------------------- | ------------------------------------- |
| `maxRedirects`   | 0                      | Do not follow redirects automatically |
| `validateStatus` | () => true             | Accept all HTTP status codes          |
| `timeout`        | config.network.timeout | Request timeout in ms                 |

### 2.3 Tor Fallback Configuration

If `config.network.tor.enabled` is `false`, Tor fallback SHALL NOT run.

If `config.network.tor.enabled` is `true`, the fetch utility SHALL support Tor fallback using `config.network.tor.socksProxyUrl`.

Tor control authentication SHALL use `config.network.tor.controlPassword` as the original password used to generate Tor `HashedControlPassword`. The application SHALL NOT treat the `HashedControlPassword` hash value as an authentication credential.

The Redis key `luogu:tor:native429` SHALL indicate that native Luogu requests are temporarily disabled after a native HTTP 429 response. The key TTL SHALL equal `config.network.tor.native429FallbackTtlMs`.

The Redis key `luogu:tor:newnym:lock` SHALL be used as a global lock for Tor exit rotation. A process SHALL acquire it with NX and PX semantics before sending `SIGNAL NEWNYM`.

## 3. C3VK Challenge Handling

Luogu uses a challenge-response mechanism called C3VK to prevent automated access.

### 3.1 C3vkMode Enum

| Value    | Description                    |
| -------- | ------------------------------ |
| `LEGACY` | Old-style inline token         |
| `MODERN` | New-style redirect-based token |

### 3.2 Legacy C3VK Handling

**Trigger:** Response body contains pattern `C3VK=([a-zA-Z0-9]+);`

**Algorithm:**

1. Parse response body for C3VK token.
2. If found:
   a. Extract token value.
   b. Append `C3VK={token}` to Cookie header.
   c. Retry the request with updated cookies.
3. Return the final response.

### 3.3 Modern C3VK Handling

**Trigger:** Response status is 302 AND `location` header is present.

**Algorithm:**

1. Extract `Set-Cookie` headers from response.
2. Parse and merge cookies with existing cookie header.
3. Retry the original request with merged cookies.
4. Return the final response.

### 3.4 Cookie Merging

```
1. Parse existing Cookie header into key-value map.
2. For each Set-Cookie header:
   a. Extract cookie name and value (ignore attributes).
   b. Overwrite in map (new values replace old).
3. Serialize map back to Cookie header format.
```

## 4. Fetch Function

### 4.1 Signature

```typescript
export interface LuoguHttpErrorMeta {
    errorCode?: number;
    errorMessage?: string;
    errorType?: string;
}

export class LuoguHttpError extends UnrecoverableError {
    readonly status: number;
    readonly errorCode?: number;
    readonly errorMessage?: string;
    readonly errorType?: string;
}

async function fetch(url: string, mode: C3vkMode, cookie?: Record<string, string>): Promise<any>;
```

### 4.2 Flow

```
1. Build headers with defaults and optional cookies.
2. If Tor fallback is enabled and Redis key luogu:tor:native429 exists, make the request through Tor. Otherwise make a native request.
3. If the native request returns HTTP 429:
   a. Set Redis key luogu:tor:native429 with TTL config.network.tor.native429FallbackTtlMs.
   b. Make the request through Tor.
4. If the native request returns HTTP 403, do not use Tor and throw LuoguHttpError(403, "Access blocked with code 403", meta) after extracting any Lentille error metadata from resp.data.
5. If the native request fails with a retriable network error and Tor fallback is enabled, make the request through Tor.
6. If the first Tor request returns HTTP 429 or fails with a retriable network error:
   a. Acquire the global Redis lock luogu:tor:newnym:lock.
   b. If the lock is acquired, authenticate to the Tor control port, send SIGNAL NEWNYM, wait config.network.tor.newnymCooldownMs, and request config.network.tor.ipCheckUrl through Tor.
   c. If IP verification returns JSON with a non-empty ip field, write an info log entry with field ip and message Tor exit IP changed.
   d. If IP verification fails, write a warn log entry and continue.
   e. If the lock is not acquired, wait config.network.tor.newnymCooldownMs and do not call the Tor control port.
   f. Make one final request through Tor.
7. If mode === LEGACY:
   a. Check for inline C3VK token.
   b. Retry if found.
8. If mode === MODERN and status === 302:
   a. Merge Set-Cookie headers.
   b. Retry request.
9. Check status:
   a. On 401, 403, or 429 after the final attempt, attempt to parse resp.data (if string via JSON.parse, or if plain object as-is) to extract optional data.errorCode (number), data.errorMessage (string), and data.errorType (string). Non-JSON or malformed payloads yield empty metadata without failing extraction.
   b. 401: Log warning, throw LuoguHttpError(401, "Unauthorized fetch", meta)
   c. 403: Log warning, throw LuoguHttpError(403, "Access blocked with code 403", meta)
   d. 429 after final Tor attempt: Log warning, throw LuoguHttpError(429, "Access blocked with code 429", meta)
10. Parse response:
   a. If string, JSON.parse().
   b. Otherwise, return as-is.
11. Return parsed data.
```

### 4.3 Error Handling

| Error Code/Type | Behavior                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `ECONNABORTED`  | Throw retriable network error                                                                                |
| `ETIMEDOUT`     | Throw retriable network error                                                                                |
| `ECONNREFUSED`  | Throw retriable network error                                                                                |
| `ECONNRESET`    | Throw retriable network error                                                                                |
| timeout message | Throw retriable network error                                                                                |
| Other errors    | Throw `UnrecoverableError`                                                                                   |
| HTTP 401        | Throw `LuoguHttpError` (`instanceof UnrecoverableError`) with `status = 401` and parsed Lentille meta        |
| HTTP 403        | Throw `LuoguHttpError` (`instanceof UnrecoverableError`) with `status = 403` and parsed meta; do not use Tor |
| Native HTTP 429 | Set Tor-only Redis marker and try Tor                                                                        |
| Tor HTTP 429    | Rotate Tor exit IP once, then retry once; if still 429, throw `LuoguHttpError` with `status = 429`           |
| JSON parse fail | Throw `UnrecoverableError`                                                                                   |

Network errors are retriable by BullMQ; `UnrecoverableError` (including `LuoguHttpError`) stops retries.

## 5. Luogu API Endpoints

### 5.1 Article Fetch

**URL Pattern:** `{config.network.luoguPublicOrigin}/article/{articleId}`

**Response Structure (Success):**

```typescript
{
    data: {
        article: {
            lid: string;
            title: string;
            content: string;
            author: UserSummary;
            category: number;
            // ... other fields
        }
    }
}
```

**Response Structure (Lentille Error, e.g., missing `404` or non-public `401`):**

```typescript
{
    template: 'error';
    status: number;
    data: {
        errorCode: number;
        errorType?: string;
        errorMessage?: string;
    };
}
```

### 5.2 Paste Fetch

**URL Pattern:** `https://www.luogu.com.cn/paste/{pasteId}`

**Response Structure:**

```typescript
{
    currentData: {
        paste: {
            id: string;
            data: string;
            user: UserSummary;
            // ... other fields
        }
    }
}
```

### 5.3 UserSummary Type

```typescript
interface UserSummary {
    uid: number;
    name: string;
    color: string;
    ccfLevel: number; // OI / CCF certification level, 0 = none
    xcpcLevel: number; // ICPC / CCPC certification level, 0 = none
    badge?: string | null;
    // ... other fields present in upstream but unused by the saver
}
```

### 5.4 User Profile Fetch

**URL Pattern:** `{config.network.luoguPublicOrigin}/user/{uid}`

**Response Structure:** `LentilleDataResponse<UserData>` where the relevant subset is:

```typescript
{
    data: {
        prizes: {
            prize: {
                year: number;
                contest: string;
                event: string | null;
                prize: string;
                score?: number;
                rank?: number;
            };
        }[];
        user: {
            uid: number;
            name: string;
            color: UserColor;
            ccfLevel: number;
            xcpcLevel: number;
            badge?: string | null;
            slogan: string | null;        // short tagline, plain text
            introduction: string | null;  // long bio in raw Markdown
            // ... other UserDetails fields
        };
    };
}
```

Notes:

- The award list lives at `data.prizes` (top-level), not at `data.user.prize`. Each entry is a one-level wrapper `{ prize: LuoguPrize }`; consumers MUST unwrap the inner object before storing.
- `data.user.prize` exists in Luogu's response but is unrelated to the certified award list and is typically empty for verified users. Do NOT read from it.
- If `data.user.introduction` is a non-empty string, the saver MUST store that string unchanged in `User.introduction`. If the value is an empty string or is not a string, the saver MUST store `null`. The saver MUST NOT render or store derived HTML. The frontend Markdown Worker renders a non-null stored introduction when the profile is displayed.

The saver consumes only the fields above; all other fields are ignored.

## 6. User Building

### 6.1 buildUser(user: UserSummary): Partial<User>

Convert Luogu user summary to local User entity:

```typescript
{
    id: user.uid,
    name: user.name,
    color: user.color as UserColor,
    ccfLevel: user.ccfLevel ?? 0,
    xcpcLevel: user.xcpcLevel ?? 0,
    badge: user.badge
}
```

`buildUser` forwards `badge` to the inline upsert, which applies the normalization and omission rules in `user-system.spec.md` Section 3. `buildUser` MUST NOT include `prizes` or `profileFetchedAt`. Those fields are only written by `ProfileHandler` via `UserService.saveLuoguUserProfile`.

## 7. Task Handlers

### 7.1 ArticleHandler

**Task Type:** `save:article`

**Payload:**

```typescript
{
    target: "article",
    targetId: string,  // Article LID
    metadata: {}
}
```

**Processing:**

1. Fetch `{config.network.luoguPublicOrigin}/article/{articleId}` with `C3vkMode.MODERN`.
    - If `fetch` throws `LuoguHttpError`, fail the task permanently (`UnrecoverableError`) with `formatLuoguHttpError('文章', error)`.
2. Read article data from `response.data.article`.
3. If `response.data.article` is absent or null, fail the task permanently (`UnrecoverableError`) with `formatMissingLuoguResourceError('文章', response)`.
4. Do not read `response.data.article.author` before step 3 succeeds.
5. Build or update User entity for author.
6. Build Article entity with:
    - `id`, `title`, `content`, `category`, `tags`
    - `authorId` linked to user
    - Compute `contentHash` (SHA-256)
7. Check for existing article:
   a. If exists with same hash and title, skip.
   b. Otherwise, push new history version.
8. Save article to database.
9. Update task status to COMPLETED.

**Shared Error Mapping (`formatLuoguHttpError` & `formatMissingLuoguResourceError`):**

Let `resourceLabel` be `'文章'` for `ArticleHandler` and `'剪贴板'` for `PasteHandler`. Error messages SHALL NOT include upstream origin names, HTTP status codes, or raw upstream `errorMessage` strings.

- For `LuoguHttpError` (with `status`):
    - `status === 401`: `${resourceLabel}未公开或无权访问`.
    - `status === 403`: `访问被拒绝`.
    - `status === 429`: `请求过于频繁，请稍后重试`.
    - Other `status`: `获取${resourceLabel}失败`.
- For missing payload data in parsed response (`response`):
    - Let `code` be `response.data?.errorCode` if finite number, else `response.status` if finite number.
    - `code === 404`: `${resourceLabel}不存在`.
    - `code === 401`: `${resourceLabel}未公开或无权访问`.
    - `code === 403`: `访问被拒绝`.
    - `code === 429`: `请求过于频繁，请稍后重试`.
    - `typeof code === 'number' && code >= 400`: `获取${resourceLabel}失败`.
    - Otherwise: `${resourceLabel}不存在`.

### 7.2 PasteHandler

**Task Type:** `save:paste`

**Payload:**

```typescript
{
    target: "paste",
    targetId: string,  // Paste ID
    metadata: {}
}
```

**Processing:**

1. Fetch paste from Luogu API (`https://www.luogu.com/paste/${pasteId}`) with `C3vkMode.MODERN`.
    - If `fetch` throws `LuoguHttpError`, fail the task permanently (`UnrecoverableError`) with `formatLuoguHttpError('剪贴板', error)`.
2. Read paste data from `response.data.paste`.
3. If `response.data.paste` is absent or null, fail the task permanently (`UnrecoverableError`) with `formatMissingLuoguResourceError('剪贴板', response)`.
4. Do not read `response.data.paste.user` before step 3 succeeds.
5. Build or update User entity for author.
6. Build Paste entity with:
    - `id`, `content`
    - `authorId` linked to user
7. Save paste to database.
8. Update task status to COMPLETED.

### 7.3 ProfileHandler

**Task Type:** `save:profile`

**Payload:**

```typescript
{
    target: "profile",
    targetId: string,  // Luogu UID as decimal string
    metadata: {}
}
```

**Processing:** Defined in `user-system.spec.md` Section 5.3. Briefly:

1. Parse `targetId` to a positive integer; reject otherwise.
2. Fetch `{config.network.luoguPublicOrigin}/user/{uid}` with `C3vkMode.MODERN`.
3. Extract `user` from `response.data.user` and the award list from `response.data.prizes`, unwrapping the inner `prize` object of each entry.
4. Call `UserService.saveLuoguUserProfile` with the extracted data and `user.badge`. The same badge rules apply as on the inline path.
5. Emit Socket.IO event `user:{uid}:profile-updated` if the current profile or retained public history changed.

## 8. Invariants

1. All Luogu API requests include the standard headers.
2. C3VK challenges are handled transparently before returning data.
3. Network timeouts result in retriable errors.
4. HTTP 401 and parse errors are unrecoverable.
5. User entities are created/updated before content entities.
6. `buildUser` propagates `ccfLevel` and `xcpcLevel` from upstream; missing values map to `0`.
7. The inline `buildUser` path never overwrites `prizes` or `profile_fetched_at`.

## 9. File Locations

- Fetch utility: `packages/backend/src/utils/fetch.ts`
- Luogu API helpers: `packages/backend/src/utils/luogu-api.ts`
- C3VK mode enum: `packages/backend/src/shared/c3vk.ts`
- Article handler: `packages/backend/src/workers/handlers/task/save/article.handler.ts`
- Paste handler: `packages/backend/src/workers/handlers/task/save/paste.handler.ts`
- Profile handler: `packages/backend/src/workers/handlers/task/save/profile.handler.ts`
