# Socket System Specification

## 1. Scope

This specification defines Socket.IO behavior implemented by `packages/backend/src/lib/socket.ts` and `packages/backend/src/socket`.

The socket system provides optional connection authentication, room join hooks, task status replay, queue statistics broadcasting, and discovery run broadcasting.

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
2. If `room === 'discovery:runs'`, require `socketHasPermission(socket, MANAGE_DISCOVERY)`.
3. If discovery permission is missing, return `{ allowed: false, error: 'Permission denied' }`.
4. If discovery permission is present, return `afterJoin = () => ArticleDiscoveryBroadcaster.emitCurrentRunsToSocket(socket)`.
5. Otherwise split `room` by `:` and read `[type, id]`.
6. If `type === 'task'`, return `afterJoin = () => handleTaskRoomJoin(socket, id)`.
7. For any other room, return an empty result and allow the join.

`socketHasPermission(socket, permissionBit)` SHALL return true when `socket.data.user.role === ROLE_ADMIN`; otherwise it SHALL require `(role & permissionBit) === permissionBit`.

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

## 9. Discovery Runs Room

Room `discovery:runs` behavior is specified in `article-discovery.spec.md`.

The socket join handler SHALL reject unauthorized joins before `socket.join(room)` is called.

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
- Queue stats broadcaster: `packages/backend/src/services/queue-stats-broadcaster.service.ts`
- Discovery broadcaster: `packages/backend/src/services/article-discovery-broadcaster.service.ts`
