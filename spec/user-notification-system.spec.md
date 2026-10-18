# User Notification System Specification

## 1. Scope

This specification defines the backend per-user notification subsystem implemented under `packages/backend`.

A user notification is a message addressed to exactly one registered user. It is distinct from the site notification system (`announcement-system.spec.md`), which broadcasts banners and popups to all visitors.

The specified producers are deletion request reviews (`deletion-request-system.spec.md`) with `type='deletion_review'` and opt-in archive digests (`user-archive-system.spec.md`) with `type='archive_digest'`.

## 2. User Notification Entity

Table name: `user_notification`

| Column         | Type         | Constraints                 | Description                           |
| -------------- | ------------ | --------------------------- | ------------------------------------- |
| `id`           | INT UNSIGNED | PRIMARY KEY, AUTO INCREMENT | Notification identifier               |
| `recipient_id` | INT UNSIGNED | NOT NULL                    | `registered_user.id` of the recipient |
| `type`         | VARCHAR(32)  | NOT NULL                    | Producer-defined notification type    |
| `title`        | VARCHAR(255) | NOT NULL                    | Display title                         |
| `content`      | TEXT         | NULLABLE                    | Plain text body; `\n` separates lines |
| `metadata`     | JSON         | NULLABLE                    | Producer-defined structured payload   |
| `read_at`      | DATETIME     | NULLABLE                    | Read timestamp; `NULL` means unread   |
| `created_at`   | DATETIME     | NOT NULL                    | Record creation timestamp             |

### 2.1 Indexes

- `idx_user_notification_recipient_created_at`: (`recipient_id`, `created_at`)
- `idx_user_notification_recipient_read_at`: (`recipient_id`, `read_at`)

### 2.2 Read Semantics

A notification is `read` iff `read_at` is not `NULL`. There is no unread transition: no endpoint SHALL set a non-`NULL` `read_at` back to `NULL`.

## 3. Service Layer

All methods are static members of `UserNotificationService`.

### 3.1 `createNotification(input, manager?)`

Input shape:

```json
{
    "recipientId": 1,
    "type": "deletion_review",
    "title": "删除申请已通过",
    "content": "您对文章 abc12345 的删除申请已通过，相关内容已被删除。",
    "metadata": { "deletionRequestId": 1 }
}
```

Preconditions:

1. `recipientId` SHALL be an integer greater than zero; otherwise throw status `400` with message `Valid recipientId is required`.
2. `type` and `title` SHALL be non-empty strings after `String(value ?? '').trim()`; otherwise throw status `400` with message `Valid type and title are required`.

Postconditions:

1. Insert one `user_notification` row with `read_at=NULL`. `content` is stored as `NULL` when absent or empty after trimming; `metadata` is stored as `NULL` when absent.
2. When `manager` is provided, the insert SHALL use that `EntityManager`.
3. Return the persisted row.

### 3.2 `listNotifications(userId, page, pageSize)`

Pagination normalization:

1. `page` SHALL be `clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER)`: non-numeric values become `1`, fractional values are floored, and values below `1` become `1`.
2. `pageSize` SHALL be `clampInt(pageSize, 20, 1, 100)`: non-numeric values become `20`, fractional values are floored, and values are clamped into `[1, 100]`.

Postconditions:

1. Return `{ notifications, total, unreadCount, page, pageSize }`.
2. `notifications` contains only rows with `recipient_id=userId`, ordered by `created_at DESC`, then `id DESC`, offset `(page-1)*pageSize`, limit `pageSize`.
3. `total` is the count of all rows with `recipient_id=userId`.
4. `unreadCount` is the count of rows with `recipient_id=userId` and `read_at IS NULL`.
5. Each item SHALL be:

```json
{
    "id": 1,
    "type": "deletion_review",
    "title": "删除申请已通过",
    "content": "...",
    "metadata": { "deletionRequestId": 1 },
    "read": false,
    "createdAt": "<datetime>"
}
```

`content` and `metadata` are `null` when the stored columns are `NULL`. `read` is `true` iff `read_at` is not `NULL`.

### 3.3 `getUnreadCount(userId)`

Postconditions:

1. Return the count of rows with `recipient_id=userId` and `read_at IS NULL`.

### 3.4 `markRead(userId, ids)`

Preconditions:

1. `ids` SHALL be an array with 1 to 100 elements where every element is an integer greater than zero; otherwise throw status `400` with message `Valid ids array is required`.

Postconditions:

1. Set `read_at=now` on every row whose `id` is in `ids`, `recipient_id=userId`, and `read_at IS NULL`.
2. Rows not owned by `userId` and already-read rows are not modified and cause no error.
3. Return `{ updated }` where `updated` is the number of modified rows.

### 3.5 `markAllRead(userId)`

Postconditions:

1. Set `read_at=now` on every row with `recipient_id=userId` and `read_at IS NULL`.
2. Return `{ updated }` where `updated` is the number of modified rows.

## 4. API Endpoints

All endpoints require `requiresPermission(Permission.LOGIN)` and operate on `ctx.user.id`.

### 4.1 GET `/user-notification/list`

Query parameters: `page`, `pageSize` (normalized per section 3.2).

Response data is the `listNotifications` result.

### 4.2 GET `/user-notification/unread-count`

Response data shape: `{ "count": 0 }`.

### 4.3 POST `/user-notification/read`

Request body shape: `{ "ids": [1, 2] }`.

Response data is the `markRead` result.

### 4.4 POST `/user-notification/read-all`

Request body: none.

Response data is the `markAllRead` result.

### 4.5 Archive Digest Producer

Archive digests SHALL be generated only for an enabled, due `archive_digest_preference`. The scheduler SHALL lock and recheck that preference within a database transaction, count currently visible eligible archive events since its checkpoint, and call `UserNotificationService.createNotification(input, manager)` with the same transaction's `EntityManager` when the count is positive.

The notification SHALL use `type='archive_digest'`, a generic count-only title and plain-text body, and metadata `{ kind: 'archive_digest', eventCount, from, to }`, where `from` and `to` are UTC ISO timestamps. It SHALL NOT contain archived article titles or bodies, profile biographies or slogans, relationship owners, or an arbitrary navigation URL. The recipient SHALL be the preference's registered-user owner.

The notification insertion and checkpoint advancement SHALL commit or roll back together. A zero count SHALL advance the checkpoint without inserting a notification. Concurrent scheduler instances SHALL not duplicate a due checkpoint; disabling the preference SHALL prevent future sends. First enable and re-enable SHALL start a fresh checkpoint at now, with a next send no earlier than 24 hours later. Per-owner failures SHALL not prevent other due owners from being processed.

The notification UI SHALL map the known metadata kind `archive_digest` to `/library?tab=feed`. The feed SHALL re-evaluate current visibility when opened rather than embed archived content in the notification.

## 5. Invariants

1. A notification is visible to exactly one registered user: its recipient.
2. `read_at` is monotonic: `NULL -> non-NULL` only.
3. Creating a notification never mutates any other table.

## 6. File Locations

- User notification entity: `packages/backend/src/entities/user-notification.ts`
- User notification service: `packages/backend/src/services/user-notification.service.ts`
- User notification router: `packages/backend/src/routers/user-notification.router.ts`
