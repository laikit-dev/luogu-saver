# Socket System Specification

## 1. Scope

This specification defines Socket.IO behavior implemented by `packages/backend/src/lib/socket.ts` and `packages/backend/src/socket`.

The socket system provides optional connection authentication, room join hooks, task status replay, and queue statistics broadcasting.

## 2. Socket.IO Server

`initSocket(server, joinRoomCallback?)` SHALL create one Socket.IO server with:

| Option         | Value             |
| -------------- | ----------------- |
| `path`         | `/websocket`      |
| `cors.origin`  | `*`               |
| `cors.methods` | `['GET', 'POST']` |

The created server SHALL be stored in a module-level singleton variable.

Calling `initSocket` again replaces the singleton with a new Socket.IO server.

## 3. Connection Authentication

Socket.IO connections MAY be anonymous.

On connection middleware execution:

1. Read `socket.handshake.auth.token`.
2. If the token is not a string or trims to the empty string, allow the connection and do not set `socket.data.user`.
3. If the token is non-empty, call `RegisteredUserService.validateBearerToken(token)`.
4. If validation returns a principal `{ id, role, luoguUid }`, set `socket.data.user = { id, role }` and allow the connection.
5. If validation returns null or throws, reject the connection with `Error('Unauthorized')`.

## 4. Room Join Event

The server SHALL listen for client event `join` with one argument `room`.

Join flow:

1. If `joinRoomCallback` exists, call it with `(socket, room)` before joining the room.
2. If the callback throws, log the error and emit `join:error` to the socket with `{ room, message: 'Failed to join room' }`.
3. If the callback returns `{ allowed: false }`, do not join the room and emit `join:error` to the socket with `{ room, message }`, where `message` is `result.error || 'Permission denied'`.
4. Otherwise call `socket.join(room)`.
5. After joining, if the callback result contains `afterJoin`, call it.

The room value is not normalized by `lib/socket.ts` before being passed to the callback or to `socket.join`.

## 5. Room Leave Event

The server SHALL listen for client event `leave` with one argument `room`.

On leave:

1. Call `socket.leave(room)`.
2. Emit event `leave:{room}` to the same socket.
3. Log the leave operation.

## 6. Room Authorization Callback

`socketJoinHandler(socket, room)` SHALL implement room-specific join behavior.

Rules:

1. If `room === 'stats:queues'`, return `afterJoin = () => QueueStatsBroadcaster.handleJoin(socket)`.
2. If `isContentRoom(room)` is true (matching `^(article|paste|user)_(.+)$`), return `afterJoin = () => handleContentRoomJoin(socket, room)`.
3. Otherwise split `room` by `:` and read `[type, id]`.
4. If `type === 'task'`, return `afterJoin = () => handleTaskRoomJoin(socket, id)`.
5. For any other room, return an empty result and allow the join.

## 7. Task Room Replay

When a socket joins `task:{taskId}`, `handleTaskRoomJoin(socket, taskId)` SHALL:

1. Load the task through `TaskService.getTaskById(taskId)`.
2. If the task exists and has status `COMPLETED`, emit event `task:{taskId}:completed` to room `task:{taskId}` with payload `{ status: 'completed' }`.
3. If the task exists and has status `FAILED`, emit event `task:{taskId}:failed` to room `task:{taskId}` with payload `{ status: 'failed', error }`, where `error` is normalized by failure reason normalization.
4. If the task is absent or non-terminal, emit no task replay event.
5. If loading the task throws, log the error and emit no task replay event.

Replay emits to the whole room, not only to the joining socket. Completed replay does not include the stored task result.

## 8. Queue Statistics Room

Room `stats:queues` SHALL publish event `stats:queues:update` as specified in `task-queue.spec.md`.

When `QueueStatsBroadcaster.handleJoin(socket)` is called:

1. Increment a process-local subscriber counter by one.
2. Register one `disconnect` listener that decrements the counter once.
3. Register one `leave:stats:queues` listener that decrements the counter once.
4. Ensure a timer exists.
5. Emit one `stats:queues:update` payload to the joining socket.

The timer interval SHALL be 2000 ms. Each tick SHALL emit fresh queue stats to room `stats:queues` when the subscriber counter is greater than zero.

Duplicate joins by the same socket increment the counter more than once because membership is counted by join calls, not by distinct socket IDs.

## 9. Content Refresh State Tracking and Room Replay

`ContentRefreshStateService` SHALL track active background `TaskType.SAVE` tasks in process-local state for the following `(target, targetId)` pairs and map each pair to its room and refresh-state event:

| SaveTarget | Room                 | Refresh-State Event                         |
| ---------- | -------------------- | ------------------------------------------- |
| `article`  | `article_{targetId}` | `article:{targetId}:refresh-state`          |
| `comments` | `article_{targetId}` | `article:{targetId}:comments-refresh-state` |
| `paste`    | `paste_{targetId}`   | `paste:{targetId}:refresh-state`            |
| `profile`  | `user_{targetId}`    | `user:{targetId}:profile-refresh-state`     |

Payload schema for every refresh-state event SHALL be `{ refreshing: boolean, activeCount: number }`, where `refreshing` equals `activeCount > 0`.

State lifecycle rules:

1. `markActive(taskId, type, payload, now?)`: if `type === TaskType.SAVE`, `payload.target` is one of the four tracked targets, and `taskId` and `String(payload.targetId).trim()` are non-empty, prune expired entries first, record `taskId` with timestamp `now` (default `Date.now()`), and if active task membership changed, broadcast the resulting payload via `emitToRoom(room, event, state)`.
2. `markInactive(taskId, type, payload, now?)`: for a tracked `TaskType.SAVE` task, prune expired entries first, remove `taskId`, and if active task membership changed, broadcast the resulting payload via `emitToRoom(room, event, state)`.
3. Entries whose recorded timestamp satisfies `now - timestamp > 900000` (15 minutes, `CONTENT_REFRESH_STALE_TTL_MS = 900000`) SHALL be pruned on read and write operations.
4. Non-`TaskType.SAVE` tasks, non-tracked targets, empty `taskId`, or empty `targetId` SHALL be ignored without throwing or broadcasting.

Room join replay (`handleContentRoomJoin(socket, room)`):

1. Emit the current state directly to the joining `socket` via `socket.emit(event, state)` (not `emitToRoom`) for each target mapped to `room`:
    - `article_{id}`: emit both `article:{id}:refresh-state` and `article:{id}:comments-refresh-state`.
    - `paste_{id}`: emit `paste:{id}:refresh-state`.
    - `user_{uid}`: emit `user:{uid}:profile-refresh-state`.

## 10. Emit and Singleton Access

`emitToRoom(room, event, data = {})` SHALL:

1. If the singleton Socket.IO server is absent, log a warning and return without throwing.
2. If the singleton exists, emit `event` with `data` to `io.to(room)`.

`getIo()` SHALL:

1. Return the singleton Socket.IO server when it exists.
2. Throw `Error('Socket.io not initialized')` when the singleton is absent.

## 11. File Locations

- Socket singleton: `packages/backend/src/lib/socket.ts`
- Socket room callback: `packages/backend/src/socket/index.ts`
- Task room handler: `packages/backend/src/socket/handlers/task.handler.ts`
- Content room handler: `packages/backend/src/socket/handlers/content-room.handler.ts`
- Content refresh state service: `packages/backend/src/services/content-refresh-state.service.ts`
- Queue stats broadcaster: `packages/backend/src/services/queue-stats-broadcaster.service.ts`
