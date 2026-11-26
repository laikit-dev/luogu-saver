# Deletion Request System Specification

## 1. Scope

This specification defines the backend deletion request subsystem implemented under `packages/backend`.

A deletion request is a moderation ticket filed by an authenticated registered user asking that one archived article or paste be soft-deleted. If the requester's `registered_user.luogu_uid` equals the target row's `author_id`, the system approves the request automatically. Otherwise, an administrator with `MANAGE_CONTENT` reviews the request and either approves it (the target content is soft-deleted) or rejects it. Both automatic and administrator review outcomes create one user notification for the requester as defined by `user-notification-system.spec.md`.

The deletion request system SHALL NOT physically delete `article` or `paste` rows.

## 2. Deletion Request Entity

Table name: `deletion_request`

| Column               | Type         | Constraints                 | Description                                                        |
| -------------------- | ------------ | --------------------------- | ------------------------------------------------------------------ |
| `id`                 | INT UNSIGNED | PRIMARY KEY, AUTO INCREMENT | Deletion request identifier                                        |
| `target_type`        | VARCHAR(16)  | NOT NULL                    | `article` or `paste`                                               |
| `target_id`          | VARCHAR(8)   | NOT NULL                    | `article.id` or `paste.id`                                         |
| `requester_id`       | INT UNSIGNED | NOT NULL                    | `registered_user.id` of the requester                              |
| `reason`             | VARCHAR(500) | NOT NULL                    | Requester-provided reason                                          |
| `status`             | VARCHAR(16)  | NOT NULL, DEFAULT `pending` | `pending`, `approved`, or `rejected`                               |
| `resolution_comment` | VARCHAR(500) | NULLABLE                    | Handler-provided comment                                           |
| `handler_id`         | INT UNSIGNED | NULLABLE                    | `registered_user.id` of the handling admin                         |
| `handler_kind`       | VARCHAR(16)  | NULLABLE                    | `user` for administrator review or `system` for automatic approval |
| `handled_at`         | DATETIME     | NULLABLE                    | Time the request left the `pending` status                         |
| `created_at`         | DATETIME     | NOT NULL                    | Record creation timestamp                                          |
| `updated_at`         | DATETIME     | NOT NULL                    | Record update timestamp                                            |

### 2.1 Indexes

- `idx_deletion_request_status_created_at`: (`status`, `created_at`)
- `idx_deletion_request_target`: (`target_type`, `target_id`)
- `idx_deletion_request_requester_created_at`: (`requester_id`, `created_at`)

### 2.2 State Machine

`status` transitions SHALL be exactly:

1. Row creation sets `status='pending'`, `resolution_comment=NULL`, `handler_id=NULL`, `handler_kind=NULL`, `handled_at=NULL`.
2. `pending -> approved` through `approveRequest` or the automatic author-approval path in `createRequest`.
3. `pending -> rejected` through `rejectRequest`.
4. `approved` and `rejected` are terminal. No endpoint SHALL modify a non-pending request.

## 3. Service Layer

All methods are static members of `DeletionRequestService`.

Validation failures SHALL be thrown as `Error` objects with a numeric `status` property so the response helper middleware maps them to `{ code, message, data: null }`.

### 3.1 `createRequest(requesterId, input)`

Input shape:

```json
{
    "targetType": "article",
    "targetId": "abc12345",
    "reason": "内容包含我的个人信息"
}
```

Preconditions:

1. `requesterId` SHALL be an authenticated registered user ID.
2. If `input.targetType` is not `article` and not `paste`, throw status `400` with message `Invalid target type`.
3. `targetId` SHALL be normalized as `String(input.targetId ?? '').trim()`. If the normalized value is empty or longer than 8 characters, throw status `400` with message `Valid targetId is required`.
4. `reason` SHALL be normalized as `String(input.reason ?? '').trim()`. If the normalized value is empty, throw status `400` with message `Reason is required`. If it is longer than 500 characters, throw status `400` with message `Reason is too long (max 500 chars)`.
5. Load the target row (`article` or `paste` by primary key, direct database read). If no row exists, throw status `404` with message `Target content not found`.
6. If the target row has `deleted=true`, throw status `400` with message `Target content already deleted`.
7. If a `deletion_request` row exists with the same `target_type`, `target_id`, `requester_id`, and `status='pending'`, throw status `409` with message `A pending deletion request already exists`.
8. Load the `registered_user` row whose primary key is `requesterId`. The requester is the target author iff that row exists and `registered_user.luogu_uid === target.author_id`.

