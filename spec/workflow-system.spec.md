# Workflow System Specification

## 1. Scope

This specification defines backend workflow orchestration behavior implemented under `packages/backend`.

A workflow definition is a logical DAG of task definitions. The backend stores every workflow node as a `task` row and executes ready nodes as independent BullMQ jobs. The backend, not BullMQ Flow, owns DAG scheduling.

The `fathers` field defines task readiness and upstream data visibility. A task is ready when every named father task has completed successfully.

Redis stores workflow runtime keys for dispatch acceleration. The database is the durable source of truth. For every non-terminal workflow, the backend MUST be able to reconstruct Redis runtime keys from `workflow` and `task` rows after a process restart.

## 2. Workflow Entity

Table name: `workflow`

| Column        | Type     | Constraints       | Description                                                  |
| ------------- | -------- | ----------------- | ------------------------------------------------------------ |
| `id`          | UUID     | PRIMARY KEY       | Workflow identifier exposed as `workflowId` in API responses |
| `root_job_id` | VARCHAR  | NULLABLE          | Legacy BullMQ Flow root job ID. New DAG workflows set `null` |
| `queue_name`  | VARCHAR  | NULLABLE          | Legacy BullMQ Flow root queue. New DAG workflows set `null`  |
| `status`      | VARCHAR  | DEFAULT `pending` | Last known workflow status                                   |
| `definition`  | JSON     | NOT NULL          | Normalized workflow definition                               |
| `result`      | JSON     | NULLABLE          | Tracked task result map                                      |
| `created_at`  | DATETIME | NOT NULL          | Creation time                                                |
| `updated_at`  | DATETIME | NOT NULL          | Last update time                                             |

The workflow table SHALL define these indexes:

1. `idx_workflow_status_created_at_id` over `(status, created_at, id)`.
2. `idx_workflow_status_updated_at_id` over `(status, updated_at, id)`.

The `workflow_deduplication` table SHALL contain:

1. `key VARCHAR(191)` as its primary key.
2. `workflow_id VARCHAR(36)` as a unique foreign key to `workflow.id` with `ON DELETE CASCADE`.
3. `created_at` and `updated_at` timestamps.

## 3. Workflow Definition

The API accepts exactly this JSON shape:

```json
{
    "tasks": [
        {
            "name": "save",
            "track": true,
            "report": true,
            "fathers": [],
            "data": {
                "type": "save",
                "payload": {}
            }
        }
    ]
}
```

Validation rules enforced by `validateFlowStructure`:

1. The workflow definition MUST be an object and MUST NOT be an array.
2. `tasks` MUST be a non-empty array.
3. Each task MUST have `name` as a truthy string. A whitespace-only string is accepted because no trim check is performed.
4. Each task name MUST be unique by exact string equality.
5. If `report` is present on a task, it MUST be a boolean.
6. If `fathers` is present, it MUST be an array.
7. Every father entry MUST exactly match one task name in the same `tasks` array.
8. The logical graph defined by `fathers` MUST be acyclic.

Validation rules not enforced by `validateFlowStructure`:

1. `track` is not type-checked.
2. `data` is not checked for presence or object type.
3. `data.type` is not checked against the task type enum.
4. `data.payload` is not checked for presence or object type.
5. `data.payload.target` is not checked for presence or string type.

Runtime semantics:

1. `track = true` means the task completion payload is written into `workflow.result[taskName]`.
2. `report = true` means the task emits websocket completion/failure events for clients that join `task:{taskId}`.
3. `track` and `report` are independent. A task MAY be tracked but not reported, or reported but not tracked.

## 4. API Endpoints

### 4.1 POST `/workflow/create`

Permission requirement: `CREATE_WORKFLOW`.

Input: normalized workflow definition object as specified in section 3.

If workflow creation throws, including validation errors, the HTTP endpoint catches the error and returns code `500` through `ctx.fail`.

Output:

