# Worker Runtime Specification

## 1. Scope

This specification defines worker bootstrap, task processor, worker host, PointGuard, and common worker helper behavior implemented under `packages/backend/src/workers` and `packages/backend/src/lib/point-guard.ts`.

Business behavior for individual handlers is defined in each subsystem spec.

## 2. Worker Bootstrap

`worker.bootstrap()` SHALL create one `TaskProcessor` per task type group:

1. Save.
2. LLM.
3. Update.
4. Search.
5. Read.
6. RAG.
7. Discover.

It SHALL register handlers listed in `task-queue.spec.md`, including the `save:judgement` handler in the save processor.

It SHALL create worker hosts:

| Task type  | Queue name source       | PointGuard | Concurrency source                       |
| ---------- | ----------------------- | ---------- | ---------------------------------------- |
| `save`     | `QUEUE_NAMES[save]`     | yes        | `config.queue.save.concurrencyLimit`     |
| `llm`      | `QUEUE_NAMES[llm]`      | yes        | `config.queue.ai.concurrencyLimit`       |
| `update`   | `QUEUE_NAMES[update]`   | no         | `config.queue.update.concurrencyLimit`   |
| `search`   | `QUEUE_NAMES[search]`   | no         | `config.queue.search.concurrencyLimit`   |
| `read`     | `QUEUE_NAMES[read]`     | no         | `config.queue.read.concurrencyLimit`     |
| `rag`      | `QUEUE_NAMES[rag]`      | no         | `config.queue.rag.concurrencyLimit`      |
| `discover` | `QUEUE_NAMES[discover]` | no         | `config.queue.discover.concurrencyLimit` |

After host creation, bootstrap SHALL register `SIGINT` and `SIGTERM` handlers that stop workflow cleanup and archive digest scheduling, close all worker hosts, and exit process with code `0`.

Bootstrap SHALL call `FlowManager.startRecoveryInBackground()`, `WorkflowCleanupService.start()`, and `ArchiveDigestScheduler.start()` before logging `Worker hosts initialized and running.`. Archive digest scheduling SHALL follow `user-archive-system.spec.md` and SHALL NOT block HTTP startup on its first pass.

## 3. PointGuard

`PointGuard(key, capacity, rate)` SHALL store:

1. Redis client `redisClient`.
2. Redis hash key `point_guard:{key}`.
3. Maximum token capacity `capacity`.
4. Regeneration rate `rate` in tokens per second.

`getRegenerationInterval()` SHALL return `(1 / rate) * 1000`.

`consume(cost=1)` SHALL execute one Redis Lua script:

1. Read hash fields `tokens` and `last_updated`.
2. If no token state exists, initialize `tokens=capacity` and `last_updated=now`.
3. Compute `delta = max(0, now - last_updated)`.
4. Compute `refill = (delta / 1000) * rate`.
5. Compute `tokens = min(capacity, tokens + refill)`.
6. If `tokens >= cost`, subtract `cost`, write `tokens` and `last_updated`, and return true.
7. If `tokens < cost`, return false without writing updated token state.

No TTL is set on the PointGuard Redis hash.

## 4. Task Processor

`TaskProcessor.registerHandler(handler)` SHALL store the handler by exact `handler.taskType`.

`TaskProcessor.process(job)` SHALL:

1. Read task data from `job.data`.
2. Update job progress to `Fetching handler`.
3. Resolve handler key as `{task.type}:{task.payload.target}` when `task.payload.target` is truthy; otherwise use `task.type`.
4. If no handler exists for the key, throw `UnrecoverableError('No handler registered for task type: {key}')`.
5. If `task.workflowId` exists, override `job.getChildrenValues` to return `WorkflowRuntimeStore.getFatherResults(task)`.
6. Update job progress to `Sending to handler`.
7. Call `handler.handle(task, job)`.
8. If the handler throws `UnrecoverableError`, normalize its reason and throw a new `UnrecoverableError(reason)`.
9. If the handler throws any other error, normalize its reason and throw `Error(reason)`.
10. Return `{ __result: result, __name: job.name }`.

## 5. Worker Host Construction

`new WorkerHost(queueName, processor, pointGuard, options?)` SHALL create:

1. One BullMQ `Worker` for `queueName`.
2. One BullMQ `QueueEvents` for `queueName`.

Worker and QueueEvents Redis connection SHALL use `config.redis.host`, `config.redis.port`, `config.redis.password`, and BullMQ `prefix=config.redis.keyPrefix`.