Postconditions:

1. Insert one `deletion_request` row with `status='pending'` and the normalized fields.
2. If the requester is not the target author, return the pending item in the shape of section 3.2.
3. If the requester is the target author, immediately run the same target soft-deletion and article deletion-marker synchronization as section 3.4, then finalize the request with `status='approved'`, `handler_id=NULL`, `handler_kind='system'`, and `resolution_comment='自动通过'`.
4. Automatic finalization SHALL create the approval notification from section 5 in the same transaction that updates the request row.
5. Return the finalized item in the shape of section 3.2 after successful automatic approval.

If automatic article deletion-marker synchronization fails, `createRequest` SHALL propagate the error and SHALL leave the inserted request pending. The article row MAY already have `deleted=true`. An administrator MAY retry the pending request through `approveRequest`.

### 3.2 `listMyRequests(requesterId, page, pageSize)`

Pagination normalization (shared by all list methods in this spec):

1. `page` SHALL be `clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER)`: non-numeric values become `1`, fractional values are floored, and values below `1` become `1`.
2. `pageSize` SHALL be `clampInt(pageSize, 20, 1, 100)`: non-numeric values become `20`, fractional values are floored, and values are clamped into `[1, 100]`.

Postconditions:

1. Return `{ requests, total, page, pageSize }`.
2. `requests` contains only rows with `requester_id=requesterId`, ordered by `created_at DESC`, then `id DESC`, offset `(page-1)*pageSize`, limit `pageSize`.
3. `total` is the count of all rows with `requester_id=requesterId`.
4. Each item SHALL be:

```json
{
    "id": 1,
    "targetType": "article",
    "targetId": "abc12345",
    "reason": "内容包含我的个人信息",
    "status": "pending",
    "resolutionComment": null,
    "createdAt": "<datetime>",
    "handledAt": null
}
```

### 3.3 `listAdminRequests(status, page, pageSize)`

Preconditions:

1. `status` SHALL be one of `pending`, `approved`, `rejected`, `all`. Any other value throws status `400` with message `Invalid status filter`.
2. Pagination is normalized as in section 3.2.

Postconditions:

1. Return `{ requests, total, page, pageSize }`.
2. When `status != 'all'`, only rows with that `status` are considered; when `status='all'`, all rows are considered.
3. Ordering, offset, and limit are as in section 3.2.
4. Each item SHALL extend the section 3.2 item with:
    - `requester`: `{ id, name, luoguUid, avatarUrl }` from the requester's `registered_user` row, or `null` when that row no longer exists.
    - `handler`: `{ id, name }` from the handler's `registered_user` row for administrator handling; `{ id: null, name: 'system' }` when `handler_kind='system'`; or `null` when neither handler can be resolved.
    - `target`: `{ exists, deleted, title }` where `exists` is whether the target row is present, `deleted` is the target row's `deleted` flag (`false` when `exists=false`), and `title` is `article.title` for existing article targets and `null` otherwise.
    - `requesterIsAuthor`: `true` iff the requester row exists, the target row exists, and `registered_user.luogu_uid === target.author_id`.
5. Requester, handler, and target rows SHALL be fetched in batch (at most one query per table per call), not per item.

### 3.4 `approveRequest(requestId, handlerId, comment)`

Preconditions:

