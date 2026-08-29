# Task Queue System Specification

## 1. Overview

The task queue system manages asynchronous background jobs using BullMQ backed by Redis. It supports different task types with dedicated handlers and provides task status tracking.

## 2. Task Entity

### 2.1 Schema

Table name: `task`

| Column        | Type        | Constraints | Description                                  |
| ------------- | ----------- | ----------- | -------------------------------------------- |
| `id`          | VARCHAR(32) | PRIMARY KEY | Unique task ID (8-char random)               |
| `info`        | TEXT        | NULLABLE    | Task result/error information                |
| `status`      | INT         | DEFAULT 0   | Task status (TaskStatus enum)                |
| `created_at`  | DATETIME    | NOT NULL    | Task creation timestamp                      |
| `updated_at`  | DATETIME    | NOT NULL    | Task last update timestamp                   |
| `type`        | VARCHAR     | NOT NULL    | Task type (TaskType enum)                    |
| `target`      | VARCHAR     | NULLABLE    | Target identifier (e.g., "article", "paste") |
| `payload`     | JSON        | NOT NULL    | Task-specific payload data                   |
| `workflow_id` | UUID        | NULLABLE    | Owning workflow ID for workflow tasks        |
| `task_name`   | VARCHAR     | NULLABLE    | Workflow-local task name                     |
| `priority`    | INT         | NULLABLE    | BullMQ priority used for workflow dispatch   |
| `result`      | JSON        | NULLABLE    | Processor return value for workflow recovery |

The task table SHALL define index `idx_task_workflow_status_updated_at` over
`(workflow_id, status, updated_at)`.

### 2.2 TaskStatus Enum

| Value | Name       | Description                   |
| ----- | ---------- | ----------------------------- |
| 0     | PENDING    | Task created, not yet started |
| 1     | PROCESSING | Task is being processed       |
| 2     | COMPLETED  | Task finished successfully    |
| 3     | FAILED     | Task failed with error        |

### 2.3 TaskType Enum

| Value      | Description                           |
| ---------- | ------------------------------------- |
| `save`     | Save content from Luogu               |
| `llm`      | LLM-based content processing          |
| `update`   | Persistent data update tasks          |
| `search`   | Search backend tasks                  |
| `read`     | Workflow source read tasks            |
| `rag`      | RAG orchestration tasks               |
| `discover` | User article discovery producer tasks |

### 2.4 SaveTarget Enum

| Value       | Description            |
| ----------- | ---------------------- |
| `article`   | Luogu article          |
| `paste`     | Luogu paste            |
| `benben`    | Luogu benben (犇犇)    |
| `judgement` | Judgement record       |
| `profile`   | User profile           |
| `comments`  | Luogu article comments |

## 3. Task Interfaces

### 3.1 CommonTask

```typescript
interface CommonTask {
    id: string;
    type: TaskType;
    workflowId?: string;
    taskName?: string;
    track?: boolean;
    report?: boolean;
    payload: {
        target: string;
        [key: string]: any;
    };
    fathers?: string[];
    fatherIds?: Record<string, string>;
}
```

### 3.2 SaveTask

```typescript
interface SaveTask extends CommonTask {
    type: TaskType.SAVE;
    payload: {
        target: SaveTarget;
        targetId: string;
        metadata: Record<string, any>;
    };
}
```

### 3.3 AiTask

```typescript
interface AiTask extends CommonTask {
    type: TaskType.LLM;
    payload: {
        target: string;
        metadata: Record<string, any>;
    };
}
```

## 4. API Endpoints

### 4.1 POST /task/create

Create and dispatch a new task.

Permission requirement: `CREATE_TASK`.

**Request Body:**

```json
{
    "type": "save" | "llm" | "update" | "search" | "read" | "rag" | "discover",
    "payload": {
        "target": string,
        "targetId": string,
        ...additional fields
    }
}
```

**Validation:**

- `type` must be a valid TaskType value.
- `payload` must be an object.
- `payload.target` must be a string.

**Response:**

- 200: `{ taskId: string }`
- 400: Invalid request body or missing required fields
- 500: Server error

Current validation reads `payload.target` before verifying that `payload` is an object. If `payload` is absent or null, the endpoint may throw and the response helper may return code `500`.

**Side Effects:**

1. Creates a Task record in the database.
2. Dispatches the task to the appropriate BullMQ queue.

### 4.2 GET /task/query/:id

