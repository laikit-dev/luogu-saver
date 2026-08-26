# Authentication System Specification

## 1. Overview

The authentication system signs users in through CP OAuth only. It validates API requests using bearer tokens stored on `registered_user` rows. It provides middleware-based authentication for Koa applications.

The `user` table is not an authentication table. The `user` table stores Luogu users that appear as article or paste authors. CP OAuth login SHALL NOT insert, update, or delete rows in the `user` table.

## 2. Registered User Bearer Token

The `token` table SHALL NOT be used for authentication.

### 2.1 Bearer Token Validation

The method `RegisteredUserService.validateBearerToken(token: string)` SHALL:

1. Query the `registered_user` table for a record where `token` equals the provided bearer token.
2. If a record exists, return `[id, role]` where `id` is `registered_user.id`.
3. If no record exists, return an empty array.

## 3. Authorization Middleware

The `authorization` middleware is applied globally to all incoming requests.

### 3.1 Behavior

For each incoming request:

1. Check if the `Authorization` header is present.
2. If present:
    - Extract the token by removing the `Bearer ` prefix.
    - Call `RegisteredUserService.validateBearerToken(token)`.
    - If validation returns a non-empty array, attach `{ id: uid, role }` to `ctx.user`.
3. If the header is absent or validation fails, `ctx.user` remains `undefined`.
4. Always call `next()` to continue request processing.

### 3.2 Pseudocode

```
function authorization(ctx, next):
    if ctx.headers['authorization'] exists:
        token = ctx.headers['authorization'].replace('Bearer ', '')
        data = await RegisteredUserService.validateBearerToken(token)
        if data is not empty:
            ctx.user = { id: data[0], role: data[1] }
    await next()
```

## 4. Article Display User Entity

The `user` table is used for Luogu display/profile data only. Its schema, cache behavior, and Luogu upsert semantics are owned by `user-system.spec.md`.

Authentication code SHALL NOT insert, update, or delete rows in the `user` table.

## 5. Registered User Entity

Table name: `registered_user`

This table stores users that can log in to Luogu Saver.

| Column         | Type         | Constraints      | Description                |
| -------------- | ------------ | ---------------- | -------------------------- |
| `id`           | INT UNSIGNED | PRIMARY KEY      | Local registered user ID   |
| `cp_oauth_sub` | VARCHAR(128) | UNIQUE, NOT NULL | CP OAuth subject claim     |
| `luogu_uid`    | INT UNSIGNED | UNIQUE, NOT NULL | Linked Luogu user ID       |
| `name`         | VARCHAR      | NOT NULL         | Display name from CP OAuth |
| `avatar_url`   | VARCHAR      | NULL             | Avatar URL from CP OAuth   |
| `token`        | VARCHAR(32)  | UNIQUE, NULL     | Bearer token for API auth  |
| `role`         | INT          | NOT NULL         | Permission bitmask         |
| `created_at`   | DATETIME     | NOT NULL         | Record creation timestamp  |
| `updated_at`   | DATETIME     | NOT NULL         | Record update timestamp    |

### 5.1 CP OAuth Registered User Upsert

The `RegisteredUserService.upsertCpOAuthUser(data)` method SHALL:

1. Require `data.cpOAuthSub` to be a non-empty string.
2. Require `data.luoguUid` to be a positive integer.
3. If a row exists where `luogu_uid=data.luoguUid` and `cp_oauth_sub != data.cpOAuthSub`, reject the operation and do not modify that row.
4. If a concurrent insert creates a row where `luogu_uid=data.luoguUid` and `cp_oauth_sub != data.cpOAuthSub`, reject the operation.
5. Store `data.luoguUid` in `registered_user.luogu_uid`.
6. Store `data.name` as the display name. If `data.name` is empty, store `User {luoguUid}`.
7. Store `data.avatarUrl` when it is present. Store `NULL` when it is absent.
8. Insert a registered user row when no row exists for `data.cpOAuthSub`.
9. For inserted rows, generate `token` as a 32-character hex string and set `role=ROLE_DEFAULT`.
10. Update the existing registered user row when a row exists for `data.cpOAuthSub`.
11. For existing rows, preserve `role`; if `token` is `NULL`, generate a 32-character hex token.
12. Return the row after the insert or update.
13. Not read or write the `user` table.

## 6. CP OAuth Login

### 6.1 Configuration

The `auth.cpOAuth` configuration object SHALL contain:

| Field                 | Type     | Default                                                    | Description                                                                                       |
| --------------------- | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `discoveryUrl`        | string   | `https://www.cpoauth.com/.well-known/openid-configuration` | OpenID Connect discovery document URL                                                             |
| `clientId`            | string   | empty string                                               | CP OAuth client ID                                                                                |
| `clientSecret`        | string   | empty string                                               | CP OAuth client secret for confidential clients                                                   |
| `redirectUri`         | string   | empty string                                               | Backend callback URL registered at CP OAuth                                                       |
| `frontendRedirectUri` | string   | `/auth/callback`                                           | Frontend URL receiving the issued local token. It may be an absolute URL or a root-relative path. |
| `scopes`              | string[] | `['openid', 'profile', 'link:luogu']`                      | Scopes requested from CP OAuth                                                                    |
| `stateExpireSeconds`  | number   | 600                                                        | Redis TTL for OAuth state and PKCE verifier                                                       |

For the checked-in local `config.yml`, `redirectUri` SHALL be `http://127.0.0.1:30010/auth/cp/callback`, which is the configured backend listener, and `frontendRedirectUri` SHALL be `http://localhost:5173/auth/callback`, which is the Vite development-server route. The CP OAuth client registration SHALL contain the same backend `redirectUri` value.

### 6.2 GET /auth/cp/login

Start the CP OAuth authorization code flow.

**Request:**

- Query parameter: `redirect` (string, optional) - Frontend path used after login. If absent, use `/`.

**Behavior:**

1. If `auth.cpOAuth.clientId` is empty, return 500.
2. If `auth.cpOAuth.redirectUri` is empty, return 500.
3. Fetch the CP OAuth discovery document from `discoveryUrl`.
4. Generate `state` as at least 128 bits of random data encoded as hex.
5. Generate a PKCE `code_verifier` as at least 256 bits of random data encoded as base64url.
6. Compute `code_challenge = BASE64URL(SHA256(code_verifier))`.
7. Store JSON `{ codeVerifier, redirect }` in Redis key `auth:cp:state:{state}` with TTL `stateExpireSeconds`.
8. Redirect to the discovered `authorization_endpoint` with these query parameters:
    - `response_type=code`
    - `client_id=auth.cpOAuth.clientId`
    - `redirect_uri=auth.cpOAuth.redirectUri`
    - `scope=auth.cpOAuth.scopes` joined by a single space
    - `state=state`
    - `code_challenge=code_challenge`
    - `code_challenge_method=S256`

### 6.3 GET /auth/cp/callback

Complete the CP OAuth authorization code flow.

**Request:**

- Query parameter: `code` (string, required)
- Query parameter: `state` (string, required)
- Query parameter: `error` (string, optional)

**Behavior:**

1. If `frontendRedirectUri` is an absolute URL, preserve its origin, path, and existing query parameters when appending callback query parameters.
2. If `frontendRedirectUri` is a root-relative path, redirect to that path with appended callback query parameters.
3. If `error` is present, redirect to `frontendRedirectUri` with query parameters `error` and `message`.
4. If `code` or `state` is absent, redirect to `frontendRedirectUri` with `error=invalid_request`.
5. Atomically read and delete Redis key `auth:cp:state:{state}` in one Redis command.
6. If no state data exists, redirect to `frontendRedirectUri` with `error=invalid_state`.
7. The callback SHALL NOT exchange the authorization code unless the atomic read-and-delete operation returned state data.
8. Exchange `code` at the discovered `token_endpoint` using JSON request body:
    - `grant_type=authorization_code`
    - `code=code`
    - `redirect_uri=auth.cpOAuth.redirectUri`
    - `client_id=auth.cpOAuth.clientId`
    - `code_verifier=stored codeVerifier`
    - `client_secret=auth.cpOAuth.clientSecret` only when non-empty
9. Require a string `access_token` in the token response.
10. Fetch the discovered `userinfo_endpoint` with header `Authorization: Bearer {access_token}`.
11. Require a non-empty string `sub` in the userinfo response.
12. Require `linked_accounts` to contain an object with `platform='luogu'` and numeric `platformUid`.
13. Upsert a registered user using:
    - `cpOAuthSub = sub`
    - `luoguUid = Number(platformUid)`
    - `name = platformUsername` when present, otherwise `display_name`, otherwise `username`, otherwise `User {luoguUid}`
    - `avatarUrl = avatar_url` when present
14. The callback SHALL NOT write to the `user` table.
15. Require `registered_user.token` to be non-empty after the upsert.
16. The callback SHALL NOT read or write the `token` table.
17. Redirect to `frontendRedirectUri` with query parameters:
    - `token=registered_user.token`
    - `uid=registered user ID`
    - `role=local role`
    - `redirect=stored redirect`

### 6.4 GET /auth/me

Return the authenticated local user.

**Response:**

- 200: `{ uid, role, registeredUser }` when `ctx.user` exists.
- 401: `Unauthorized` when `ctx.user` does not exist.

## 7. Authorization States

