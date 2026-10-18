# Authentication System Specification

## 1. Overview

The authentication system signs users in through CP OAuth only. It validates API requests using bearer tokens stored on `registered_user` rows. It provides middleware-based authentication for Koa applications.

The `user` table is not an authentication table. The `user` table stores Luogu users that appear as article or paste authors. CP OAuth login SHALL NOT insert, update, or delete rows in the `user` table.

## 2. Registered User Bearer Token

The `token` table SHALL NOT be used for authentication.

### 2.1 Bearer Token Validation

The method `RegisteredUserService.validateBearerToken(token: string)` SHALL:

1. Query the `registered_user` table for a record where `token` equals the provided bearer token.
2. If a record exists, return `{ id, role, luoguUid }` from that same row, where `id` is `registered_user.id` and `luoguUid` is `registered_user.luogu_uid`.
3. If no record exists, return `null`.

## 3. Authorization Middleware

The `authorization` middleware is applied globally to all incoming requests.

### 3.1 Behavior

For each incoming request:

1. Check if the `Authorization` header is present.
2. If present:
    - Extract the token by removing the `Bearer ` prefix.
    - Call `RegisteredUserService.validateBearerToken(token)`.
    - If validation returns a principal, attach `{ id, role, luoguUid }` to `ctx.user`. The linked UID SHALL come from the validated database row, never from request parameters, headers, or body fields.
3. If the header is absent or validation fails, `ctx.user` remains `undefined`.
4. Always call `next()` to continue request processing.

### 3.2 Pseudocode

```
function authorization(ctx, next):
    if ctx.headers['authorization'] exists:
        token = ctx.headers['authorization'].replace('Bearer ', '')
        data = await RegisteredUserService.validateBearerToken(token)
        if data is not null:
            ctx.user = data
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

| Field                    | Type     | Default                                                    | Description                                                                                                     |
| ------------------------ | -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `discoveryUrl`           | string   | `https://www.cpoauth.com/.well-known/openid-configuration` | OpenID Connect discovery document URL                                                                           |
| `clientId`               | string   | empty string                                               | CP OAuth client ID                                                                                              |
| `clientSecret`           | string   | empty string                                               | CP OAuth client secret for confidential clients                                                                 |
| `redirectUri`            | string   | empty string                                               | Backend callback URL registered at CP OAuth                                                                     |
| `frontendRedirectUri`    | string   | `/auth/callback`                                           | Frontend callback path, query, and fragment template. Its origin, when absolute HTTP(S), is implicitly allowed. |
| `allowedFrontendOrigins` | string[] | `[]`                                                       | Additional allowed frontend origins, matched exactly by scheme, hostname, and port.                             |
| `scopes`                 | string[] | `['openid', 'profile', 'link:luogu']`                      | Scopes requested from CP OAuth                                                                                  |
| `stateExpireSeconds`     | number   | 600                                                        | Redis TTL for OAuth state and PKCE verifier                                                                     |

Each `allowedFrontendOrigins` entry SHALL be a canonical HTTP(S) origin equal to `new URL(entry).origin`. Entries SHALL NOT contain credentials, paths, query parameters, fragments, or wildcards. Invalid entries SHALL reject configuration loading. HTTP origins MAY be configured for local development; production deployments SHOULD use HTTPS.

`frontendRedirectUri` SHALL remain the callback path template, not a fixed destination origin. An absolute HTTP(S) template implicitly allows its own origin. A root-relative template requires every frontend origin to be listed in `allowedFrontendOrigins`.

For the checked-in local `config.yml`, `redirectUri` SHALL be `http://127.0.0.1:30010/auth/cp/callback`, which is the configured backend listener, and `frontendRedirectUri` SHALL be `http://localhost:5173/auth/callback`, which is the Vite development-server route. The CP OAuth client registration SHALL contain the same backend `redirectUri` value.

### 6.2 GET /auth/cp/login

Start the CP OAuth authorization code flow.

**Request:**

- Query parameter: `redirect` (string, optional) - Frontend path used after login. If absent, use `/`.
- Query parameter: `frontendOrigin` (string, required) - The frontend's `window.location.origin`.

**Behavior:**