1. `comment` SHALL be normalized as `String(comment ?? '').trim()`; an empty result is stored as `NULL`. If it is longer than 500 characters, throw status `400` with message `Comment is too long (max 500 chars)`.
2. Load the `deletion_request` row by `requestId`. If absent, throw status `404` with message `Deletion request not found`.
3. If `status != 'pending'`, throw status `409` with message `Deletion request already handled`.
4. Load the target row by primary key with a direct database read (no Redis cache). If absent, throw status `404` with message `Target content not found` and do not modify the request.

Postconditions:

1. If the target row has `deleted=false`: set `deleted=true` and `delete_reason='应用户申请删除'`, then persist through `ArticleService.saveArticle` (articles) or `PasteService.savePaste` (pastes) so the owning subsystem's cache keys are evicted.
2. If the target row already has `deleted=true`, do not modify the target row.
3. For an article target, call the runtime deletion-marker synchronization defined by
   `search-system.spec.md` after the database row has `deleted=true`. This call SHALL also occur when
   the target row was already soft-deleted before this approval attempt.
4. In one database transaction: update the request row (`status='approved'`, `handler_id=handlerId`, `handler_kind='user'`, `handled_at=now`, `resolution_comment` per precondition 1) and create the approval notification defined in section 5.
5. Return the request in the item shape of section 3.3.

If article deletion-marker synchronization fails, `approveRequest` SHALL propagate the error and
SHALL NOT finalize the request. The article row MAY already have `deleted=true`. Retrying approval
SHALL retry marker synchronization and SHALL remain safe.

### 3.5 `rejectRequest(requestId, handlerId, comment)`

Preconditions 1-3 are identical to section 3.4. The target row is not loaded and never modified.

Postconditions:

1. In one database transaction: update the request row (`status='rejected'`, `handler_id=handlerId`, `handler_kind='user'`, `handled_at=now`, `resolution_comment` per section 3.4 precondition 1) and create the rejection notification defined in section 5.
2. Return the request in the item shape of section 3.3.

### 3.6 `restoreArticle(articleId)`

Preconditions:

1. Normalize `articleId` as `String(articleId ?? '').trim()`. If it is empty or longer than eight
   characters, throw status `400` with message `Valid article id is required`.
2. Load the article row by primary key with a direct database read. If absent, throw status `404`
   with message `Article not found`.

Postconditions:

1. Let `restored` equal the article's `deleted` value before modification.
2. If `restored=true`, set `deleted=false`, set `delete_reason=NULL`, and persist through
   `ArticleService.saveArticle` so article cache keys are evicted.
3. If `restored=false`, do not modify the database row.
4. Call the runtime deletion-marker synchronization defined by `search-system.spec.md` with the
   resulting article state, including when `restored=false`.
5. Return `{ id: article.id, restored }`.

The method SHALL be idempotent. If marker synchronization fails after the database update, the
method SHALL propagate the error; a retry SHALL repeat synchronization with `deleted=false`.

### 3.7 `restorePaste(pasteId)`

Preconditions:

1. Normalize `pasteId` as `String(pasteId ?? '').trim()`. If it is empty or longer than eight
   characters, throw status `400` with message `Valid paste id is required`.
2. Load the paste row by primary key with a direct database read. If absent, throw status `404`
   with message `Paste not found`.

Postconditions:

1. Let `restored` equal the paste's `deleted` value before modification.
2. If `restored=true`, set `deleted=false` and persist through `PasteService.savePaste` so paste
   cache keys are evicted. Do not modify `delete_reason`.
3. If `restored=false`, do not modify the database row.
4. Return `{ id: paste.id, restored }`.

The method SHALL be idempotent.

## 4. API Endpoints

### 4.1 POST `/deletion-request`

Role requirement: `requiresRole(UserRole.USER)`.

Request body shape is the `createRequest` input. The requester is `ctx.user.id`.

Response data is the created item (section 3.2 item shape).

### 4.2 GET `/deletion-request/mine`

Role requirement: `requiresRole(UserRole.USER)`.

Query parameters: `page`, `pageSize` (normalized per section 3.2).

Response data is the `listMyRequests` result for `ctx.user.id`.

### 4.3 GET `/admin/deletion-requests`