| `ctx.user`   | Interpretation                      |
| ------------ | ----------------------------------- |
| `undefined`  | Unauthenticated request             |
| `{id, role}` | Authenticated user with ID and role |

## 8. Permissions

The permission bitmask SHALL define:

| Name                   | Value    | Meaning                                                            |
| ---------------------- | -------- | ------------------------------------------------------------------ |
| `LOGIN`                | `1 << 0` | User may authenticate                                              |
| `CREATE_WORKFLOW`      | `1 << 1` | User may create non-public workflows                               |
| `CREATE_TASK`          | `1 << 2` | User may call legacy `/task/create`                                |
| `MANAGE_SEARCH`        | `1 << 3` | User may manage search indexing                                    |
| `MANAGE_USERS`         | `1 << 4` | User may inspect and modify user roles                             |
| `MANAGE_ANNOUNCEMENTS` | `1 << 5` | User may manage site announcements                                 |
| `MANAGE_DISCOVERY`     | `1 << 6` | User may manage article discovery                                  |
| `MANAGE_CONTENT`       | `1 << 7` | User may review deletion requests and restore soft-deleted content |

`ROLE_ADMIN = -1` SHALL satisfy all permission checks.

If `registered_user.role = ROLE_ADMIN`, authorization middleware SHALL NOT reject the request as banned.

`ROLE_DEFAULT` SHALL equal `LOGIN | CREATE_WORKFLOW`.

CP OAuth-created registered users SHALL use `ROLE_DEFAULT`.

The legacy endpoint `POST /task/create` SHALL require `CREATE_TASK`.

The legacy endpoint `POST /token/create` SHALL return 410 and SHALL NOT create a token row.

The legacy endpoint `GET /token/inspect` SHALL return the current `registered_user.id`, `registered_user.role`, and `registered_user.created_at`.

The legacy endpoint `POST /token/verify` SHALL accept body `{ uid }`. If `uid` is absent, it SHALL return 400. Otherwise it SHALL call `VerificationService.prepareForLuogu(uid)` and return `{ code, expireAt }`.

The legacy endpoint `POST /token/permission` SHALL require `ctx.user.role === ROLE_ADMIN`. If that condition is false, it SHALL return 403. It SHALL reject missing `uid` or missing `role` with 400, reject self-role mutation with 400, reject a missing target registered user with 404, update the target role through `RegisteredUserService.updateRole`, and return `{ uid, role }`.

The backend admin user endpoints SHALL require `MANAGE_USERS`.

The backend search reindex endpoint SHALL require `MANAGE_SEARCH`.

The backend announcement admin endpoints SHALL require `MANAGE_ANNOUNCEMENTS`.

The backend article and paste restoration endpoints SHALL require `MANAGE_CONTENT`.

## 9. Socket.IO Authentication

Socket.IO connections MAY be anonymous.

When a client connects with `handshake.auth.token`:

1. The backend SHALL validate the token using `RegisteredUserService.validateBearerToken`.
2. If validation succeeds, the socket SHALL store `{ id, role }` as the authenticated socket user.
3. If validation fails, the backend SHALL reject the Socket.IO connection.

When a client connects without `handshake.auth.token`, the backend SHALL allow the connection and
the socket user SHALL be absent.

Socket room joins SHALL be authorized before the socket is added to the room.

Room `discovery:runs` SHALL require `MANAGE_DISCOVERY`. A socket without an authenticated user or
without `MANAGE_DISCOVERY` SHALL NOT join this room.

`ROLE_ADMIN = -1` SHALL satisfy all Socket.IO room permission checks.

Public rooms, including article, paste, user profile, task, and queue statistics rooms, SHALL remain
joinable without Socket.IO authentication unless a later specification defines a room-specific
permission.

## 10. Security Constraints

1. Bearer tokens are stored as plaintext in `registered_user.token`.
2. Token validation is performed on every request with an Authorization header.
3. The middleware does NOT reject unauthenticated requests; downstream handlers must check `ctx.user` if authentication is required.
4. CP OAuth state values are single-use because the callback atomically reads and deletes the Redis state key before token exchange.
5. CP OAuth login SHALL NOT accept a CP OAuth user without a linked Luogu account.
6. CP OAuth login SHALL NOT mutate the article display `user` table.

## 11. File Locations

- User entity: `packages/backend/src/entities/user.ts`
- Registered user entity: `packages/backend/src/entities/registered-user.ts`
- Authorization middleware: `packages/backend/src/middlewares/authorization.ts`
- User color enum: `packages/backend/src/shared/user.ts`
- Registered user service: `packages/backend/src/services/registered-user.service.ts`
- CP OAuth service: `packages/backend/src/services/auth.service.ts`
- Auth router: `packages/backend/src/routers/auth.router.ts`