```json
{
    "workflowId": "<uuid>",
    "taskIds": {
        "<taskName>": "<16_char_task_id>"
    },
    "reportTaskIds": {
        "<reportTaskName>": "<16_char_task_id>"
    },
    "trackTaskIds": {
        "<trackTaskName>": "<16_char_task_id>"
    },
    "deduplicated": false
}
```

Postconditions:

1. A `workflow` row is created with `id = workflowId`, `status = 'active'`, `root_job_id = null`, and `queue_name = null`.
2. `workflow.definition` stores the accepted workflow definition.
3. `workflow.result` contains one key for every task with `track = true`; every initial value is `null`.
4. For every item in `tasks`, one `task` row is created before any BullMQ job is added.
5. Each workflow task row has `workflow_id = workflowId`, `task_name = task.name`, `type = task.data.type`, `payload = task.data.payload`, `status = PENDING`, and `priority` equal to the workflow creation option `priority`.
6. Each task ID in `taskIds` is a 16-character random string.
7. Each BullMQ job ID equals the corresponding `task.id`.
8. The backend initializes Redis runtime state for every workflow task before adding entrypoint jobs.
9. A task with no fathers is an entrypoint task.
10. Only entrypoint tasks are added to BullMQ during workflow creation.
11. Each added BullMQ job name equals the workflow task name.
12. Each added BullMQ job stores complete task execution data: `id`, `type`, `payload`, `workflowId`, `taskName`, `track`, `report`, `fathers`, and `fatherIds`.
13. Each added BullMQ job SHALL set `priority` equal to the workflow creation option `priority`.
14. If the workflow is created from an HTTP workflow API endpoint, the creation option `priority` SHALL be `1`.
15. `reportTaskIds` contains exactly the task-name subset whose task definition has `report = true`.
16. `trackTaskIds` contains exactly the task-name subset whose task definition has `track = true`.
17. If workflow creation fails before the API response is sent, no `workflow` row with `id = workflowId` and no `task` rows with `workflow_id = workflowId` remain in the database.

### 4.2 POST `/workflow/create/template/:name`

Input: template parameter object.

Permission model:

1. The template name must exist in `WORKFLOW_TEMPLATES_PERMISSION`.
2. If mapped permission is `null`, the endpoint is public and does not require login.
3. If mapped permission is non-null, requester must be authenticated and satisfy the mapped permission bit.

Output format is identical to section 4.1.

Workflows created by this endpoint SHALL use creation option `priority = 1`.

For BullMQ priorities, a smaller positive integer is higher priority than a larger positive integer.

### 4.3 GET `/workflow/query/:id`

Input path parameter: workflow UUID.

Output:

```json
{
    "workflowId": "<uuid>",
    "status": "pending|active|completed|failed|expired|...",
    "createdAt": "<datetime>",
    "updatedAt": "<datetime>",
    "tasks": [
        {
            "taskId": "<task_id>",
            "taskName": "<task_name>",
            "status": "pending|processing|completed|failed|missing",
            "type": "<task_type>",
            "target": "<task_target>",
            "fathers": ["<father_task_name>"],
            "fatherIds": {
                "<father_task_name>": "<father_task_id>"
            },
            "track": true,
            "report": false,
            "info": "<task_status_info>"
        }
    ],
    "result": {
        "<trackedTaskName>": {
            "name": "<result_name>",
            "result": "<result_payload>"
        }
    }
}
```

The query endpoint reads workflow and task state from the database. Missing Redis runtime keys MUST NOT make the query endpoint return `expired`.
For tracked task entries that are not finished yet, `result[taskName]` is `null`.
For every returned task, `fathers` equals the task definition `fathers` array or `[]` when omitted.
For every returned task, `fatherIds` maps each father task name to the corresponding SQL task ID when that task row exists.
For every returned task, `type`, `target`, `track`, and `report` are read from the workflow definition, not from Redis runtime state.
For every returned task with `status = "failed"`, `info` is normalized by `task-queue.spec.md` failure reason normalization and has length at most 80 characters.

## 5. Template Definitions

