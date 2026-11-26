# Admin User Management Specification

## 1. Scope

This specification defines backend registered-user administration endpoints implemented in `packages/backend/src/routers/admin.router.ts`.

Announcement, site notification, search rebuild, summary rebuild, embedding rebuild, and deletion request review admin endpoints are specified by their owning subsystem specs.

## 2. Roles

Every endpoint in this specification SHALL require `UserRole.ADMIN` through `requiresRole(UserRole.ADMIN)`.

The `requiresRole` middleware and `UserRole` enum are defined in `authentication.spec.md`.

## 3. GET `/admin/users`

The endpoint SHALL return all `registered_user` rows ordered by `created_at DESC`.

Each returned item SHALL contain exactly these fields from the route mapping:

| Field       | Source                                    |
| ----------- | ----------------------------------------- |
| `id`        | `registered_user.id`                      |
| `luoguUid`  | `registered_user.luogu_uid`               |
| `name`      | `registered_user.name`                    |
| `avatarUrl` | `registered_user.avatar_url`              |
| `createdAt` | `registered_user.created_at`              |
| `updatedAt` | `registered_user.updated_at`              |
| `role`      | `normalizeUserRole(registered_user.role)` |

The endpoint SHALL NOT include `registered_user.token` or `registered_user.cp_oauth_sub` in the response.

## 4. PATCH `/admin/users/:uid/role`

Input:

1. Path parameter `uid` is converted with `Number(ctx.params.uid)`.
2. Request body field `role` is read as a number.

Validation and behavior:

1. If `uid` is not an integer greater than zero, return code `400` with message `Valid uid is required`.
2. If `role` is absent or not one of the four `UserRole` enum values (`0`, `1`, `2`, `-1`), return code `400` with message `Valid role is required`.
3. If `uid === ctx.user.id`, return code `400` with message `Cannot change your own role`.
4. Load `RegisteredUser` by `id=uid`.
5. If no registered user exists, return code `404` with message `Registered user not found`.
6. Call `RegisteredUserService.updateRole(uid, role)`.
7. Return `{ uid, role }`.

## 5. File Locations

- Admin router: `packages/backend/src/routers/admin.router.ts`
- Registered user entity: `packages/backend/src/entities/registered-user.ts`
- Registered user service: `packages/backend/src/services/registered-user.service.ts`
- Permission constants: `packages/backend/src/shared/permission.ts`
