# Database and Infrastructure Specification

## 1. Scope

This specification defines backend database, Redis, cache, repository helper, and shared infrastructure behavior implemented under `packages/backend/src`.

## 2. TypeORM Data Source

The backend SHALL create one TypeORM `DataSource` named `AppDataSource`.

Connection options:

| Option                  | Value                                         |
| ----------------------- | --------------------------------------------- |
| `type`                  | `mariadb`                                     |
| `host`                  | `config.db.host`                              |
| `port`                  | `config.db.port`                              |
| `username`              | `config.db.user`                              |
| `password`              | `config.db.password`                          |
| `database`              | `config.db.database`                          |
| `poolSize`              | `config.db.connectionLimit`                   |
| `maxQueryExecutionTime` | `config.db.maxQueryExecutionTimeMs`           |
| `synchronize`           | `true`                                        |
| `logging`               | `false`                                       |
| `logger`                | `new DatabaseLogger()`                        |
| `entities`              | `path.join(__dirname, '/entities/*.{ts,js}')` |
| `namingStrategy`        | `new SnakeNamingStrategy()`                   |
| `subscribers`           | `[]`                                          |
| `migrations`            | `[]`                                          |

The backend currently uses TypeORM schema synchronization. No tracked migration array is configured in this data source.

The data source does not set the mysql2 `timezone`, `dateStrings`, `supportBigNumbers`, or
`bigNumberStrings` options. Consequences:

1. mysql2 uses `timezone = 'local'`: a `Date` parameter is sent as the Node.js process's local
   wall-clock time, and a `DATETIME` result is parsed as a wall-clock time in the Node.js process's
   local time zone. `CURRENT_TIMESTAMP` writes wall-clock time in the MariaDB session time zone. The
   backend therefore requires the Node.js process UTC offset to equal the MariaDB session UTC offset
   (production: both UTC+8).
2. `BIGINT` and `DECIMAL` results of raw queries (for example `LENGTH(a) + LENGTH(b)`, `SUM()`,
   `TIMESTAMPDIFF()`, and `BIGINT` columns) are returned as strings.
3. `CreateDateColumn` and `UpdateDateColumn` columns are `DATETIME(6)`; a plain `datetime` column
   without precision is `DATETIME(0)`. TypeORM `UpdateQueryBuilder` writes
   `updated_at = CURRENT_TIMESTAMP` (whole seconds) unless the statement assigns `updated_at`.

Peering relies on these rules as specified in `peering-system.spec.md` Section 10.

The MariaDB driver pool SHALL use `config.db.connectionLimit` as its connection limit,
`config.db.queueLimit` as its pending acquisition limit, and `config.db.connectTimeoutMs` as its
connection timeout. The backend SHALL log queries whose execution time exceeds
`config.db.maxQueryExecutionTimeMs`. Slow-query logs SHALL omit query parameters and SHALL truncate
the normalized SQL text to at most 1000 characters.

After data-source initialization, the backend SHALL attach a MariaDB pool monitor. Every
`config.db.poolMetricsIntervalMs`, the monitor SHALL read total, free, and queued connection counts.
If at least one acquisition was queued during the interval, it SHALL emit a warning containing the
pool counts and interval queue count. Otherwise it MAY emit the same fields at debug level. The
monitor SHALL not keep the Node.js process alive.

## 3. Base Entity Transactions

`BaseEntity.transaction(runInTransaction)` SHALL call `this.getRepository().manager.transaction(runInTransaction)` and return the callback result.

## 4. Chroma Data Source

The backend SHALL create one `ChromaClient` named `ChromaDataSource` at module load time.

Client options:

| Option     | Value                |
| ---------- | -------------------- |
| `ssl`      | `config.chroma.ssl`  |
| `host`     | `config.chroma.host` |
| `port`     | `config.chroma.port` |
| `tenant`   | `default_tenant`     |
| `database` | `default_database`   |

The client is constructed even when `config.chroma.enable=false`. Feature services decide whether to read or write Chroma based on `config.chroma.enable`.

## 5. Redis Client

The backend SHALL create one ioredis client named `redisClient`.

Client options:

| Option      | Value                          |
| ----------- | ------------------------------ |
| `host`      | `config.redis.host`            |
| `port`      | `config.redis.port`            |
| `password`  | `config.redis.password`        |
| `keyPrefix` | `config.redis.keyPrefix + ':'` |

When `config.redis.keyPrefix` is the empty string, the effective ioredis key prefix is `:`. A direct Redis write using logical key `example` creates or reads physical key `:example`, not physical key `example`.

The client SHALL log an info message on `connect`.

The client SHALL log an error message with field `err` on `error`.

## 6. Cacheable Decorator

`Cacheable(ttlSeconds, keyGenerator, EntityClass?)` SHALL wrap an async method.

Behavior:

1. If any method argument is an `EntityManager`, call the original method and bypass Redis read and write.
2. Compute `cacheKey = keyGenerator(...args)`.
3. Attempt `redisClient.get(cacheKey)`.
4. If a cached string exists, parse it as JSON.
5. If `EntityClass` exists, return `plainToInstance(EntityClass, parsedResult)`.
6. If `EntityClass` is absent, return the parsed result.
7. If Redis read or JSON parse throws, log the error and continue to the original method.
8. If an in-process computation for the same `cacheKey` is already in flight, await and return that in-flight promise (applying `EntityClass` hydration only on Redis cache hits, not altering the in-flight return value) instead of executing the original method concurrently.
9. Otherwise call the original method, register its promise in the in-flight map for `cacheKey`, and remove the entry in `finally` regardless of fulfillment or rejection so failures are never cached.
10. If the original result is not `undefined`, write it as JSON with `EX ttlSeconds`.
11. Redis write failures are not awaited by the caller and do not change the method return value.