Query task status.

**Request:**

- Path parameter: `id` (string) - Task ID

**Response:**

- 200: Task object
- 404: Task not found
- 500: Server error

## 5. Task Service

### 5.1 createTask(type, payload, target?)

1. Generate an 8-character random string as `task.id`.
2. Set `status` to `PENDING`.
3. Save the task to the database.
4. If the database rejects the insert because `task.id` already exists, retry ID generation and insert up to 5 total attempts.
5. Return the created task.

### 5.2 dispatchTask(taskId)

1. Load the task from the database.
2. If task not found, throw an error.
3. Map `task.type` to a queue using `getQueueByType(task.type)`.
4. If no queue exists for `task.type`, throw an error.
5. Add one BullMQ job whose name equals `task.type`.
6. Use `task.id` as the BullMQ job ID.

### 5.3 updateTask(taskId, status, info?)

1. Update the task record with new `status`.
2. If `info` is provided, update the `info` field.
3. If `status = FAILED`, the persisted `info` SHALL be a normalized failure reason with length at most 80 characters.

### 5.4 getTaskById(taskId)

1. Query the database for the task.
2. If no task exists, return null.
3. If the task exists and `status = FAILED`, return a task object whose `info` is normalized by failure reason normalization.
4. If the task exists and `status != FAILED`, return the task object unchanged.

### 5.5 EntityManager support

1. If a TaskService read/write method receives an optional `manager` argument, it SHALL use that `EntityManager` for database access.
2. If no `manager` is provided, the method SHALL use the default task repository.

### 5.6 Failure reason normalization

Failure reason normalization SHALL:

1. Convert an `Error` input to `error.message` and any other input to `String(input)`.
2. Replace each non-empty whitespace sequence with one ASCII space.
3. Trim leading and trailing whitespace.
4. Use `Unknown error` if the result is empty.
5. Return the result unchanged if its length is at most 80 characters.
6. Return the first 77 characters followed by `...` if its length is greater than 80 characters.

Every task failed websocket payload field `error` SHALL use the normalized failure reason.

## 6. Queue System

### 6.1 Queue Factory

The `getQueueByType(type: TaskType)` function:

1. Map `TaskType` to a queue name using `QUEUE_NAMES` constant.
2. Map `TaskType` to the matching `config.queue` section.
3. If the queue is not in the pool, create a new `TypedQueue` instance with that section's `maxQueueLength`.
4. Return the queue from the pool.

The `getQueueByName(queueName)` function:

1. Map `queueName` back to a `TaskType` using `QUEUE_NAMES`.
2. Map that `TaskType` to the matching `config.queue` section.
3. If `queueName` is not present in `QUEUE_NAMES`, throw an error.
4. If the queue is not in the pool, create a new `TypedQueue` instance with that section's `maxQueueLength`.
5. Return the queue from the pool.

`TypedQueue` construction SHALL receive `maxQueueLength` as an explicit constructor argument.

`TypedQueue.add(name, data, options)` SHALL:

1. Read BullMQ counts for `waiting`, `paused`, `delayed`, `prioritized`, and `waiting-children`.
2. Compute `pendingCount = waiting + paused + delayed + prioritized + waitingChildren`.
3. If `pendingCount >= maxQueueLength`, throw `Queue is full. Please try again later.` without adding a job.
4. If `pendingCount < maxQueueLength`, add the job using BullMQ.
5. The `active`, `completed`, and `failed` states SHALL NOT count toward `maxQueueLength`.

Every BullMQ queue SHALL set default job options:

1. `removeOnComplete = 100`.
2. `removeOnFail = 500`.
3. `attempts = 3`.
4. `backoff.type = 'exponential'`.
5. `backoff.delay = 1000`.

These defaults bound Redis job history for completed and failed jobs.

`WorkflowService.createWorkflow(definition)` SHALL:

1. Compute every BullMQ queue used by the workflow before inserting workflow rows, task rows, or Redis runtime keys.
2. For each used queue, compute the number of jobs the workflow would add to that queue.
3. For each used queue, read BullMQ counts for `waiting`, `paused`, `delayed`, `prioritized`, and `waiting-children`.
4. If `currentPendingCount + workflowJobsForQueue > maxQueueLength` for any used queue, throw `Queue is full. Please try again later.` before inserting workflow rows or task rows.
5. If all used queues have capacity, continue workflow creation and add only entrypoint workflow jobs.

