# Configuration System Specification

## 1. Overview

The configuration system loads and validates application settings from a YAML file at startup. Configuration is immutable after loading.

## 2. Configuration File Discovery

### 2.1 Explicit Path

If the environment variable `CONFIG_PATH` is set, the system SHALL use the resolved absolute path of that value as the configuration file path.

### 2.2 Automatic Discovery

If `CONFIG_PATH` is not set, the system SHALL search for `config.yml` in the following order:

1. `${CWD}/config.yml`
2. `${CWD}/packages/backend/config.yml`
3. `${CWD}/packages/backend/config/config.yml`
4. `${CWD}/config/config.yml`
5. Paths relative to the executing script directory (`process.argv[1]`)
6. Ancestor directories traversed upward from `CWD`

The first existing file found SHALL be used. If no file is found, the system SHALL throw an error listing all searched paths.

## 3. Configuration Schema

The configuration is validated using Zod schemas. Field defaults are applied inside a top-level section after that top-level section exists or is preprocessed as an empty object.

The top-level sections `db`, `redis`, `chroma`, `recommendation`, `llm`, and `verification` are required when a YAML file is parsed. The top-level sections `meilisearch`, `rag`, `queue`, `discovery`, `apiRateLimit`, `workflow`, and `auth` are preprocessed as empty objects when absent.

### 3.1 Server Configuration

| Field                                | Type    | Default                             | Description                                                |
| ------------------------------------ | ------- | ----------------------------------- | ---------------------------------------------------------- |
| `host`                               | string  | "0.0.0.0"                           | HTTP server listening host                                 |
| `port`                               | number  | 3000                                | HTTP server listening port                                 |
| `env`                                | string  | "development"                       | Environment name                                           |
| `network.timeout`                    | number  | 30000                               | Network request timeout in ms                              |
| `network.tor.enabled`                | boolean | false                               | Enable Tor fallback for Luogu 429/network failures         |
| `network.tor.socksProxyUrl`          | string  | `socks5h://127.0.0.1:9050`          | Tor SOCKS proxy URL                                        |
| `network.tor.controlHost`            | string  | `127.0.0.1`                         | Tor control port host                                      |
| `network.tor.controlPort`            | number  | 9051                                | Tor control port                                           |
| `network.tor.controlPassword`        | string  | ""                                  | Original password used to generate `HashedControlPassword` |
| `network.tor.newnymCooldownMs`       | number  | 10000                               | Wait time after `SIGNAL NEWNYM` before reusing Tor         |
| `network.tor.newnymLockTtlMs`        | number  | 30000                               | Redis lock TTL for global Tor exit rotation                |
| `network.tor.native429FallbackTtlMs` | number  | 7200000                             | Duration to skip native Luogu requests after native 429    |
| `network.tor.ipCheckUrl`             | string  | `https://api.ipify.org?format=json` | URL used through Tor to log the current exit IP            |

### 3.2 Database Configuration (`db`)

| Field                     | Type   | Default      | Description                              |
| ------------------------- | ------ | ------------ | ---------------------------------------- |
| `host`                    | string | "localhost"  | MySQL server hostname                    |
| `port`                    | number | 3306         | MySQL server port                        |
| `user`                    | string | "root"       | MySQL username                           |
| `password`                | string | ""           | MySQL password                           |
| `database`                | string | "mydatabase" | MySQL database name                      |
| `connectionLimit`         | number | 10           | Maximum MariaDB connections per backend  |
| `queueLimit`              | number | 0            | Maximum queued acquisitions; 0 unlimited |
| `connectTimeoutMs`        | number | 10000        | Connection establishment timeout         |
| `maxQueryExecutionTimeMs` | number | 1000         | Slow-query logging threshold             |
| `poolMetricsIntervalMs`   | number | 60000        | Connection-pool metrics interval         |

### 3.3 Redis Configuration (`redis`)

| Field       | Type   | Default     | Description               |
| ----------- | ------ | ----------- | ------------------------- |
| `host`      | string | "localhost" | Redis server hostname     |
| `port`      | number | 6379        | Redis server port         |
| `password`  | string | ""          | Redis password            |
| `keyPrefix` | string | ""          | Prefix for all Redis keys |

The direct ioredis client SHALL use `${redis.keyPrefix}:` as its `keyPrefix`, including the case where `redis.keyPrefix` is the empty string. When `redis.keyPrefix` is `""`, a logical Redis key `example` is stored as physical Redis key `:example`.

BullMQ queues and workers SHALL use `redis.keyPrefix` as the BullMQ `prefix` value without appending a colon.

### 3.4 Chroma Configuration (`chroma`)

