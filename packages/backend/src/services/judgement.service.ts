import { AppDataSource } from '@/data-source';
import { JudgementFetchLog } from '@/entities/judgement-fetch-log';
import { createJudgementDedupKey, JudgementRecord } from '@/entities/judgement-record';
import { logger } from '@/lib/logger';
import { paginateJudgementCards } from './helpers/judgement-card.helper';
import { normalizeErrorReason } from '@/utils/error-reason';
import { In } from 'typeorm';

export interface JudgementPaginationQuery {
    page: number;
    limit: number;
}

export interface JudgementQuery extends JudgementPaginationQuery {
    uids: number[];
    name?: string;
    reason?: string;
    startTime?: number;
    endTime?: number;
    revokedPermissions: number[];
    addedPermissions: number[];
    noPermission: boolean;
    group?: 'card';
}

export interface JudgementSyncResult {
    fetchLogId: number;
    fetchedCount: number;
    newRecordCount: number;
    skippedCount: number;
}

interface JudgementFetchedRecord extends Record<string, unknown> {
    user: {
        uid: number;
        name: string;
        [key: string]: unknown;
    };
    reason?: string | null;
    revokedPermission: number;
    addedPermission: number;
    time: number;
}

export interface JudgementFetchedResult {
    data: {
        logs: JudgementFetchedRecord[];
        [key: string]: unknown;
    };
    rawResponse: string;
}

interface JudgementListRecord {
    id: number;
    uid: number;
    name: string;
    reason: string | null;
    revokedPermission: number;
    addedPermission: number;
    time: number;
    userSnapshot: Record<string, unknown>;
    fetchLogId: number;
    fetchLog?: { fetchedAt: Date } | null;
    createdAt: Date;
}

function toJudgementListItem(record: JudgementListRecord) {
    return {
        id: record.id,
        uid: record.uid,
        name: record.name,
        reason: record.reason,
        revoked_permission: record.revokedPermission,
        added_permission: record.addedPermission,
        time: record.time,
        user: record.userSnapshot,
        fetch_log_id: record.fetchLogId,
        log_fetched_at: record.fetchLog?.fetchedAt ?? null,
        created_at: record.createdAt
    };
}

function recordValues(record: JudgementFetchedRecord, fetchLogId: number) {
    return {
        dedupKey: createJudgementDedupKey({
            uid: record.user.uid,
            time: record.time,
            reason: record.reason,
            revokedPermission: record.revokedPermission,
            addedPermission: record.addedPermission
        }),
        uid: record.user.uid,
        name: record.user.name,
        reason: record.reason ?? null,
        revokedPermission: record.revokedPermission,
        addedPermission: record.addedPermission,
        time: record.time,
        userSnapshot: record.user,
        fullRecord: record,
        fetchLogId
    };
}

export class JudgementService {
    static async persistFetchedResult(
        upstream: JudgementFetchedResult
    ): Promise<JudgementSyncResult> {
        const result = await AppDataSource.transaction(async manager => {
            const logRepository = manager.getRepository(JudgementFetchLog);
            const recordRepository = manager.getRepository(JudgementRecord);
            const fetchLog = await logRepository.save(
                logRepository.create({
                    recordCount: upstream.data.logs.length,
                    newRecordCount: 0,
                    skippedCount: 0,
                    status: 'success',
                    errorMessage: null,
                    rawResponse: upstream.rawResponse
                })
            );

            const uniqueRecords = new Map<string, ReturnType<typeof recordValues>>();
            for (const record of upstream.data.logs) {
                const values = recordValues(record, fetchLog.id);
                if (!uniqueRecords.has(values.dedupKey)) {
                    uniqueRecords.set(values.dedupKey, values);
                }
            }

            const values = [...uniqueRecords.values()];
            const existingRecords = values.length
                ? await recordRepository.find({
                      select: { dedupKey: true },
                      where: { dedupKey: In(values.map(record => record.dedupKey)) }
                  })
                : [];
            const existingKeys = new Set(existingRecords.map(record => record.dedupKey));
            const pendingValues = values.filter(record => !existingKeys.has(record.dedupKey));
            if (pendingValues.length) {
                await recordRepository
                    .createQueryBuilder()
                    .insert()
                    .values(pendingValues as any)
                    .orIgnore()
                    .execute();
            }
            const newRecordCount = await recordRepository.countBy({ fetchLogId: fetchLog.id });
            const skippedCount = upstream.data.logs.length - newRecordCount;

            await logRepository.update(fetchLog.id, { newRecordCount, skippedCount });
            return {
                fetchLogId: fetchLog.id,
                fetchedCount: upstream.data.logs.length,
                newRecordCount,
                skippedCount
            };
        });

        logger.info(result, 'Judgement synchronization completed');
        return result;
    }

