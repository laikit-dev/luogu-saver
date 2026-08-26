# Router Composition Specification

## 1. Scope

This specification defines the root backend router composition implemented by `packages/backend/src/routers/index.ts`.

Individual route behavior is owned by each subsystem specification. This file only defines which feature routers are mounted and in what order.

## 2. Root Router

The backend SHALL create one root `koa-router` instance with no prefix.

The root router SHALL mount feature routers by calling each feature router's `routes()` and `allowedMethods()` middleware pair.

## 3. Mount Order

The root router SHALL mount feature routers in this exact order:

1. `articleRouter` from `packages/backend/src/routers/article.router.ts`.
2. `pasteRouter` from `packages/backend/src/routers/paste.router.ts`.
3. `plazaRouter` from `packages/backend/src/routers/plaza.router.ts`.
4. `taskRouter` from `packages/backend/src/routers/task.router.ts`.
5. `workflowRouter` from `packages/backend/src/routers/workflow.router.ts`.
6. `censorshipRouter` from `packages/backend/src/routers/censorship.router.ts`.
7. `tokenRouter` from `packages/backend/src/routers/token.router.ts`.
8. `authRouter` from `packages/backend/src/routers/auth.router.ts`.
9. `userRouter` from `packages/backend/src/routers/user.router.ts`.
10. `searchRouter` from `packages/backend/src/routers/search.router.ts`.
11. `adminRouter` from `packages/backend/src/routers/admin.router.ts`.
12. `statsRouter` from `packages/backend/src/routers/stats.router.ts`.
13. `judgementRouter` from `packages/backend/src/routers/judgement.router.ts`.
14. `announcementRouter` from `packages/backend/src/routers/announcement.router.ts`.
15. `advertisementRouter` from `packages/backend/src/routers/advertisement.router.ts`.
16. `notificationRouter` from `packages/backend/src/routers/notification.router.ts`.
17. `discoveryRouter` from `packages/backend/src/routers/discovery.router.ts`.
18. `deletionRequestRouter` from `packages/backend/src/routers/deletion-request.router.ts`.
19. `userNotificationRouter` from `packages/backend/src/routers/user-notification.router.ts`.

## 4. Prefix Ownership

Feature router prefixes SHALL be defined inside the feature router files, not in the root router.

The root router SHALL NOT rewrite request paths, strip prefixes, or add global route prefixes.

## 5. File Locations

- Root router: `packages/backend/src/routers/index.ts`
- Runtime installation: `packages/backend/src/index.ts`