| Field            | Type    | Default        | Description                   |
| ---------------- | ------- | -------------- | ----------------------------- |
| `enable`         | boolean | false          | Enable Chroma vector database |
| `ssl`            | boolean | false          | Use SSL for Chroma connection |
| `host`           | string  | "127.0.0.1"    | Chroma server hostname        |
| `port`           | number  | 8000           | Chroma server port            |
| `collectionName` | string  | "lgs_articles" | Chroma collection name        |

### 3.4.1 RAG Retrieval Configuration (`rag`)

| Field                   | Type   | Default | Description                               |
| ----------------------- | ------ | ------- | ----------------------------------------- |
| `chunkSize`             | number | 4000    | Article content chunk length in chars     |
| `chunkOverlap`          | number | 300     | Adjacent chunk overlap length in chars    |
| `candidateArticleLimit` | number | 100     | Distinct article candidates before rerank |
| `rawVectorResultLimit`  | number | 500     | Raw Chroma vector hits before folding     |
| `keywordWeight`         | number | 0.25    | Keyword retrieval score weight            |
| `vectorWeight`          | number | 0.35    | Vector retrieval score weight             |
| `rerankWeight`          | number | 0.4     | Rerank score weight                       |

### 3.5 Meilisearch Configuration (`meilisearch`)

| Field              | Type    | Default                 | Description                    |
| ------------------ | ------- | ----------------------- | ------------------------------ |
| `enable`           | boolean | false                   | Enable Meilisearch integration |
| `host`             | string  | "http://127.0.0.1:7700" | Meilisearch server URL         |
| `apiKey`           | string  | ""                      | Meilisearch API key            |
| `articleIndexName` | string  | "lgs_articles"          | Article index name             |

### 3.6 Recommendation Configuration (`recommendation`)

| Field                  | Type   | Default         | Description                                            |
| ---------------------- | ------ | --------------- | ------------------------------------------------------ |
| `anonymous.expireTime` | number | 604800 (7 days) | TTL in seconds for anonymous behavior records in Redis |
| `anonymous.maxCount`   | number | 100             | Maximum behavior records per anonymous device          |
| `maxHistory`           | number | 500             | Maximum history entries for recommendation profiling   |
| `decayFactor`          | number | 0.9             | Decay factor for weighted profile vector calculation   |
| `relevantThreshold`    | number | 0.75            | Minimum string similarity for title-based matching     |

### 3.7 Queue Configuration (`queue`)

`queue` SHALL contain these queue sections: `save`, `ai`, `update`, `search`, `read`, `rag`, and `discover`.

Each queue section SHALL have these fields:

| Field                  | Type   | Description                             |
| ---------------------- | ------ | --------------------------------------- |
| `concurrencyLimit`     | number | Maximum concurrent jobs per worker      |
| `maxRequestToken`      | number | Token bucket capacity for rate limiting |
| `regenerationSpeed`    | number | Tokens regenerated per interval         |
| `regenerationInterval` | number | Token regeneration interval in ms       |
| `maxQueueLength`       | number | Maximum pending jobs in queue           |

Default queue section values SHALL be:

| Section    | `concurrencyLimit` | `maxRequestToken` | `regenerationSpeed` | `regenerationInterval` | `maxQueueLength` |
| ---------- | ------------------ | ----------------- | ------------------- | ---------------------- | ---------------- |
| `save`     | 2                  | 20                | 1                   | 1000                   | 1000             |
| `ai`       | 10                 | 50                | 1                   | 1000                   | 2000             |
| `update`   | 2                  | 20                | 1                   | 1000                   | 1000             |
| `search`   | 2                  | 20                | 1                   | 1000                   | 1000             |
| `read`     | 2                  | 20                | 1                   | 1000                   | 1000             |
| `rag`      | 10                 | 50                | 1                   | 1000                   | 2000             |
| `discover` | 2                  | 20                | 1                   | 1000                   | 1000             |

### 3.7.1 Discovery Configuration (`discovery.articlePlaza`)

| Field               | Type    | Default | Description                                   |
| ------------------- | ------- | ------- | --------------------------------------------- |
| `enabled`           | boolean | true    | Enable the scheduled article plaza scanner    |
| `intervalMs`        | number  | 3600000 | Delay between scheduled scanner checks        |
| `maxPages`          | number  | 50      | Maximum article plaza pages per scheduled run |
| `includeCategories` | boolean | true    | Scan category pages during scheduled runs     |
| `forceUpdate`       | boolean | false   | Force article refresh during scheduled runs   |

### 3.8 API Rate Limit Configuration (`apiRateLimit`)

| Field           | Type    | Default          | Description                                    |
| --------------- | ------- | ---------------- | ---------------------------------------------- |
| `enabled`       | boolean | true             | Enable Redis-backed HTTP API rate limiting     |
| `points`        | number  | 300              | Maximum requests per key per duration window   |
| `duration`      | number  | 60               | Rate limit window length in seconds            |
| `blockDuration` | number  | 60               | Block length in seconds after limit exhaustion |
| `keyPrefix`     | string  | `api_rate_limit` | Redis key prefix for API rate limit counters   |

