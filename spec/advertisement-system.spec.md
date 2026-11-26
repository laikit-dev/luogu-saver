# Advertisement System Specification

## 1. Scope

This specification defines homepage advertisement persistence, administration, public retrieval, and frontend carousel behavior.

The backend implementation is under `packages/backend`.

The frontend administration and carousel implementation is under `packages/frontend`.

## 2. Advertisement Entity

Table name: `advertisement`.

| Column       | Type          | Constraints                 | Description                |
| ------------ | ------------- | --------------------------- | -------------------------- |
| `id`         | INT UNSIGNED  | PRIMARY KEY, AUTO_INCREMENT | Advertisement identifier   |
| `image_url`  | VARCHAR(2048) | NOT NULL                    | Advertisement image URL    |
| `alt_text`   | VARCHAR(255)  | NOT NULL                    | Image alternative text     |
| `target_url` | VARCHAR(2048) | NULLABLE                    | Optional navigation target |
| `enabled`    | TINYINT       | NOT NULL, DEFAULT 1         | Public visibility flag     |
| `sort_order` | INT           | NOT NULL, DEFAULT 0         | Ascending display order    |
| `created_at` | DATETIME      | NOT NULL                    | Creation timestamp         |
| `updated_at` | DATETIME      | NOT NULL                    | Last update timestamp      |

The table SHALL contain at most 10 rows.

## 3. URL Validation

The backend SHALL validate `imageUrl` and non-empty `targetUrl` values with the JavaScript `URL` constructor.

A valid advertisement URL SHALL satisfy all conditions:

1. The parsed protocol is exactly `http:` or `https:`.
2. The normalized URL string has length at most 2048 characters.

An empty `targetUrl` SHALL be normalized to `null`.

An empty `imageUrl` SHALL be rejected.

## 4. Service Layer

### 4.1 `getAdminAdvertisements()`

Postconditions:

1. Return every `advertisement` row.
2. Return rows ordered by `sort_order ASC`, then `id ASC`.
3. Each item contains `{ id, imageUrl, altText, targetUrl, enabled, sortOrder, createdAt, updatedAt }`.
4. `enabled` is a JSON boolean.

### 4.2 `replaceAdminAdvertisements(input)`

Input shape:

```json
{
    "advertisements": [
        {
            "id": 1,
            "imageUrl": "https://example.com/banner.webp",
            "altText": "Advertisement description",
            "targetUrl": "https://example.com/target",
            "enabled": true,
            "sortOrder": 0
        }
    ]
}
```

Preconditions:

1. `advertisements` SHALL be an array.
2. The array length SHALL be at most 10.
3. Each `imageUrl` SHALL be converted to string, trimmed, and validated by section 3.
4. Each `altText` SHALL be converted to string and trimmed.
5. Empty `altText` SHALL be rejected.
6. `altText` longer than 255 characters SHALL be rejected.
7. Each `targetUrl` SHALL be converted to string and trimmed. Empty values SHALL become `null`. Non-empty values SHALL be validated by section 3.
8. Each `enabled` SHALL be converted with JavaScript `Boolean(value)` semantics.
9. Each `sortOrder` SHALL be converted to a finite integer. Non-finite values SHALL become `0`.
10. Each positive integer `id` SHALL be treated as an update candidate. Every other `id` value SHALL be treated as absent.

Postconditions:

1. If an input item has an `id` that exists in `advertisement`, update that row.
2. If an input item has no existing `id`, create one row.
3. If a stored row ID is absent from the input array, delete that row.
4. Perform all creates, updates, and deletes in one database transaction.
5. Return all persisted rows ordered by `sort_order ASC`, then `id ASC`.

### 4.3 `getCurrentAdvertisements()`

Postconditions:

1. Consider only rows with `enabled=true`.
2. Return rows ordered by `sort_order ASC`, then `id ASC`.
3. Return at most 10 rows.
4. Each item contains exactly `{ id, imageUrl, altText, targetUrl, sortOrder }`.

## 5. API Endpoints

### 5.1 GET `/admin/advertisements`

Role requirement: `UserRole.MODERATOR`.

Response data shape:

```json
{
    "advertisements": [
        {
            "id": 1,
            "imageUrl": "https://example.com/banner.webp",
            "altText": "Advertisement description",
            "targetUrl": "https://example.com/target",
            "enabled": true,
            "sortOrder": 0,
            "createdAt": "<datetime>",
            "updatedAt": "<datetime>"
        }
    ]
}
```

### 5.2 PUT `/admin/advertisements`

Role requirement: `UserRole.MODERATOR`.

Request body shape is the same as `replaceAdminAdvertisements(input)`.

Postconditions:

1. Replace the advertisement set with the normalized input array.
2. Return `{ advertisements }` with persisted rows.

### 5.3 GET `/advertisement/current`

Permission: public.

Response data shape:

```json
{
    "advertisements": [
        {
            "id": 1,
            "imageUrl": "https://example.com/banner.webp",
            "altText": "Advertisement description",
            "targetUrl": "https://example.com/target",
            "sortOrder": 0
        }
    ]
}
```

If no advertisement is enabled, return `{ "advertisements": [] }`.

## 6. Administration UI

The site administration panel SHALL provide advertisement controls only when the current user has `UserRole.MODERATOR` or higher.

The controls SHALL support:

1. Load the complete advertisement set from `GET /admin/advertisements`.
2. Add an advertisement draft while fewer than 10 drafts exist.
3. Edit `imageUrl`, `altText`, `targetUrl`, and `enabled`.
4. Move a draft one position upward or downward.
5. Delete a draft.
6. Preview the configured image.
7. Save the complete set with `PUT /admin/advertisements`.

Before saving, the frontend SHALL assign `sortOrder = index * 10` according to the visible draft order.

## 7. Homepage Carousel

The homepage SHALL request `GET /advertisement/current` once when mounted.

If the returned array is empty, the carousel SHALL NOT render.

If the returned array contains one item:

1. Render that item.
2. Do not start an automatic rotation timer.
3. Do not render previous, next, or position controls.

If the returned array contains at least two items:

1. Render one item at a time.
2. Advance to the next item every 5000 milliseconds.
3. After the last item, advance to the first item.
4. Render previous and next icon buttons.
5. Render one position indicator per item.
6. Pause automatic rotation while the carousel or any descendant has pointer hover.
7. Pause automatic rotation while the carousel or any descendant has keyboard focus.
8. Resume automatic rotation after pointer hover and keyboard focus have both ended.

If `targetUrl` is a valid `http:` or `https:` URL, the image SHALL be contained in an anchor with `target="_blank"` and `rel="noopener noreferrer sponsored"`.

If `targetUrl` is null or fails frontend `http:` / `https:` protocol validation, the image SHALL NOT be contained in an anchor.

The image SHALL only bind `src` when `imageUrl` passes `http:` / `https:` protocol validation, and SHALL use its `altText` as the HTML `alt` attribute.
The carousel frame SHALL use a stable `16 / 9` aspect ratio and `object-fit: cover`.

The carousel SHALL appear below the two homepage statistic cards on desktop.

At viewport widths at or below 800 pixels, the carousel SHALL appear after the two statistic cards in normal document flow.

## 8. Invariants

1. The backend SHALL NOT return disabled advertisements from the public endpoint.
2. The public endpoint SHALL NOT expose `enabled`, `createdAt`, or `updatedAt`.
3. Saving advertisement configuration is an all-or-nothing transaction.
4. The frontend SHALL NOT render raw advertisement HTML.
5. The frontend SHALL NOT derive image or target URLs from HTML content.

## 9. File Locations

- Entity: `packages/backend/src/entities/advertisement.ts`
- Service: `packages/backend/src/services/advertisement.service.ts`
- Public router: `packages/backend/src/routers/advertisement.router.ts`
- Admin router: `packages/backend/src/routers/admin.router.ts`
- Frontend API: `packages/frontend/src/api/advertisement.ts`
- Administration panel: `packages/frontend/src/views/admin/panels/AdminSitePanel.vue`
- Carousel: `packages/frontend/src/components/AdvertisementCarousel.vue`
- Homepage: `packages/frontend/src/views/HomeView.vue`