1. Require `frontendOrigin` to be a single string equal to an entry in `allowedFrontendOrigins` or the origin of an absolute HTTP(S) `frontendRedirectUri`. Otherwise return application error code 400 without creating state or contacting CP OAuth.
2. Do not infer the frontend origin from `Origin`, `Referer`, `Host`, or forwarded headers.
3. If `auth.cpOAuth.clientId` or `auth.cpOAuth.redirectUri` is empty, return application error code 500.
4. Fetch the CP OAuth discovery document from `discoveryUrl`.
5. Generate `state` as at least 128 bits of random data encoded as hex.
6. Generate a PKCE `code_verifier` as at least 256 bits of random data encoded as base64url.
7. Compute `code_challenge = BASE64URL(SHA256(code_verifier))`.
8. Normalize `redirect` to `/` unless it is a string starting with `/` but not `//`.
9. Store JSON `{ codeVerifier, redirect, frontendOrigin }` in Redis key `auth:cp:state:{state}` with TTL `stateExpireSeconds`.
10. Redirect to the discovered `authorization_endpoint` with these query parameters:
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

- Query parameter: `state` (string, required, including authorization-error callbacks)
- Query parameter: `code` (string, required unless `error` is present)
- Query parameter: `error` (string, optional)
- Query parameter: `error_description` (string, optional)

**Behavior:**

1. If `state` is absent, empty, or not a single string, return application error code 400 without redirecting or exchanging a code.
2. Atomically read and delete Redis key `auth:cp:state:{state}` in one Redis command, before handling success, provider errors, or missing codes.
3. If no state data exists, or its `frontendOrigin` is not currently allowed by section 6.2, return application error code 400 without redirecting or exchanging a code. A state without `frontendOrigin`, including one issued before this change, SHALL be rejected.
4. If consuming state fails, return application error code 500 without redirecting or exchanging a code.
5. Construct the frontend callback URL from the stored `frontendOrigin` and the path, query, and fragment of `frontendRedirectUri`. The resulting URL SHALL retain the stored origin even when the configured pathname begins with `//`.
6. Ignore callback query parameters that attempt to override the frontend origin or return path.
7. If a non-empty string `error` is present, redirect to the constructed callback URL with `error` and `message`. Use a non-empty string `error_description` as the message when provided; otherwise use `error`.
8. If `error` is present but not a non-empty string, or if no error is present and `code` is absent, empty, or not a single string, redirect to the constructed callback URL with `error=invalid_request`.
9. The callback SHALL NOT exchange an authorization code unless state was consumed successfully and steps 7 and 8 did not terminate the request.
10. Exchange `code` at the discovered `token_endpoint` using JSON request body:
    - `grant_type=authorization_code`
    - `code=code`
    - `redirect_uri=auth.cpOAuth.redirectUri`
    - `client_id=auth.cpOAuth.clientId`
    - `code_verifier=stored codeVerifier`
    - `client_secret=auth.cpOAuth.clientSecret` only when non-empty
11. Require a string `access_token` in the token response.
12. Fetch the discovered `userinfo_endpoint` with header `Authorization: Bearer {access_token}`.
13. Require a non-empty string `sub` in the userinfo response.
14. Require `linked_accounts` to contain an object with `platform='luogu'` and numeric `platformUid`.
15. Upsert a registered user using:
    - `cpOAuthSub = sub`
    - `luoguUid = Number(platformUid)`
    - `name = platformUsername` when present, otherwise `display_name`, otherwise `username`, otherwise `User {luoguUid}`
    - `avatarUrl = avatar_url` when present
16. The callback SHALL NOT write to the `user` table or read or write the `token` table.
17. Require `registered_user.token` to be non-empty after the upsert.
18. On success, redirect to the constructed callback URL with query parameters:
    - `token=registered_user.token`
    - `uid=registered user ID`
    - `role=local role`
    - `redirect=stored redirect`
19. If code exchange, userinfo retrieval, or local login fails, redirect to the same constructed callback URL with `error=login_failed` and the failure message.
20. State remains consumed after success, cancellation, malformed callbacks with valid state, or login failure. A repeated callback SHALL NOT exchange the code again or emit a token.

Application error responses in this section SHALL use the existing response envelope: HTTP 200 with `{ code: 400 | 500, message, data: null }`. These responses SHALL NOT contain a `Location` header or a local token.

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