Default worker options before merging `options` are:

1. `concurrency=5`.
2. `limiter.max=100`.
3. `limiter.duration=1000`.

Passed `options` SHALL override these defaults.

## 6. Worker Host Job Handling

If `pointGuard` is absent, `handleJob` SHALL call `processor.process(job)` directly.

If `pointGuard` exists:

1. Call `pointGuard.consume(1)`.
2. If it returns true, call `processor.process(job)`.
3. If it returns false, compute `jitterDelay = pointGuard.getRegenerationInterval() + floor(random() * 4000)`.
4. Move the job to delayed state at `Date.now() + jitterDelay`.
5. Do not pause the worker or the queue.
6. Throw `DelayedError`.

## 7. Worker Events

On `completed`:

1. If `shouldEmitTaskEvent(job)` is true, emit `task:{job.id}:completed` to room `task:{job.id}` with `{ status: 'completed', result }`.
2. `result` SHALL be sanitized by replacing `data.embedding` with `[]` and adding `embeddingLength` when the result shape contains `data.embedding`.
3. If `job.data.workflowId` exists, call `FlowManager.handleWorkflowJobCompleted(job, returnvalue)`.
4. Otherwise call `TaskService.updateTask(job.id, COMPLETED, 'Task completed successfully')`.

On `failed`:

1. Compute `isFinalAttempt = job && job.attemptsMade >= (job.opts.attempts || 1)`.
2. Compute `isUnrecoverable = err instanceof UnrecoverableError`.
3. If neither condition is true, log retry information and do not update task status.
4. If either condition is true, normalize the error reason.
5. If `shouldEmitTaskEvent(job)` is true, emit `task:{job.id}:failed` to room `task:{job.id}` with `{ status: 'failed', error: reason }`.
6. If `job.data.workflowId` exists, call `FlowManager.handleWorkflowJobFailed(job, reason)`.
7. Otherwise call `TaskService.updateTask(job.id, FAILED, reason)`.

On `active`, update task status to `PROCESSING` with info `Task is now active`.

On `progress`, update task status to `PROCESSING` with info equal to the progress value cast as string.

On worker `error`, log the error.

On QueueEvents `delayed`, log the delay.

On QueueEvents `waiting`, log the queued job ID.

`shouldEmitTaskEvent(job)` SHALL return true for non-workflow jobs. For workflow jobs it SHALL return true only when `job.data.report === true`.

`FlowManager` SHALL retain workflow SQL completion/result/status synchronization and restart recovery. It SHALL use `WorkflowScheduler` for descendant readiness and release and recovery-ready task dispatch, and `WorkflowRuntimeStore` for runtime reconstruction and result persistence. Task processors SHALL use `WorkflowRuntimeStore` for upstream result loading. Worker hosts SHALL NOT perform workflow scheduling or access runtime Redis keys directly.

## 8. Common Worker Helpers

`shouldSkip(childrenValues)` SHALL return true when any direct child value is truthy and has `skipNextStep` truthy. Otherwise it SHALL return false.

`extractUpsteamData(childrenValues, predicate, jobId?)` SHALL iterate child keys in `Object.keys(childrenValues)` order and return the first `upstreamData.data` for which `predicate(upstreamData.data)` is true. It SHALL return `null` when no match exists.

## 9. Generic Concurrency Helper

`runWithConcurrency(items, concurrency, worker)` SHALL:

1. Compute `workerCount = min(max(1, floor(concurrency)), items.length)`.
2. Run at most `workerCount` async runners.
3. Each runner SHALL claim the next array index by incrementing a shared cursor.
4. Each claimed item SHALL call `worker(item, index)`.
5. The returned promise SHALL resolve only after all runners resolve.
6. If `items.length === 0`, no runners are created and the returned promise resolves.

## 10. File Locations

- Worker bootstrap: `packages/backend/src/workers/index.ts`
- Worker host: `packages/backend/src/workers/worker-host.ts`
- Task processor: `packages/backend/src/workers/task-processor.ts`
- Workflow event and recovery manager: `packages/backend/src/workers/flow-manager.ts`
- Workflow scheduler: `packages/backend/src/services/workflow-scheduler.service.ts`
- Workflow runtime store: `packages/backend/src/services/helpers/workflow-runtime-store.helper.ts`
- PointGuard: `packages/backend/src/lib/point-guard.ts`
- Common helpers: `packages/backend/src/workers/helpers/common.helper.ts`
- Concurrency helper: `packages/backend/src/utils/concurrency.ts`