`maxQueueLength` is a per-queue limit. The save queue limit SHALL NOT be used for other queues.

Queue length checks are admission checks. They SHALL prevent a single producer from admitting work when the observed pending count already reaches the configured limit. They are not a cross-producer atomic reservation.

Queue instances are cached in a global pool to prevent multiple connections.

### 6.2 Queue Cleanup

The `closeAllQueues()` function:

1. Close all queues in the pool.
2. Clear the queue pool.

### 6.3 SQL Task Cleanup

The scheduled workflow cleanup pass SHALL delete non-workflow task rows when all conditions are true:

1. `workflow_id IS NULL`.
2. `status IN (COMPLETED, FAILED)`.
3. `updated_at < now - config.workflow.cleanup.legacyTaskRetentionMs`.

Each cleanup pass SHALL delete at most `config.workflow.cleanup.batchSize` non-workflow task rows.
Non-terminal task rows SHALL NOT be deleted by scheduled cleanup.

## 7. Task Processor

### 7.1 Handler Registration

Handlers implement the `TaskHandler<T>` interface:

```typescript
interface TaskHandler<T extends CommonTask> {
    handle(task: T, job: Job<T>): Promise<WorkflowResult<any>>;
    taskType: string; // Format: "{type}" or "{type}:{target}"
}
```

### 7.2 Processing Flow

1. Receive job from BullMQ.
2. Extract task data from `job.data`.
3. Determine handler key: `{type}:{target}` if target exists, else `{type}`.
4. Look up registered handler.
5. If no handler found, throw `UnrecoverableError`.
6. If `job.data.workflowId` is present, override `job.getChildrenValues()` so it returns direct father task results keyed by father task name.
7. Execute `handler.handle(task)`.
8. Return `{ __result, __name }`, where `__result` is the handler result and `__name` is the BullMQ job name.
9. If `handler.handle(task)` throws, rethrow an error whose message is the normalized failure reason.
10. If the thrown error is `UnrecoverableError`, the rethrown error SHALL also be `UnrecoverableError`.

### 7.3 Registered Handlers

| Handler Key                        | Handler Class                        | Description                              |
| ---------------------------------- | ------------------------------------ | ---------------------------------------- |
| `save:article`                     | ArticleHandler                       | Fetch and save Luogu article             |
| `save:paste`                       | PasteHandler                         | Fetch and save Luogu paste               |
| `save:comments`                    | CommentsHandler                      | Fetch and replace Luogu article comments |
| `save:profile`                     | ProfileHandler                       | Fetch and save Luogu user profile        |
| `save:judgement`                   | JudgementHandler                     | Fetch and save Luogu judgement history   |
| `llm:summary`                      | SummaryHandler                       | Generate article summary                 |
| `llm:embedding`                    | EmbeddingHandler                     | Generate embeddings                      |
| `llm:chat`                         | ChatHandler                          | Run chat scenario                        |
| `llm:censor`                       | CensorHandler                        | Run content safety review                |
| `update:article_summary`           | UpdateArticleSummaryHandler          | Persist article summary                  |
| `update:article_summary_rebuild`   | UpdateArticleSummaryRebuildHandler   | Rebuild article summaries                |
| `update:article_embedding`         | UpdateArticleEmbeddingHandler        | Persist article embeddings               |
| `update:article_embedding_rebuild` | UpdateArticleEmbeddingRebuildHandler | Rebuild article embeddings               |
| `update:censor`                    | UpdateCensorResultHandler            | Persist censorship result                |
| `update:search_index`              | UpdateSearchIndexHandler             | Upsert one search document               |
| `update:search_reindex`            | UpdateSearchReindexHandler           | Rebuild search index                     |
| `search:article`                   | ArticleSearchHandler                 | Search articles by keyword               |
| `search:vector`                    | VectorSearchHandler                  | Search articles by vector                |
| `read:text`                        | ReadTextHandler                      | Read literal workflow text               |
| `read:planned_query`               | ReadPlannedQueryHandler              | Read one planned query                   |
| `read:article`                     | ReadArticleHandler                   | Read stored article content              |
| `read:paste`                       | ReadPasteHandler                     | Read stored paste content                |
| `rag:plan_queries`                 | RagPlanQueriesHandler                | Generate retrieval queries               |
| `rag:context`                      | RagContextHandler                    | Build RAG context                        |
| `rag:answer`                       | RagAnswerHandler                     | Generate final RAG answer                |
| `discover:user_articles`           | UserArticlesDiscoveryHandler         | Fetch Luogu user article pages           |