### 5.1 `article-save-pipeline`

Required input: `targetId`. Optional input: `forceUpdate`, which is `true` only when the input value
is exactly boolean `true`, and `false` for every other value including its absence.

Task graph by logical dependency:

1. `save` (tracked, reported)
2. `save-comment` depends on `save`
3. `summary` depends on `save` (tracked)
4. `censor` depends on `save` (tracked)
5. `embedding` depends on `save` and `summary`
6. `update-embedding` depends on `embedding`
7. `update-summary` depends on `summary`
8. `update-censor` depends on `censor`
9. `update-search-index` depends on `update-summary`

Permission: public (`null` permission mapping).

Task `embedding` SHALL have type `llm`, target `embedding`, and metadata `{ "mode": "article_index" }`.
Task `embedding` SHALL read `save.data.text` and `summary.data.text` from its direct fathers.
Task `embedding` SHALL generate one summary embedding record and zero or more chunk embedding records.
Task `embedding` SHALL issue upstream embedding requests sequentially. It SHALL NOT request multiple chunk embeddings concurrently inside one task execution.
Task `embedding` SHALL return `data.embeddingRecords` where each item contains `kind`, `document`, and `embedding`, and chunk items also contain `chunkIndex`, `start`, and `end`.
Task `update-embedding` SHALL read upstream `embedding.data.embeddingRecords` and write vectors to the embedding store.
Task `update-embedding` SHALL NOT call any LLM provider.
Task `update-embedding` SHALL NOT depend on `update-summary`.

Task `save` has metadata `{ "forceUpdate": <the normalized input value> }`, which
`ArticleService.saveLuoguArticle` reads to decide whether an unchanged content hash still writes the
row.

Task `update-search-index` has `track=true` and `report=true` so clients can observe final search indexing success or failure.

### 5.2 `paste-save-pipeline`

Required input: `targetId`. Optional input: `forceUpdate`, normalized exactly as in section 5.1.

Task graph by logical dependency:

1. `save` (tracked, reported)
2. `censor` depends on `save` (tracked)
3. `update-censor` depends on `censor`

Permission: public (`null` permission mapping).

Task `save` has type `save`, target `paste`, targetId equal to the input `targetId`, and metadata
`{ "forceUpdate": <the normalized input value> }`, which `PasteService.saveLuoguPaste` reads to
decide whether an unchanged content hash still writes the row.
Task `censor` has type `llm`, target `censor`, and empty metadata.
Task `update-censor` has type `update`, target `censor`, targetId equal to the input `targetId`, and metadata `{ "censorTarget": "paste" }`.

The template SHALL NOT contain a `summary` task.
The template SHALL NOT contain an `embedding` task.
The template SHALL NOT contain an `update-search-index` task.

### 5.3 `article-censor-pipeline`

Required input: `targetId`.

Task graph:

1. `read-article` (tracked)
2. `censor` depends on `read-article` (tracked, reported)
3. `update-censor` depends on `censor`

Permission: `CREATE_WORKFLOW`.

### 5.4 `search-reindex-pipeline`

Input parameter:

| Parameter   | Type   | Required | Default | Constraint            |
| ----------- | ------ | -------- | ------- | --------------------- |
| `batchSize` | number | no       | 100     | Integer in `[1, 500]` |

Task graph:

1. `reindex-search` (tracked, reported)

Task `reindex-search` has type `update`, target `search_reindex`, targetId `articles`, and metadata field `batchSize` equal to the normalized input value.

Permission: `MANAGE_SEARCH`.

### 5.5 `article-summary-rebuild-pipeline`

Input parameters:

| Parameter     | Type   | Required | Default | Constraint            |
| ------------- | ------ | -------- | ------- | --------------------- |
| `batchSize`   | number | no       | 20      | Integer in `[1, 100]` |
| `concurrency` | number | no       | 5       | Integer in `[1, 20]`  |

Task graph:

1. `rebuild-summary` (tracked, reported)

