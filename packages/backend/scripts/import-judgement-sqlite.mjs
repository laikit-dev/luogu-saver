import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const { In } = require('typeorm');
const { AppDataSource } = require('../dist/data-source.js');
const { JudgementFetchLog } = require('../dist/entities/judgement-fetch-log.js');
const { JudgementRecord } = require('../dist/entities/judgement-record.js');
const { redisClient } = require('../dist/lib/redis.js');
const {
    createJudgementDedupKey,
    LuoguJudgementRecordSchema
} = require('../dist/shared/judgement.js');

function fail(message) {
    throw new Error(message);
}

function parseArguments(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument !== '--db' && argument !== '--source-time-zone') {
            fail(`Unknown argument: ${argument}`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) fail(`Missing value for ${argument}`);
        options[argument.slice(2)] = value;
        index += 1;
    }
    if (!options.db || !options['source-time-zone']) {
        fail('Usage: npm run import:judgement -- --db <file> --source-time-zone <+HH:MM|-HH:MM>');
    }
    return { databasePath: path.resolve(options.db), timeZone: options['source-time-zone'] };
}

function validateTimeZone(value) {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
    if (!match) fail('Source time zone must use +HH:MM or -HH:MM');
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
        fail(`Invalid source time zone: ${value}`);
    }
}

function parseLegacyDate(value, timeZone, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        fail(`Invalid ${field}: ${String(value)}`);
    }
    const date = new Date(`${value.replace(' ', 'T')}${timeZone}`);
    if (Number.isNaN(date.getTime())) fail(`Invalid ${field}: ${value}`);
    return date;
}

function queryRows(database, sql) {
    const result = database.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row =>
        Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    );
}

function validateColumns(database, table, required) {
    const columns = new Set(
        queryRows(database, `PRAGMA table_info(${table})`).map(row => row.name)
    );
    if (!columns.size) fail(`Legacy table is missing: ${table}`);
    const missing = required.filter(column => !columns.has(column));
    if (missing.length) fail(`Legacy table ${table} is missing columns: ${missing.join(', ')}`);
}