## 8. Configuration

Queue behavior is controlled by `config.queue`:

| Field                  | Description                             |
| ---------------------- | --------------------------------------- |
| `concurrencyLimit`     | Maximum concurrent jobs per worker      |
| `maxRequestToken`      | Token bucket capacity for rate limiting |
| `regenerationSpeed`    | Tokens regenerated per interval         |
| `regenerationInterval` | Token regeneration interval in ms       |
| `maxQueueLength`       | Maximum pending jobs in queue           |

For queues that use `PointGuard` rate limiting, `maxRequestToken` is the token bucket capacity.
`regenerationSpeed` is the number of tokens regenerated per `regenerationInterval` milliseconds.
The runtime regeneration rate SHALL equal `(regenerationSpeed / regenerationInterval) * 1000` tokens per second.

`config.queue` SHALL contain separate sections for `save`, `ai`, `update`, `search`, `read`, `rag`, and `discover`.

The `search` worker SHALL use `config.queue.search.concurrencyLimit`.

The `read` worker SHALL use `config.queue.read.concurrencyLimit`.

The `rag` worker SHALL use `config.queue.rag.concurrencyLimit`.

Queue statistics SHALL report concurrency from the same queue section used by the worker.

## 9. Public Queue Statistics

The queue statistics subsystem exposes read-only queue state without requiring login.

### 9.1 HTTP Endpoint

`GET /stats/queues` SHALL return HTTP 200 with data:

```typescript
interface QueueStatsResponse {
    generatedAt: string;
    queuePoolSize: number;
    queues: QueueStatsItem[];
}

interface QueueStatsItem {
    name: string;
    taskType: 'save' | 'llm' | 'update' | 'search' | 'read' | 'rag' | 'discover';
    label: string;
    concurrency: number;
    isPaused: boolean;
    counts: {
        waiting: number;
        active: number;
        delayed: number;
        completed: number;
        failed: number;
        paused: number;
        prioritized: number;
        waitingChildren: number;
    };
}
```

The `queues` array SHALL contain exactly one item for each queue name in `QUEUE_NAMES`.

The endpoint SHALL NOT include job payloads, job return values, error stack traces, user IDs, article IDs, or workflow IDs.

Queue statistics consumers that display a single pending or waiting total SHALL compute it as:

```text
waiting + paused + prioritized + waitingChildren
```

The raw `counts.waiting` value SHALL mean only BullMQ `waiting` jobs and SHALL NOT include `waitingChildren`, `prioritized`, `paused`, or `delayed`.

Queue statistics consumers that display a single queue status label SHALL NOT use `failed` count as a status condition. Failed job count MAY be displayed as a numeric metric.

### 9.2 WebSocket Room

Room `stats:queues` SHALL publish event `stats:queues:update`.

Each event payload SHALL have the same schema as `GET /stats/queues` response data.

When a client joins `stats:queues`, the server SHALL emit one `stats:queues:update` event to that socket.

While one or more clients are subscribed to `stats:queues`, the server SHALL emit one `stats:queues:update` event to the room every 2 seconds.

When no clients are subscribed to `stats:queues`, the server SHALL stop the periodic queue statistics timer.

## 10. Invariants

1. Each legacy non-workflow task has a unique 8-character ID.
2. Each workflow task has a unique 16-character ID.
3. Task status transitions: PENDING -> PROCESSING -> (COMPLETED | FAILED).
4. Failed tasks are marked with `FAILED` status and error info.
5. Queue names are derived from task types via constant mapping.
6. A duplicate random task ID does not overwrite an existing task row.

## 11. File Locations

- Task entity: `packages/backend/src/entities/task.ts`
- Task types: `packages/backend/src/shared/task.ts`
- Task router: `packages/backend/src/routers/task.router.ts`
- Task service: `packages/backend/src/services/task.service.ts`
- Queue factory: `packages/backend/src/lib/queue-factory.ts`
- Task processor: `packages/backend/src/workers/task-processor.ts`
- Article handler: `packages/backend/src/workers/handlers/task/article.handler.ts`
- Paste handler: `packages/backend/src/workers/handlers/task/paste.handler.ts`
- Judgement handler: `packages/backend/src/workers/handlers/task/save/judgement.handler.ts`