Task `rebuild-summary` has type `update`, target `article_summary_rebuild`, targetId `articles`, metadata field `batchSize` equal to the normalized `batchSize`, and metadata field `concurrency` equal to the normalized `concurrency`.

Permission: `MANAGE_SEARCH`.

### 5.6 `article-embedding-rebuild-pipeline`

Input parameters:

| Parameter     | Type   | Required | Default | Constraint            |
| ------------- | ------ | -------- | ------- | --------------------- |
| `batchSize`   | number | no       | 20      | Integer in `[1, 100]` |
| `concurrency` | number | no       | 5       | Integer in `[1, 50]`  |

Task graph:

1. `rebuild-embedding` (tracked, reported)

Task `rebuild-embedding` has type `update`, target `article_embedding_rebuild`, targetId `articles`, metadata field `batchSize` equal to the normalized `batchSize`, and metadata field `concurrency` equal to the normalized `concurrency`.

Permission: `MANAGE_SEARCH`.

### 5.7 `rag-search-pipeline`

Input parameters:

| Parameter     | Type   | Required | Default | Constraint                 |
| ------------- | ------ | -------- | ------- | -------------------------- |
| `query`       | string | yes      | absent  | Trimmed non-empty text     |
| `limit`       | number | no       | 100     | Integer in `[1, 100]`      |
| `maxArticles` | number | no       | 10      | Integer in `[1, 10]`       |
| `maxChars`    | number | no       | 20000   | Integer in `[1000, 20000]` |
| `articleIds`  | array  | no       | `[]`    | At most 10 article IDs     |

Task graph:

1. `read-query` (read text from workflow parameters)
2. `plan-queries` depends on `read-query`
3. For each index `i` in `[0, 4]`, `read-planned-query-i` depends on `plan-queries`
4. For each index `i` in `[0, 4]`, `keyword-search-i` depends on `read-planned-query-i`
5. For each index `i` in `[0, 4]`, `query-embedding-i` depends on `read-planned-query-i`
6. For each index `i` in `[0, 4]`, `vector-search-i` depends on `query-embedding-i`
7. `build-context` depends on `read-query`, every `keyword-search-i`, and every `vector-search-i`
8. `answer` depends on `build-context` (tracked, reported)

Reported progress tasks:

1. `plan-queries` SHALL be tracked and reported.
2. Every `keyword-search-i` SHALL be tracked and reported.
3. Every `query-embedding-i` SHALL be tracked and reported.
4. Every `vector-search-i` SHALL be tracked and reported.
5. `build-context` SHALL be tracked and reported.
6. `answer` SHALL be tracked and reported.

For websocket completed events, reported embedding task payloads SHALL NOT include the full embedding vector. They SHALL include `embeddingLength`.

Task `plan-queries` has type `rag` and target `plan_queries`.

Task `plan-queries` SHALL:

1. Read the original question from `read-query.data.text`.
2. Ask the chat LLM scenario for alternative retrieval texts.
3. Return `data.queries` as an array of strings.
4. Set `data.queries[0]` exactly equal to the original question text.
5. Remove empty strings and duplicate strings after trimming.
6. Return at most 5 queries.
7. If the LLM call fails or returns invalid JSON, return exactly `[original question text]`.
8. Generated strings MAY be long natural-language retrieval texts and SHALL NOT be restricted to short keywords.

Each `read-planned-query-i` task SHALL:

1. Have type `read` and target `planned_query`.
2. Read `plan-queries.data.queries[i]`.
3. Return `skipNextStep=true` and `data.text=''` if no query exists at index `i`.
4. Return `skipNextStep=false` and `data.text=<query>` if a query exists at index `i`.

For every `read-planned-query-i` where `skipNextStep=false`, both `keyword-search-i` and `query-embedding-i` SHALL run over that exact query text, and `vector-search-i` SHALL run over the resulting embedding.

Task `build-context` SHALL receive up to 100 keyword candidates and up to 100 vector candidates per planned query.

Task `build-context` SHALL rerank merged candidates when the LLM rerank scenario is configured.