Role requirement: `requiresRole(UserRole.MODERATOR)`.

Query parameters: `status` (default `pending`), `page`, `pageSize`.

Response data is the `listAdminRequests` result.

### 4.4 POST `/admin/deletion-requests/:id/approve`

Role requirement: `requiresRole(UserRole.MODERATOR)`.

Path parameter `id` is converted with `Number(ctx.params.id)`. If it is not an integer greater than zero, return code `400` with message `Valid id is required`.

Request body shape: `{ "comment": "optional string" }`.

Response data is the `approveRequest` result with `handlerId=ctx.user.id`.

### 4.5 POST `/admin/deletion-requests/:id/reject`

Role requirement: `requiresRole(UserRole.MODERATOR)`.

Path parameter and body handling are identical to section 4.4.

Response data is the `rejectRequest` result with `handlerId=ctx.user.id`.

### 4.6 POST `/admin/articles/:id/restore`

Role requirement: `requiresRole(UserRole.MODERATOR)`.

The path parameter `id` is passed to `restoreArticle`. Validation failures use the status and
message defined by section 3.6.

Response data is `{ id, restored }` from `restoreArticle`.

### 4.7 POST `/admin/pastes/:id/restore`

Role requirement: `requiresRole(UserRole.MODERATOR)`.

The path parameter `id` is passed to `restorePaste`. Validation failures use the status and message
defined by section 3.7.

Response data is `{ id, restored }` from `restorePaste`.

## 5. Review Notifications

Each approval or rejection SHALL create exactly one user notification (see `user-notification-system.spec.md`) for `recipient_id = deletion_request.requester_id` inside the same transaction that updates the request row.

Let `targetLabel` be `文章 {target_id}` when `target_type='article'` and `剪贴板 {target_id}` when `target_type='paste'`. Let `comment` be the stored `resolution_comment`.

| Field      | Approved                                                           | Rejected                                                           |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `type`     | `deletion_review`                                                  | `deletion_review`                                                  |
| `title`    | `删除申请已通过`                                                   | `删除申请未通过`                                                   |
| `content`  | `您对{targetLabel}的删除申请已通过，相关内容已被删除。`            | `您对{targetLabel}的删除申请未通过。`                              |
| `metadata` | `{ deletionRequestId, targetType, targetId, outcome: 'approved' }` | `{ deletionRequestId, targetType, targetId, outcome: 'rejected' }` |

When `comment` is not `NULL`, the content SHALL have `\n处理备注：{comment}` appended.

## 6. Roles

Deletion request submission and self-listing SHALL require `UserRole.USER`. Moderation review and
article/paste restoration SHALL require `UserRole.MODERATOR` (satisfied by `MODERATOR` and `ADMIN`).

## 7. Invariants

1. At most one `pending` deletion request exists per (`target_type`, `target_id`, `requester_id`) except under concurrent creation races; the uniqueness check is service-level, not a database constraint.
2. A non-pending request is immutable through this subsystem's endpoints.
3. Approving a request whose target is already soft-deleted succeeds without modifying the target row and retries article search-marker synchronization.
4. Cache eviction for soft-deleted targets is delegated to `ArticleService.saveArticle` / `PasteService.savePaste`.
5. Soft deletion and restoration SHALL NOT physically delete article rows, Meilisearch documents,
   Chroma vectors, Chroma documents, or embeddings.
6. Restoring an article SHALL NOT change the terminal state of any deletion request.
7. Restoring a paste SHALL NOT change the terminal state of any deletion request.
8. Every automatically approved request SHALL remain queryable through `listAdminRequests` with `status='approved'` and SHALL identify its handler as `system`.

## 8. File Locations

- Deletion request entity: `packages/backend/src/entities/deletion-request.ts`
- Deletion request service: `packages/backend/src/services/deletion-request.service.ts`
- Deletion request router: `packages/backend/src/routers/deletion-request.router.ts`
- Admin review endpoints: `packages/backend/src/routers/admin.router.ts`
- Permission constants: `packages/backend/src/shared/permission.ts`