    static async recordFetchFailure(reason: string): Promise<void> {
        await JudgementFetchLog.getRepository().save({
            recordCount: 0,
            newRecordCount: 0,
            skippedCount: 0,
            status: 'error',
            errorMessage: normalizeErrorReason(reason),
            rawResponse: null
        });
    }

    static async list(query: JudgementQuery) {
        const builder = JudgementRecord.getRepository()
            .createQueryBuilder('record')
            .select([
                'record.id',
                'record.uid',
                'record.name',
                'record.reason',
                'record.revokedPermission',
                'record.addedPermission',
                'record.time',
                'record.userSnapshot',
                'record.fetchLogId',
                'record.createdAt'
            ])
            .leftJoinAndSelect('record.fetchLog', 'fetchLog')
            .orderBy('record.time', 'DESC')
            .addOrderBy('record.id', 'DESC');

        if (query.uids.length) builder.andWhere('record.uid IN (:...uids)', { uids: query.uids });
        if (query.name) {
            builder.andWhere("record.name LIKE :name ESCAPE '!'", {
                name: `%${query.name.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`
            });
        }
        if (query.reason) {
            builder.andWhere("record.reason LIKE :reason ESCAPE '!'", {
                reason: `%${query.reason.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`
            });
        }
        if (query.startTime !== undefined) {
            builder.andWhere('record.time >= :startTime', { startTime: query.startTime });
        }
        if (query.endTime !== undefined) {
            builder.andWhere('record.time <= :endTime', { endTime: query.endTime });
        }
        if (query.noPermission) {
            builder.andWhere('record.revoked_permission = 0');
            builder.andWhere('record.added_permission = 0');
        }
        query.revokedPermissions.forEach((mask, index) => {
            builder.andWhere(
                `(record.revoked_permission & :revokedMask${index}) = :revokedMask${index}`,
                { [`revokedMask${index}`]: mask }
            );
        });
        query.addedPermissions.forEach((mask, index) => {
            builder.andWhere(
                `(record.added_permission & :addedMask${index}) = :addedMask${index}`,
                { [`addedMask${index}`]: mask }
            );
        });

        let records: JudgementRecord[];
        let total: number;
        if (query.group === 'card') {
            const candidates = await builder
                .clone()
                .select([
                    'record.id',
                    'record.reason',
                    'record.revokedPermission',
                    'record.addedPermission'
                ])
                .getMany();
            const groupedPage = paginateJudgementCards(candidates, query);
            total = groupedPage.total;
            records = groupedPage.ids.length
                ? await builder
                      .andWhere('record.id IN (:...cardIds)', { cardIds: groupedPage.ids })
                      .getMany()
                : [];
        } else {
            [records, total] = await builder
                .skip((query.page - 1) * query.limit)
                .take(query.limit)
                .getManyAndCount();
        }
        return {
            items: records.map(toJudgementListItem),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit)
            }
        };
    }

    static async listLogs(query: JudgementPaginationQuery) {
        const [logs, total] = await JudgementFetchLog.getRepository().findAndCount({
            order: { id: 'DESC' },
            skip: (query.page - 1) * query.limit,
            take: query.limit
        });
        return {
            items: logs.map(log => ({
                id: log.id,
                fetched_at: log.fetchedAt,
                record_count: log.recordCount,
                new_record_count: log.newRecordCount,
                skipped_count: log.skippedCount,
                status: log.status,
                error_message: log.errorMessage
            })),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit)
            }
        };
    }

    static async stats() {
        const [totalJudgements, totalFetchLogs, lastFetch] = await Promise.all([
            JudgementRecord.getRepository().count(),
            JudgementFetchLog.getRepository().count(),
            JudgementFetchLog.getRepository().findOne({
                where: {},
                order: { id: 'DESC' }
            })
        ]);
        return {
            totalJudgements,
            totalFetchLogs,
            lastFetchAt: lastFetch?.fetchedAt ?? null,
            lastFetchStatus: lastFetch?.status ?? null
        };
    }
}