Task `build-context` SHALL include at most `maxArticles` documents and at most `maxChars` characters in `data.text`.

If `articleIds` contains article IDs:

1. The template SHALL pass at most the first 10 unique non-empty article IDs to `build-context.metadata.articleIds`.
2. Task `build-context` SHALL load non-deleted articles matching `metadata.articleIds` before adding retrieval hits.
3. Forced articles from `metadata.articleIds` SHALL appear before retrieved articles in `data.documents`, preserving the `articleIds` order.
4. Forced articles SHALL count toward `maxArticles` and `maxChars`.
5. If a forced article is missing or deleted, `build-context` SHALL skip it.
6. Retrieved articles whose IDs are already included by forced articles SHALL NOT be duplicated.
7. If forced articles alone exceed `maxChars`, `build-context` SHALL include only the prefix of forced articles that fits in `maxChars`.

Task `answer` SHALL ask the LLM to:

1. Answer in Chinese.
2. Use Markdown.
3. Use `$formula$` for every inline mathematical formula.
4. Use `$$formula$$` for every display mathematical formula.
5. Not use `\(...\)` or `\[...\]` math delimiters.
6. Not write prefatory disclaimers such as `下面根据已有材料` or `需要说明`.
7. Not invite the user to ask follow-up questions.
8. If no answer can be determined from the documents or tool results, output exactly `现有材料无法确定。`.

Task `answer` SHALL use the `answer` LLM scenario.

Task `answer` SHALL allow the LLM to call tools before final answer generation.

Tool call behavior:

1. The handler SHALL provide a `keyword_search` tool.
2. `keyword_search` input schema SHALL be `{ "query": string, "limit"?: integer }`.
3. `keyword_search.limit` SHALL be normalized to an integer in `[1, 5]`, default `5`.
4. `keyword_search` SHALL search article title, summary, content, author name, and tags using the article search index.
5. `keyword_search` result payload SHALL include at most `limit` article summaries and SHALL NOT include full article content.
6. The handler SHALL provide a `read_article` tool.
7. `read_article` input schema SHALL be `{ "id": string, "maxChars"?: integer }`.
8. `read_article.maxChars` SHALL be normalized to an integer in `[500, 3000]`, default `1800`.
9. `read_article` result payload SHALL include one article title, ID, author name, summary, tags, category, and a content prefix of at most `maxChars` characters.
10. Tool execution SHALL run for at most 4 LLM tool-call rounds.
11. Across those rounds, the handler SHALL execute at most 8 tool calls.
12. If the tool-call round limit is reached while the model still requests tools, the handler SHALL make one final `answer` scenario LLM call without tools.
13. The final answer SHALL be based only on initial context documents and executed tool results.
14. The final answer SHALL NOT expose chain-of-thought text. It SHALL contain only the answer content.

Permission: `CREATE_WORKFLOW`.

LLM task handlers SHALL consume upstream `data.text` only. LLM task handlers SHALL NOT read external source objects by `sourceId`.

Read task handlers SHALL be the only task handlers that load article or paste content from persistent storage for workflow data flow.

## 6. Status, Result, and Report Synchronization

1. Each workflow job updates the `task` row whose `id` equals the BullMQ job ID.
2. Only report tasks emit websocket events `task:{taskId}:completed` and `task:{taskId}:failed`.
3. A report task completed event payload SHALL contain `status='completed'` and `result=returnvalue.__result`.
4. A report task failed event payload SHALL contain `status='failed'` and `error`.
5. A report task failed event `error` SHALL be normalized by `task-queue.spec.md` failure reason normalization and have length at most 80 characters.
6. Non-report workflow tasks do not emit `task:{taskId}` websocket events.
7. Legacy non-workflow tasks emit websocket task events for every completed or failed task.
8. When a workflow task completes successfully, its `task.result` stores the full processor return value.
9. When a workflow task completes successfully, its direct descendant counters are released exactly once.
10. A descendant task is added to BullMQ when every father task has `status = COMPLETED` and the descendant task status is neither `COMPLETED` nor `FAILED`.
11. Workflow completion status is set to `completed` when every task row with `workflow_id = workflowId` has `status = COMPLETED`.
12. Workflow failure status is set to `failed` when any workflow task reaches final failure.
13. After workflow status becomes `failed`, no new descendant tasks for that workflow SHALL be added by workflow scheduling code.
14. For tracked tasks (`track = true`), when a job includes `workflowId` and `taskName`, its return payload is merged into `workflow.result[taskName]`.
15. Result payload is normalized as:

```json
{
    "name": "<returnvalue.__name>",
    "result": "<returnvalue.__result>"
}
```

16. Status writes are monotonic with respect to terminal states.
17. If current `workflow.status` is `completed`, `failed`, or `expired`, later queue status reads, worker events, recovery passes, or queue events MUST NOT replace it.
18. If current `workflow.status` is not terminal, worker events or recovery passes MAY replace it with `active`, `completed`, or `failed`.

## 7. Runtime Redis Keys

For each workflow task ID `taskId`, the scheduler MAY create these Redis keys:

1. `workflow:task:def:{taskId}` stores the complete BullMQ job data and priority for the task.
2. `workflow:task:counter:{taskId}` stores the number of incomplete father tasks.
3. `workflow:task:descendants:{taskId}` stores an array of direct descendant task IDs.
4. `workflow:task:result:{taskId}` stores `returnvalue.__result` after successful completion.
5. `workflow:task:released:{taskId}` stores a marker that descendant counters were released for `taskId`.

Runtime keys for active workflows SHALL NOT require a fixed expiration time. Runtime keys SHALL be deleted after the workflow reaches a terminal status. The scheduled workflow cleanup pass SHALL also delete runtime keys for terminal workflows before deleting SQL rows.

## 8. Restart Recovery

On worker startup, the backend SHALL start workflow recovery in the background. HTTP server startup SHALL NOT wait for recovery to complete.

The recovery process SHALL run in batches:

1. Each batch SHALL load at most `config.workflow.recovery.batchSize` workflows whose status is `pending` or `active`.
2. At most `config.workflow.recovery.concurrency` workflows SHALL be recovered concurrently.
3. If another recovery pass is already running, a new recovery pass SHALL NOT start.
4. If `config.workflow.recovery.enabled = false`, startup recovery SHALL NOT run.

For each workflow selected by recovery:

1. Load every task row with `workflow_id = workflow.id`.
2. Rebuild Redis runtime keys from `workflow.definition`, task rows, task statuses, task results, and task priorities.
3. For each completed task row with a stored result, restore `workflow:task:result:{taskId}`.
4. For each completed task row, create `workflow:task:released:{taskId}` because rebuilt counters already exclude completed fathers.
5. If any workflow task row has `status = FAILED`, set the workflow status to `failed`.
6. If every workflow task row has `status = COMPLETED`, set the workflow status to `completed`.
7. For every non-terminal task whose BullMQ job exists and is `completed`, store its return value, mark the task `COMPLETED`, update tracked workflow result when applicable, and release descendants.
8. For every non-terminal task whose BullMQ job exists and is `failed`, mark the task `FAILED` and set the workflow status to `failed`.
9. For every task whose fathers are all completed, whose task row is not terminal, and whose BullMQ job is missing, add the task to BullMQ with `jobId = task.id`.
10. For every task whose BullMQ job already exists in `waiting`, `delayed`, `prioritized`, or `active`, recovery MUST NOT add a duplicate job.
11. If recovery for one workflow throws an error, set that workflow status to `failed` and continue recovery for the remaining workflows.

Recovery is idempotent. Running recovery more than once without new task completions MUST NOT enqueue more than one BullMQ job for the same task ID.

## 9. SQL and Redis Cleanup

The backend SHALL run a scheduled workflow cleanup pass when `config.workflow.cleanup.enabled = true`.

Each cleanup pass SHALL:

1. Select at most `config.workflow.cleanup.batchSize` workflows where `status IN ('completed', 'failed', 'expired')` and `updated_at < now - config.workflow.cleanup.terminalRetentionMs`.
2. For each selected workflow, load task IDs where `task.workflow_id = workflow.id`.
3. Delete Redis runtime keys for those task IDs.
4. Delete SQL task rows where `task.workflow_id = workflow.id`.
5. Delete the SQL workflow row.
6. Delete at most `config.workflow.cleanup.batchSize` non-workflow task rows where `workflow_id IS NULL`, `status IN (COMPLETED, FAILED)`, and `updated_at < now - config.workflow.cleanup.legacyTaskRetentionMs`.

Cleanup SHALL NOT delete non-terminal workflow rows. Cleanup SHALL NOT delete workflow task rows independently of their owning workflow row.

If one workflow cleanup fails, the cleanup pass SHALL log the error and continue with remaining selected workflows.

### 9.1 Workflow Deduplication

When workflow creation receives a non-empty deduplication key:

1. Workflow row creation, task row creation, and deduplication-row insertion SHALL execute in one transaction.
2. If the key does not exist, the new deduplication row SHALL reference the new workflow.
3. If the key already exists, the new workflow transaction SHALL roll back and workflow creation SHALL return the existing workflow descriptor with `deduplicated=true`.
4. An article save template SHALL use key `article-save:${targetId}`.
5. A paste save template SHALL use key `paste-save:${targetId}`.
6. When a workflow reaches `completed`, `failed`, or `expired`, its deduplication row SHALL be deleted.
7. Deleting a workflow row SHALL delete its deduplication row through the foreign key.
8. A deduplicated caller SHALL receive the existing `workflowId`, `taskIds`, `reportTaskIds`, and `trackTaskIds`.
9. A newly created descriptor SHALL contain `deduplicated=false`; an existing descriptor SHALL contain `deduplicated=true`.

## 10. Debug Logging

The backend SHALL write structured workflow logs that allow one workflow run to be reconstructed from log records:

1. Workflow creation logs SHALL include `workflowId`, `priority`, `taskCount`, `entryPointIds`, `reportTaskIds`, and `trackTaskIds`.
2. Runtime initialization logs SHALL include one entry per task with `workflowId`, `taskId`, `taskName`, `type`, `queueName`, `fathers`, `fatherIds`, `descendantIds`, `incompleteFatherCount`, `track`, `report`, and `priority`.
3. Task dispatch logs SHALL include `workflowId`, `taskId`, `taskName`, `type`, `queueName`, `priority`, and `reason`.
4. Upstream data loading logs SHALL include `workflowId`, `taskId`, `taskName`, `fatherNames`, `redisHitCount`, `dbHitCount`, and `missingFatherNames`.
5. Task completion logs SHALL include `workflowId`, `taskId`, `taskName`, `track`, `report`, `changed`, and `resultKeys`.
6. Descendant release logs SHALL include `workflowId`, `taskId`, `taskName`, `descendantIds`, each descendant counter value after decrement, and `dispatchedTaskIds`.
7. Workflow recovery logs SHALL include `workflowId`, `taskCount`, `pendingCount`, `processingCount`, `completedCount`, `failedCount`, and every recovered BullMQ job state that changes task or workflow state.
8. Workflow query logs SHALL include `workflowId`, `status`, `taskCount`, and counts by task status.
9. Debug logs SHALL NOT include full workflow result payloads, full embeddings, article bodies, paste bodies, or LLM prompt text.

## 11. Invariants

1. `workflowId` is the only workflow identifier accepted by `/workflow/query/:id`.
2. Every value in `taskIds` is both a `task.id` and a BullMQ job ID.
3. `reportTaskIds` contains exactly the task-name subset whose task definition has `report = true`.
4. `trackTaskIds` contains exactly the task-name subset whose task definition has `track = true`.
5. Template permission lookup is exact-key based; missing keys are rejected as invalid templates.