function parseJsonObject(value, field) {
    if (typeof value !== 'string') fail(`${field} must contain JSON text`);
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        fail(`${field} contains invalid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(`${field} must contain a JSON object`);
    }
    return parsed;
}

function chunks(values, size = 500) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function datesEqual(left, right) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}

function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function loadExistingRecords(repository, dedupKeys) {
    const records = [];
    for (const group of chunks(dedupKeys)) {
        if (group.length) records.push(...(await repository.findBy({ dedupKey: In(group) })));
    }
    return records;
}

async function loadExistingLogs(repository, ids) {
    const logs = [];
    for (const group of chunks(ids)) {
        if (!group.length) continue;
        logs.push(
            ...(await repository
                .createQueryBuilder('log')
                .addSelect('log.rawResponse')
                .where('log.id IN (:...ids)', { ids: group })
                .getMany())
        );
    }
    return logs;
}

async function main() {
    const { databasePath, timeZone } = parseArguments(process.argv.slice(2));
    validateTimeZone(timeZone);
    if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
        fail(`Legacy database file not found: ${databasePath}`);
    }
    const SQL = await initSqlJs({
        locateFile: file => require.resolve(`sql.js/dist/${file}`)
    });
    const legacyDatabase = new SQL.Database(fs.readFileSync(databasePath));

    validateColumns(legacyDatabase, 'fetch_logs', [
        'id',
        'fetched_at',
        'record_count',
        'status',
        'error_message',
        'raw_response'
    ]);
    validateColumns(legacyDatabase, 'judgement_records', [
        'id',
        'uid',
        'name',
        'reason',
        'revoked_permission',
        'added_permission',
        'time',
        'raw_user',
        'raw_data',
        'fetch_log_id',
        'created_at'
    ]);

    const sourceLogs = queryRows(legacyDatabase, 'SELECT * FROM fetch_logs ORDER BY id ASC');
    const sourceRows = queryRows(legacyDatabase, 'SELECT * FROM judgement_records ORDER BY id ASC');
    const logIds = new Set(sourceLogs.map(log => Number(log.id)));
    const associatedCounts = new Map();
    const uniqueRecords = new Map();

    for (const row of sourceRows) {
        const id = Number(row.id);
        const uid = Number(row.uid);
        const fetchLogId = Number(row.fetch_log_id);
        if (!Number.isSafeInteger(id) || id <= 0) fail(`Invalid judgement_records.id: ${row.id}`);
        if (!Number.isSafeInteger(uid) || uid <= 0) {
            fail(`Invalid judgement_records.${id}.uid`);
        }
        if (!Number.isSafeInteger(fetchLogId) || fetchLogId <= 0) {
            fail(`Invalid judgement_records.${id}.fetch_log_id`);
        }
        if (!logIds.has(fetchLogId))
            fail(`Record ${row.id} references missing fetch log ${fetchLogId}`);

        const userSnapshot = parseJsonObject(row.raw_user, `judgement_records.${row.id}.raw_user`);
        const fullRecord = parseJsonObject(row.raw_data, `judgement_records.${row.id}.raw_data`);
        const parsed = LuoguJudgementRecordSchema.safeParse(fullRecord);
        if (!parsed.success) fail(`judgement_records.${row.id}.raw_data has an invalid shape`);
        if (
            parsed.data.user.uid !== uid ||
            parsed.data.user.name !== String(row.name) ||
            (parsed.data.reason ?? null) !== (row.reason ?? null) ||
            parsed.data.revokedPermission !== Number(row.revoked_permission) ||
            parsed.data.addedPermission !== Number(row.added_permission) ||
            parsed.data.time !== Number(row.time) ||
            !jsonEqual(userSnapshot, fullRecord.user)
        ) {
            fail(`judgement_records.${row.id} columns do not match its JSON snapshots`);
        }

        const values = {
            id,
            dedupKey: createJudgementDedupKey({
                uid,
                time: Number(row.time),
                reason: row.reason,
                revokedPermission: Number(row.revoked_permission),
                addedPermission: Number(row.added_permission)
            }),
            uid,
            name: String(row.name),
            reason: row.reason ?? null,
            revokedPermission: Number(row.revoked_permission),
            addedPermission: Number(row.added_permission),
            time: Number(row.time),
            userSnapshot,
            fullRecord,
            fetchLogId,
            createdAt: parseLegacyDate(
                row.created_at,
                timeZone,
                `judgement_records.${row.id}.created_at`
            )
        };
        if (!uniqueRecords.has(values.dedupKey)) {
            uniqueRecords.set(values.dedupKey, values);
            associatedCounts.set(fetchLogId, (associatedCounts.get(fetchLogId) ?? 0) + 1);
        }
    }

    const normalizedLogs = sourceLogs.map(row => {
        const id = Number(row.id);
        const recordCount = Number(row.record_count);
        const newRecordCount = associatedCounts.get(id) ?? 0;
        if (!Number.isSafeInteger(id) || id <= 0) fail(`Invalid fetch_logs.id: ${row.id}`);
        if (!Number.isSafeInteger(recordCount) || recordCount < newRecordCount) {
            fail(`Invalid fetch_logs.${id}.record_count`);
        }
        if (row.status !== 'success' && row.status !== 'error') {
            fail(`Invalid fetch_logs.${id}.status`);
        }
        if (row.raw_response !== null && row.status === 'success') {
            parseJsonObject(row.raw_response, `fetch_logs.${id}.raw_response`);
        }
        return {
            id,
            fetchedAt: parseLegacyDate(row.fetched_at, timeZone, `fetch_logs.${id}.fetched_at`),
            recordCount,
            newRecordCount,
            skippedCount: recordCount - newRecordCount,
            status: row.status,
            errorMessage: row.error_message ?? null,
            rawResponse: row.raw_response ?? null
        };
    });

    await AppDataSource.initialize();
    try {
        let insertedLogs = 0;
        let insertedRecords = 0;
        await AppDataSource.transaction(async manager => {
            const logRepository = manager.getRepository(JudgementFetchLog);
            const recordRepository = manager.getRepository(JudgementRecord);
            const existingLogs = await loadExistingLogs(
                logRepository,
                normalizedLogs.map(log => log.id)
            );
            const existingLogById = new Map(existingLogs.map(log => [log.id, log]));

            for (const source of normalizedLogs) {
                const existing = existingLogById.get(source.id);
                if (!existing) continue;
                if (
                    !datesEqual(existing.fetchedAt, source.fetchedAt) ||
                    existing.recordCount !== source.recordCount ||
                    existing.newRecordCount !== source.newRecordCount ||
                    existing.skippedCount !== source.skippedCount ||
                    existing.status !== source.status ||
                    existing.errorMessage !== source.errorMessage ||
                    existing.rawResponse !== source.rawResponse
                ) {
                    fail(`Target fetch log ${source.id} conflicts with legacy data`);
                }
            }

            const missingLogs = normalizedLogs.filter(log => !existingLogById.has(log.id));
            for (const group of chunks(missingLogs)) {
                if (!group.length) continue;
                const result = await logRepository
                    .createQueryBuilder()
                    .insert()
                    .values(group)
                    .execute();
                insertedLogs += Number(result.raw?.affectedRows ?? result.identifiers.length);
            }

            const sourceRecords = [...uniqueRecords.values()];
            const existingRecords = await loadExistingRecords(
                recordRepository,
                sourceRecords.map(record => record.dedupKey)
            );
            const existingRecordByKey = new Map(
                existingRecords.map(record => [record.dedupKey, record])
            );
            for (const source of sourceRecords) {
                const existing = existingRecordByKey.get(source.dedupKey);
                if (!existing) continue;
                if (
                    existing.id !== source.id ||
                    existing.uid !== source.uid ||
                    existing.name !== source.name ||
                    existing.reason !== source.reason ||
                    existing.revokedPermission !== source.revokedPermission ||
                    existing.addedPermission !== source.addedPermission ||
                    existing.time !== source.time ||
                    existing.fetchLogId !== source.fetchLogId ||
                    !datesEqual(existing.createdAt, source.createdAt) ||
                    !jsonEqual(existing.userSnapshot, source.userSnapshot) ||
                    !jsonEqual(existing.fullRecord, source.fullRecord)
                ) {
                    fail(`Target judgement ${source.dedupKey} conflicts with legacy data`);
                }
            }

            const missingRecords = sourceRecords.filter(
                record => !existingRecordByKey.has(record.dedupKey)
            );
            for (const group of chunks(missingRecords)) {
                if (!group.length) continue;
                const result = await recordRepository
                    .createQueryBuilder()
                    .insert()
                    .values(group)
                    .execute();
                insertedRecords += Number(result.raw?.affectedRows ?? result.identifiers.length);
            }
        });

        const sourceUniqueRecords = [...uniqueRecords.values()];
        const matchedRecords = await loadExistingRecords(
            JudgementRecord.getRepository(),
            sourceUniqueRecords.map(record => record.dedupKey)
        );
        const eventTimes = sourceRows.map(row => Number(row.time));
        const audit = {
            sourceFetchLogs: sourceLogs.length,
            sourceRecords: sourceRows.length,
            sourceUniqueRecords: sourceUniqueRecords.length,
            sourceDuplicateRecords: sourceRows.length - sourceUniqueRecords.length,
            insertedFetchLogs: insertedLogs,
            insertedRecords,
            matchedTargetRecords: matchedRecords.length,
            minEventTime: eventTimes.reduce(
                (minimum, time) => Math.min(minimum, time),
                eventTimes[0] ?? null
            ),
            maxEventTime: eventTimes.reduce(
                (maximum, time) => Math.max(maximum, time),
                eventTimes[0] ?? null
            ),
            sourceTimeZone: timeZone
        };
        console.log(JSON.stringify(audit, null, 2));
        if (matchedRecords.length !== sourceUniqueRecords.length) {
            fail('Target audit did not match every unique legacy judgement record');
        }
    } finally {
        legacyDatabase.close();
        await AppDataSource.destroy();
        redisClient.disconnect(false);
    }
}

main().catch(async error => {
    console.error(error instanceof Error ? error.message : String(error));
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    redisClient.disconnect(false);
    process.exitCode = 1;
});
