# Announcement System Specification

## 1. Scope

This specification defines backend announcement and site notification behavior implemented under `packages/backend`.

The announcement system stores one site-wide legacy HTML announcement. The site notification system stores zero or more banner notifications and zero or more popup notifications.

## 2. Announcement Entity

Table name: `announcement`

| Column       | Type       | Constraints | Description             |
| ------------ | ---------- | ----------- | ----------------------- |
| `id`         | INT        | PRIMARY KEY | Announcement identifier |
| `title`      | VARCHAR    | NOT NULL    | Display title           |
| `content`    | MEDIUMTEXT | NOT NULL    | Sanitized HTML content  |
| `enabled`    | TINYINT    | DEFAULT 1   | Public visibility flag  |
| `created_at` | DATETIME   | NOT NULL    | Creation timestamp      |
| `updated_at` | DATETIME   | NOT NULL    | Last update timestamp   |

There SHALL be at most one logical legacy announcement. Its `id` SHALL be `1`.

## 2.1 Site Notification Entity

Table name: `site_notification`

| Column       | Type         | Constraints | Description                               |
| ------------ | ------------ | ----------- | ----------------------------------------- |
| `id`         | INT UNSIGNED | PRIMARY KEY | Notification identifier                   |
| `channel`    | VARCHAR(16)  | NOT NULL    | `banner` or `popup`                       |
| `title`      | VARCHAR      | NOT NULL    | Display title                             |
| `content`    | MEDIUMTEXT   | NULLABLE    | Sanitized HTML content                    |
| `enabled`    | TINYINT      | DEFAULT 1   | Public visibility flag                    |
| `login_only` | TINYINT      | DEFAULT 0   | Visibility requires authentication        |
| `sort_order` | INT          | DEFAULT 0   | Ascending order within the channel        |
| `created_at` | DATETIME     | NOT NULL    | Creation timestamp                        |
| `updated_at` | DATETIME     | NOT NULL    | Notification version and last update time |

Each row represents one independently readable notification.

## 2.2 Notification Read State Entity

Table name: `notification_read_state`

| Column                    | Type         | Constraints | Description                            |
| ------------------------- | ------------ | ----------- | -------------------------------------- |
| `registered_user_id`      | INT UNSIGNED | PRIMARY KEY | Registered user ID                     |
| `notification_id`         | INT UNSIGNED | PRIMARY KEY | Site notification ID                   |
| `notification_updated_at` | DATETIME     | NOT NULL    | Notification version read by this user |
| `read_at`                 | DATETIME     | NOT NULL    | Last read-state update timestamp       |

There SHALL be at most one row per `(registered_user_id, notification_id)`.

## 2.3 HTML Sanitization Policy

Both announcement `content` and site notification `content` SHALL be sanitized on write (`updateAnnouncement`, `replaceAdminNotifications`) and on read (`getPublicAnnouncement`, `getAdminAnnouncement`, `getCurrentNotifications`, `getAdminNotifications`).

The backend HTML sanitizer SHALL:

1. Allow only safe structural and formatting tags: `p`, `br`, `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `ins`, `mark`, `small`, `sub`, `sup`, `code`, `pre`, `blockquote`, `hr`, `ul`, `ol`, `li`, `a`, `span`, `div`, `h1`–`h6`, `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, and `img`.
2. Strip executable and dangerous tags (`script`, `style`, `iframe`, `object`, `embed`, `svg`, `math`, `form`, `input`, `button`, `textarea`, `select`, `meta`, `link`, `base`) together with their non-safe contents, and strip all event-handler (`on*`) and inline `style` attributes.
3. Allow only explicit safe attributes: `a[href,title,target,rel]`, `img[src,alt,title,width,height]`, and `th`/`td[colspan,rowspan,align]`.
4. Restrict `a[href]` to `http:`, `https:`, `mailto:`, or root-relative URLs, and restrict `img[src]` to `http:`, `https:`, or root-relative URLs.
5. When `a[target]` is `_blank`, enforce `rel="noopener noreferrer"`; strip other `target` values.

The frontend SHALL apply an equivalent DOMPurify allowlist before rendering announcement, notification, or admin preview HTML via `v-html`.

## 3. Announcement Service Layer

### 3.1 `getPublicAnnouncement()`

Postconditions:

1. If row `id=1` does not exist, return `null`.
2. If row `id=1` has `enabled=false`, return `null`.
3. If row `id=1` has `enabled=true`, return `{ id, title, content, enabled, updatedAt }`.
4. The returned `enabled` field SHALL be a JSON boolean. It SHALL NOT be numeric `0` or `1`.

### 3.2 `getAdminAnnouncement()`

Postconditions:

1. If row `id=1` exists, return it.
2. If row `id=1` does not exist, return an unsaved default object with `id=1`, `title="公告"`, `content=""`, and `enabled=true`.
3. The returned `enabled` field SHALL be a JSON boolean. It SHALL NOT be numeric `0` or `1`.

### 3.3 `updateAnnouncement(input)`

Input shape:

```json
{
    "title": "公告",
    "content": "<p>HTML</p>",
    "enabled": true
}
```

Preconditions:

1. `title` SHALL be converted to string and trimmed.
2. `content` SHALL be converted to string and sanitized according to Section 2.3.
3. `enabled` SHALL be converted with `Boolean(input.enabled)`.

Postconditions:

1. If trimmed `title` is empty, persist `title="公告"`.
2. Persist row `id=1` with normalized and sanitized fields.
3. Return the persisted row.
4. The returned `enabled` field SHALL be a JSON boolean. It SHALL NOT be numeric `0` or `1`.

## 4. Site Notification Service Layer

### 4.1 `getAdminNotifications()`

Postconditions:

1. Return all `site_notification` rows.
2. Returned rows SHALL be ordered by `channel ASC`, then `sort_order ASC`, then `id ASC`.

### 4.2 `replaceAdminNotifications(input)`

Input shape:

```json
{
    "notifications": [
        {
            "id": 1,
            "channel": "banner",
            "title": "通知",
            "content": "<p>HTML</p>",
            "enabled": true,
            "loginOnly": false,
            "sortOrder": 0
        }
    ]
}
```

Preconditions:

1. `notifications` SHALL be an array.
2. Each `channel` SHALL be `banner` or `popup`.
3. Each `title` SHALL be converted to string and trimmed.
4. Each `content` SHALL be converted to string and sanitized according to Section 2.3.
5. Each `enabled` and `loginOnly` SHALL be converted with JavaScript `Boolean(value)` semantics.
6. Each `sortOrder` SHALL be converted to an integer. Non-finite values SHALL become `0`.
   Postconditions:

7. If a row has an integer `id` that exists in `site_notification`, update that row.
8. If a row has no existing integer `id`, create a new row.
9. If a stored row ID is absent from the input array, delete that row.
10. If a stored row is deleted, delete all `notification_read_state` rows for that notification ID.
11. If a persisted notification field differs from the previous stored value, its `updated_at` SHALL change.
12. Return all persisted rows ordered by `channel ASC`, then `sort_order ASC`, then `id ASC`.

### 4.3 `getCurrentNotifications(userId?)`

Postconditions:

1. Consider only rows with `enabled=true`.
2. If a notification has `loginOnly=true` and `userId` is absent, exclude that notification.
3. Return `{ banners, popups }` where each property is an array.
4. Each returned item SHALL include `{ id, channel, title, content, loginOnly, sortOrder, updatedAt, read }`.
5. If `userId` is absent, `read=false` in the backend response. The frontend determines anonymous read state from localStorage.
6. If `userId` is present, `read=true` iff `notification_read_state.notification_updated_at >= site_notification.updated_at` for that `(userId, notificationId)`.
7. Each array SHALL be ordered by `sort_order ASC`, then `id ASC`.

### 4.4 `markNotificationRead(userId, notificationId, updatedAt?)`

Preconditions:

1. `userId` SHALL be an authenticated registered user ID.
2. `notificationId` SHALL identify an existing `site_notification` row.
3. If `updatedAt` is provided, it SHALL match the current row `updated_at`; otherwise the backend SHALL reject with 409.

Postconditions:

1. Upsert one `notification_read_state` row for `(userId, notificationId)`.
2. Persist `notification_updated_at` equal to the current notification `updated_at`.
3. Persist `read_at` equal to current time. The exact persisted value MAY be supplied by TypeORM `@UpdateDateColumn` semantics during save.

## 5. API Endpoints

### 5.1 GET `/announcement/current`

Permission: public.

Response data shape when no announcement is public:

```json
null
```

Response data shape when an announcement is public:

```json
{
    "id": 1,
    "title": "公告",
    "content": "<p>HTML</p>",
    "enabled": true,
    "updatedAt": "<datetime>"
}
```

### 5.2 GET `/admin/announcement`

Permission: `MANAGE_ANNOUNCEMENTS`.

Response data shape:

```json
{
    "id": 1,
    "title": "公告",
    "content": "<p>HTML</p>",
    "enabled": true,
    "createdAt": "<datetime>",
    "updatedAt": "<datetime>"
}
```

If the row does not exist, `createdAt` and `updatedAt` MAY be absent.

### 5.3 PUT `/admin/announcement`

Permission: `MANAGE_ANNOUNCEMENTS`.

Request body shape is the same as `updateAnnouncement(input)`.

Postconditions:

1. Persist the normalized announcement.
2. Return the persisted row.

### 5.4 GET `/admin/notifications`

Permission: `MANAGE_ANNOUNCEMENTS`.

Response data shape:

```json
{
    "notifications": [
        {
            "id": 1,
            "channel": "banner",
            "title": "通知",
            "content": "<p>HTML</p>",
            "enabled": true,
            "loginOnly": false,
            "sortOrder": 0,
            "createdAt": "<datetime>",
            "updatedAt": "<datetime>"
        }
    ]
}
```

### 5.5 PUT `/admin/notifications`

Permission: `MANAGE_ANNOUNCEMENTS`.

Request body shape is the same as `replaceAdminNotifications(input)`.

Postconditions:

1. Replace the notification set with the normalized input rows.
2. Return `{ notifications }` with persisted rows.

### 5.6 GET `/notification/current`

Permission: public.

The optional bearer token from the global authorization middleware determines authenticated read state.

Response data shape:

```json
{
    "banners": [
        {
            "id": 1,
            "channel": "banner",
            "title": "通知",
            "content": "<p>HTML</p>",
            "loginOnly": false,
            "sortOrder": 0,
            "updatedAt": "<datetime>",
            "read": false
        }
    ],
    "popups": []
}
```

### 5.7 POST `/notification/read`

Permission: authenticated user.

Request body shape:

```json
{
    "notificationId": 1,
    "updatedAt": "<datetime>"
}
```

Postconditions:

1. Mark the current notification as read for `ctx.user.id`.
2. Return the updated read state `{ notificationId, updatedAt, read: true }`.

Failure cases:

1. If `ctx.user` is absent, return 401.
2. If `notificationId` is not a positive integer, return 400.
3. If `notificationId` does not identify an existing notification, return 404.
4. If `updatedAt` is present and does not match the current notification timestamp, return 409.

## 6. Permissions

The permission bitmask SHALL include `MANAGE_ANNOUNCEMENTS = 1 << 5`.

`ROLE_ADMIN = -1` SHALL satisfy the `MANAGE_ANNOUNCEMENTS` permission check.