`false`, `0`, the empty string, and `null` SHALL be cached. Only `undefined` SHALL not be cached.

## 7. CacheEvict Decorator

`CacheEvict(keyGenerator)` SHALL wrap an async method.

Behavior:

1. Call the original method first.
2. Compute `rawKeys = keyGenerator(...args)`.
3. If `rawKeys` is a string, delete that one key.
4. If `rawKeys` is an array, delete every key in the array with one Redis `del` call.
5. If key deletion succeeds, log deleted keys at debug level.
6. If key deletion throws, log the error and still return the original method result.

`evictCache(keys)` SHALL accept one logical Redis key or an array of logical Redis keys. It SHALL
skip empty arrays, delete non-empty keys in one Redis `del` call, log successful deletion at debug
level, and log deletion failures without throwing. `CacheEvict` SHALL use this operation.

`CacheEvict` waits for the decorated method, not for a transaction owned by its caller.
Article-history writes performed with an externally supplied transaction manager SHALL leave
post-commit cache eviction to the operation that owns and awaits that transaction.

## 8. Repository Helper

`getServiceRepository(entity, manager?)` SHALL return `manager.getRepository(entity)` when `manager` exists; otherwise it SHALL return `entity.getRepository()`.

Callers SHALL use the returned TypeORM repository directly for create, find, save, and other
repository operations. The helper module SHALL NOT export separate CRUD forwarding functions.

## 9. Duplicate Key Helpers

`isDuplicateKeyError(error)` SHALL return true when any of these conditions are true:

1. `error.code === 'ER_DUP_ENTRY'`.
2. `error.errno === 1062`.
3. `error.driverError.code === 'ER_DUP_ENTRY'`.
4. `error.driverError.errno === 1062`.

`retryOnDuplicateKey(operation, attempts=3)` SHALL:

1. Normalize `maxAttempts = max(1, attempts)`.
2. Call `operation()` at most `maxAttempts` times.
3. Retry only when the thrown error satisfies `isDuplicateKeyError(error)` and the current attempt is not the last attempt.
4. Rethrow the last error when the error is not a duplicate-key error or no attempts remain.

`isRetryableTransactionError(error)` SHALL return true for MariaDB deadlock error 1213
(`ER_LOCK_DEADLOCK`) and lock-wait timeout error 1205 (`ER_LOCK_WAIT_TIMEOUT`), including errors
wrapped in `driverError`.

`retryOnTransactionConflict(operation, attempts=3)` SHALL:

1. Call `operation()` at most `max(1, attempts)` times.
2. Retry only errors accepted by `isRetryableTransactionError`.
3. Wait for a bounded randomized delay before each retry.
4. Rethrow the last error when no attempts remain.
5. Require the caller to create a new database transaction inside each `operation()` invocation.
6. Log each scheduled retry with the MariaDB error code, error number, current attempt, and maximum attempts; do not log SQL parameters.

## 10. Error Reason Normalization

`normalizeErrorReason(input)` SHALL:

1. Use `input.message` when `input` is an `Error`.
2. Otherwise use `String(input ?? '')`.
3. Replace every whitespace sequence with one ASCII space.
4. Trim leading and trailing whitespace.
5. Use `Unknown error` when the result is empty.
6. Return the result unchanged when its length is at most 80 characters.
7. Return the first 77 characters followed by `...` when its length is greater than 80 characters.

## 11. Hashed Content Helper

`saveHashedContent(options)` SHALL:

1. Compute SHA-256 hex hash over `options.content`.
2. Perform an unlocked existence read using `id`, `contentHash`, and `options.comparisonFields` only.
3. If no row exists, attempt an insert without first acquiring a gap lock.
4. If the insert succeeds, return `{ skipped: false, entity }`.
5. If the insert reports a duplicate key, continue through the existing-row path.
6. Load the existing row by `options.id` with a pessimistic write lock, selecting only `id`,
   `contentHash`, and `options.comparisonFields`.
7. Use `options.isUnchanged(entity, hash)` when provided; otherwise compare `entity.contentHash === hash`.
8. If `forceUpdate` is not true and the existing entity is unchanged, return `{ skipped: true, entity }` without saving.
9. Update the row with `options.incomingData`, `id`, `content`, and `contentHash`.
10. Merge `options.defaults` only into inserted rows.
11. Return `{ skipped: false, entity }` after an insert or update.

Every successful return SHALL contain a non-null `entity`. If the existing row disappears before
the locked read completes, the helper SHALL throw instead of returning a null entity.

The helper SHALL NOT issue `SELECT ... FOR UPDATE` for a missing row. Concurrent creation of the
same ID SHALL resolve as one insert followed by the existing-row path, not as symmetric gap-lock
acquisition.

## 12. File Locations

- TypeORM and Chroma: `packages/backend/src/data-source.ts`
- Redis client: `packages/backend/src/lib/redis.ts`
- Cache decorators: `packages/backend/src/decorators/cacheable.ts`, `packages/backend/src/decorators/cache-evict.ts`
- Repository helper: `packages/backend/src/services/helpers/repository.helper.ts`
- Hashed content helper: `packages/backend/src/services/helpers/hashed-content.helper.ts`
- DB error helpers: `packages/backend/src/utils/db-errors.ts`
- Error reason helper: `packages/backend/src/utils/error-reason.ts`
- Pool monitor: `packages/backend/src/services/database-pool-monitor.service.ts`