### 3.8.1 Workflow Maintenance Configuration (`workflow`)

| Field                           | Type    | Default   | Description                                      |
| ------------------------------- | ------- | --------- | ------------------------------------------------ |
| `recovery.enabled`              | boolean | true      | Enable startup workflow recovery                 |
| `recovery.batchSize`            | number  | 100       | Maximum workflows loaded per recovery batch      |
| `recovery.concurrency`          | number  | 2         | Maximum workflows recovered concurrently         |
| `recovery.yieldMs`              | number  | 50        | Delay between recovery batches                   |
| `cleanup.enabled`               | boolean | true      | Enable scheduled workflow/task cleanup           |
| `cleanup.intervalMs`            | number  | 3600000   | Delay between cleanup passes                     |
| `cleanup.terminalRetentionMs`   | number  | 604800000 | Retention for terminal workflows and their tasks |
| `cleanup.legacyTaskRetentionMs` | number  | 604800000 | Retention for non-workflow terminal tasks        |
| `cleanup.batchSize`             | number  | 100       | Maximum workflows or tasks deleted per pass      |
| `cleanup.initialDelayMs`        | number  | 60000     | Delay before the first scheduled cleanup pass    |

Workflow maintenance values SHALL be positive integers except `yieldMs`, which MAY be `0`.

### 3.9 LLM Rerank Scenario

`llm.scenarios.rerank.use` is optional.

If absent or empty, RAG candidate reranking SHALL be skipped.

If present, the configured provider/model SHALL be called with the standard rerank API shape.

### 3.10 LLM Scenario Parameters

| Scenario    | Field         | Default    | Description                         |
| ----------- | ------------- | ---------- | ----------------------------------- |
| `chat`      | `use`         | required   | Default chat provider/model         |
| `chat`      | `temperature` | 0.7        | Default chat sampling temperature   |
| `chat`      | `topP`        | 0.95       | Default chat nucleus sampling value |
| `summary`   | `use`         | required   | Summary provider/model              |
| `summary`   | `temperature` | 0.2        | Summary sampling temperature        |
| `summary`   | `topP`        | 0.9        | Summary nucleus sampling value      |
| `answer`    | `use`         | `chat.use` | RAG final answer provider/model     |
| `answer`    | `temperature` | 0.3        | RAG final answer temperature        |
| `answer`    | `topP`        | 0.9        | RAG final answer top-p              |
| `embedding` | `use`         | required   | Embedding provider/model            |
| `rerank`    | `temperature` | 0          | Rerank request temperature          |
| `rerank`    | `topP`        | 1.0        | Rerank request top-p                |
| `censor`    | `use`         | required   | Content safety provider/model       |

## 4. Loading Behavior

### 4.1 Successful Load

1. Read the YAML file contents.
2. Parse YAML to a JavaScript object.
3. Validate against `AppConfigSchema` using Zod.
4. Return the validated configuration object.

### 4.2 Missing File

If automatic discovery finds no candidate file, the system SHALL throw an error before constructing `ConfigLoader`.

If `CONFIG_PATH` is set and the explicit file does not exist:

- Log a warning message.
- Parse an empty object through `AppConfigSchema`.
- If required top-level sections are absent, schema validation MAY throw before the application starts.

### 4.3 Validation Errors

If schema validation fails:

- Log each validation error with its path and message.
- Terminate the process with `process.exit(1)`.

## 5. Invariants

1. The configuration object is a singleton; `config` is loaded once and reused.
2. All configuration values conform to their schema-defined types.
3. Default values are applied for any missing fields.
4. The system MUST NOT start if the configuration file exists but contains invalid data.

## 6. File Locations

- Entry point: `packages/backend/src/config/index.ts`
- Loader: `packages/backend/src/config/loader.ts`
- Schemas: `packages/backend/src/config/schemas/*.ts`

## 7. Local Infrastructure Compose File

The repository root `docker-compose.yml` is a local infrastructure profile for development and single-host testing.

1. Each service port published by `docker-compose.yml` SHALL bind to host address `127.0.0.1`.
2. The Compose file SHALL NOT publish MariaDB, Redis, Chroma, or Meilisearch on `0.0.0.0` or on an omitted host address.
3. Production deployment documentation SHALL NOT instruct operators to run the repository root `docker-compose.yml` as the production infrastructure plan.
4. Production deployment documentation SHALL require external dependency endpoints to be reachable only from the backend host or from a private network.
5. Production deployment documentation SHALL require non-default secrets for dependency credentials before the backend is started.
