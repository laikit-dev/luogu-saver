# Backend Runtime Specification

## 1. Scope

This specification defines backend process startup behavior implemented by `packages/backend/src/index.ts`.

The runtime creates the Koa application, HTTP server, Socket.IO server, middleware chain, database connection, database pool monitor, workers, judgement scheduler, and HTTP listener.

## 2. Koa Application

The backend SHALL create one Koa application with:

| Option          | Value              |
| --------------- | ------------------ |
| `proxy`         | `true`             |
| `proxyIpHeader` | `CF-Connecting-IP` |

Koa `ctx.ip` therefore follows Koa proxy resolution rules for this configuration.

## 3. HTTP Server and Socket.IO

The backend SHALL create one Node HTTP server from `app.callback()`.

The backend SHALL call `initSocket(server, socketJoinHandler)` before installing Koa middleware and before database initialization.

Socket.IO behavior is specified in `socket-system.spec.md`.

## 4. Middleware Order

The backend SHALL install middleware in this exact order:

1. `accessLog`.
2. `responseHelper`.
3. `authorization`.
4. `apiRateLimit`.
5. `bodyParser()`.
6. `tracking`.
7. `router.routes()` and `router.allowedMethods()`.

Middleware behavior is specified in `api-middleware.spec.md`.

## 5. Startup Sequence

After middleware installation, the backend SHALL call `AppDataSource.initialize()`.

When `AppDataSource.initialize()` resolves:

1. Call `DatabasePoolMonitor.start(AppDataSource)`.
2. Await `worker.bootstrap()`.
3. Call `JudgementSyncScheduler.start()`.
4. Call `server.listen(config.port, config.host, callback)`.
5. In the listen callback, write one info log with fields `{ host: config.host, port: config.port }` and message `Server started.`.

The HTTP server SHALL NOT start listening before the database initialization and worker bootstrap have completed.

Workflow recovery is started inside `worker.bootstrap()` and runs in the background; HTTP listening does not wait for recovery completion.

## 6. Startup Failure Behavior

If `AppDataSource.initialize()` rejects, there is no local catch block in `index.ts`.

If `DatabasePoolMonitor.start(AppDataSource)` throws synchronously, there is no local catch block in `index.ts`.

If `worker.bootstrap()` rejects, there is no local catch block in `index.ts`.

If `JudgementSyncScheduler.start()` throws synchronously, there is no local catch block in `index.ts`.

These failures are handled by the Node.js unhandled rejection or uncaught exception behavior configured outside this module.

## 7. File Locations

- Runtime entry point: `packages/backend/src/index.ts`
- Root router: `packages/backend/src/routers/index.ts`
- Socket initialization: `packages/backend/src/lib/socket.ts`
- Database pool monitor: `packages/backend/src/services/database-pool-monitor.service.ts`
- Worker bootstrap: `packages/backend/src/workers/index.ts`
- Judgement scheduler: `packages/backend/src/services/judgement-sync-scheduler.service.ts`
