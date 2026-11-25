import { createHash, timingSafeEqual } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import type { UserPrize } from '@/entities/user';
import type { UserColor } from '@/shared/user';
import {
    toPeerPrizes,
    toPeerSnapshot,
    type PeerStream
} from '@/services/helpers/peer-items.helper';
import {
    DB_TIME_FORMAT,
    dbTimeToInstant,
    decodeFeedCursor,
    encodeFeedCursor,
    formatInstant,
    MICROS_PER_SECOND,
    type FeedCursorKey
} from '@/services/helpers/peer-time.helper';

const PAGE_ITEM_LIMIT = 1000;
const PAGE_TEXT_BYTES = 4 * 1024 * 1024;
const SETTLE_MINUTES = 5;
const CLOCK_CHECK_TTL_MS = 600_000;

const dbTime = (column: string) => `DATE_FORMAT(${column}, '${DB_TIME_FORMAT}')`;
/** Stored text of a JSON column, which the driver may otherwise parse (spec Section 9.4). */
const dbJson = (column: string) => `CAST(${column} AS CHAR)`;

export interface PeerFeedPage {
    items: unknown[];
    next: string;
    more: boolean;
}

export class PeerCursorError extends Error {}

interface Candidate {
    k: string | number;
    t: string;
    size: number | string;
}

/**
 * One keyset partition of a stream: rows matching `filter`, ordered by `(time, key)` through an
 * index whose leading columns are the partition's equality filter, the time, and the key. `from`
 * forces that index: on a large table a covering index plus filesort would read every row.
 */
interface Partition {
    from: string;
    filter: string;
    time: string;
    key: string;
}

interface StreamDefinition {
    keyKind: 'string' | 'integer';
    chunk: number;
    partitions: Partition[];
    /** SELECT list for `size`, evaluated over the joined row `x` (two-partition streams). */
    sizeOf: string;
    /** Table joined as `x` by key to compute sizes of union candidates. */
    sizeTable?: string;
    load: (manager: EntityManager, keys: FeedCursorKey[], times: string[]) => Promise<unknown[]>;
}

const COALESCED_CHECKED_AT = 'COALESCE(checked_at, updated_at)';

function checkedPartitions(table: string): Partition[] {
    // COALESCE(checked_at, updated_at) has no index; its rows split into two disjoint partitions
    // that are each ordered by an index and merged by the outer ORDER BY.
    return [
        {
            from: `${table} p FORCE INDEX (idx_${table}_checked_at_id)`,
            filter: 'p.checked_at IS NOT NULL AND p.deleted = 0',
            time: 'p.checked_at',
            key: 'p.id'
        },
        {
            from: `${table} p FORCE INDEX (idx_${table}_checked_at_updated_at_id)`,
            filter: 'p.checked_at IS NULL AND p.deleted = 0',
            time: 'p.updated_at',
            key: 'p.id'
        }
    ];
}

async function select<T>(manager: EntityManager, sql: string, params: unknown[]): Promise<T[]> {
    return (await manager.query(sql, params)) as T[];
}

function byKey<T>(rows: T[], key: (row: T) => FeedCursorKey): Map<string, T> {
    return new Map(rows.map(row => [String(key(row)), row]));
}

function unixInstant(seconds: number | string | null): string | null {
    return seconds === null ? null : formatInstant(Number(seconds) * MICROS_PER_SECOND);
}

const STREAMS: Record<PeerStream, StreamDefinition> = {
    users: {
        keyKind: 'integer',
        chunk: 1001,
        partitions: [
            {
                from: '`user` p FORCE INDEX (idx_user_updated_at_id)',
                filter: '1 = 1',
                time: 'p.updated_at',
                key: 'p.id'
            }
        ],
        sizeOf: `LENGTH(p.name) + COALESCE(LENGTH(p.badge), 0) + COALESCE(LENGTH(p.slogan), 0)
            + COALESCE(LENGTH(p.introduction), 0) + COALESCE(LENGTH(p.prizes), 0)`,
        load: async (manager, keys) => {
            const rows = await select<{
                id: number;
                name: string;
                color: string;
                ccf_level: number;
                xcpc_level: number;
                badge: string | null;
                slogan: string | null;
                introduction: string | null;
                prizes: string | null;
                updated_at: string;
                profile_fetched_at: string | null;
            }>(
                manager,
                `SELECT id, name, color, ccf_level, xcpc_level, badge, slogan, introduction,
                     ${dbJson('prizes')} AS prizes,
                     ${dbTime('updated_at')} AS updated_at,
                     ${dbTime('profile_fetched_at')} AS profile_fetched_at
                 FROM \`user\` WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                return {
                    uid: Number(row.id),
                    name: row.name,
                    color: row.color,
                    ccfLevel: Number(row.ccf_level),
                    xcpcLevel: Number(row.xcpc_level),
                    badge: row.badge,
                    changedAt: dbTimeToInstant(row.updated_at),
                    profile:
                        row.profile_fetched_at === null
                            ? null
                            : {
                                  slogan: row.slogan,
                                  introduction: row.introduction,
                                  prizes: toPeerPrizes(
                                      row.prizes === null
                                          ? null
                                          : (JSON.parse(row.prizes) as UserPrize[])
                                  ),
                                  fetchedAt: dbTimeToInstant(row.profile_fetched_at)
                              }
                };
            });
        }
    },
    'profile-versions': {
        keyKind: 'integer',
        chunk: 1001,
        partitions: [
            {
                from:
                    'user_profile_history p FORCE INDEX (idx_user_profile_history_created_at_id)' +
                    ' STRAIGHT_JOIN `user` u ON u.id = p.user_id',
                filter: 'u.profile_history_enabled = 1',
                time: 'p.created_at',
                key: 'p.id'
            }
        ],
        sizeOf: 'LENGTH(p.snapshot)',
        load: async (manager, keys) => {
            const rows = await select<{
                id: number;
                user_id: number;
                created_at: string;
                snapshot: string;
            }>(
                manager,
                `SELECT id, user_id, ${dbTime('created_at')} AS created_at,
                     ${dbJson('snapshot')} AS snapshot
                 FROM user_profile_history WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                const uid = Number(row.user_id);
                const stored = JSON.parse(row.snapshot) as Parameters<typeof toPeerSnapshot>[0];
                return {
                    uid,
                    observedAt: dbTimeToInstant(row.created_at),
                    snapshot: toPeerSnapshot({
                        ...stored,
                        id: uid,
                        color: stored.color as UserColor
                    })
                };
            });
        }
    },
    articles: {
        keyKind: 'string',
        chunk: 100,
        partitions: checkedPartitions('article'),
        sizeTable: 'article',
        sizeOf: 'LENGTH(x.title) + LENGTH(x.content)',
        load: async (manager, keys) => {
            const rows = await select<{
                id: string;
                title: string;
                content: string;
                author_id: number;
                category: number;
                solution_for_pid: string | null;
                upvote: number;
                favor_count: number;
                publish_time: number | null;
                created_at: string;
                checked_at: string;
            }>(
                manager,
                `SELECT id, title, content, author_id, category, solution_for_pid, upvote,
                     favor_count, publish_time, ${dbTime('created_at')} AS created_at,
                     ${dbTime(COALESCED_CHECKED_AT)} AS checked_at
                 FROM article WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                return {
                    id: row.id,
                    title: row.title,
                    content: row.content,
                    authorId: Number(row.author_id),
                    category: Number(row.category),
                    solutionForPid: row.solution_for_pid,
                    upvote: Number(row.upvote),
                    favorCount: Number(row.favor_count),
                    publishedAt: unixInstant(row.publish_time),
                    archivedAt: dbTimeToInstant(row.created_at),
                    checkedAt: dbTimeToInstant(row.checked_at)
                };
            });
        }
    },
    'article-versions': {
        keyKind: 'integer',
        chunk: 100,
        partitions: [
            {
                from:
                    'article_history p FORCE INDEX (idx_article_history_created_at_id)' +
                    ' STRAIGHT_JOIN article a ON a.id = p.article_id',
                filter: 'a.deleted = 0',
                time: 'p.created_at',
                key: 'p.id'
            }
        ],
        sizeOf: 'LENGTH(p.title) + LENGTH(p.content)',
        load: async (manager, keys) => {
            const rows = await select<{
                id: number;
                article_id: string;
                created_at: string;
                title: string;
                content: string;
            }>(
                manager,
                `SELECT id, article_id, ${dbTime('created_at')} AS created_at, title, content
                 FROM article_history WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                return {
                    articleId: row.article_id,
                    observedAt: dbTimeToInstant(row.created_at),
                    title: row.title,
                    content: row.content
                };
            });
        }
    },
    comments: {
        keyKind: 'string',
        chunk: 100,
        partitions: [
            {
                from: 'article p FORCE INDEX (idx_article_comments_fetched_at_id)',
                filter: 'p.comments_fetched_at IS NOT NULL AND p.deleted = 0',
                time: 'p.comments_fetched_at',
                key: 'p.id'
            }
        ],
        sizeOf: `(SELECT COALESCE(SUM(LENGTH(c.content)), 0) FROM article_comment c
            WHERE c.article_id = p.id)`,
        load: async (manager, keys, times) => {
            const rows = await select<{
                id: number | string;
                article_id: string;
                author_id: number;
                content: string;
                comment_time: number | string;
            }>(
                manager,
                `SELECT id, article_id, author_id, content, comment_time FROM article_comment
                 WHERE article_id IN (?) ORDER BY article_id, id`,
                [keys]
            );
            const commentsByArticle = new Map<string, unknown[]>();
            for (const row of rows) {
                const list = commentsByArticle.get(row.article_id) ?? [];
                list.push({
                    id: Number(row.id),
                    authorId: Number(row.author_id),
                    content: row.content,
                    publishedAt: unixInstant(row.comment_time)
                });
                commentsByArticle.set(row.article_id, list);
            }
            return keys.map((key, index) => ({
                articleId: key,
                fetchedAt: dbTimeToInstant(times[index]),
                comments: commentsByArticle.get(String(key)) ?? []
            }));
        }
    },
    pastes: {
        keyKind: 'string',
        chunk: 100,
        partitions: checkedPartitions('paste'),
        sizeTable: 'paste',
        sizeOf: 'LENGTH(x.content)',
        load: async (manager, keys) => {
            const rows = await select<{
                id: string;
                content: string;
                author_id: number;
                publish_time: number | null;
                created_at: string;
                checked_at: string;
            }>(
                manager,
                `SELECT id, content, author_id, publish_time, ${dbTime('created_at')} AS created_at,
                     ${dbTime(COALESCED_CHECKED_AT)} AS checked_at
                 FROM paste WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                return {
                    id: row.id,
                    content: row.content,
                    authorId: Number(row.author_id),
                    publishedAt: unixInstant(row.publish_time),
                    archivedAt: dbTimeToInstant(row.created_at),
                    checkedAt: dbTimeToInstant(row.checked_at)
                };
            });
        }
    },
    judgements: {
        keyKind: 'integer',
        chunk: 1001,
        partitions: [
            {
                from: 'judgement_record p FORCE INDEX (idx_judgement_record_created_at_id)',
                filter: '1 = 1',
                time: 'p.created_at',
                key: 'p.id'
            }
        ],
        sizeOf: 'LENGTH(p.name) + COALESCE(LENGTH(p.reason), 0) + LENGTH(p.user_snapshot)',
        load: async (manager, keys) => {
            const rows = await select<{
                id: number;
                uid: number;
                name: string;
                reason: string | null;
                revoked_permission: number;
                added_permission: number;
                time: number;
                user_snapshot: string;
            }>(
                manager,
                `SELECT id, uid, name, reason, revoked_permission, added_permission, time,
                     ${dbJson('user_snapshot')} AS user_snapshot
                 FROM judgement_record WHERE id IN (?)`,
                [keys]
            );
            const rowById = byKey(rows, row => row.id);
            return keys.map(key => {
                const row = rowById.get(String(key))!;
                return {
                    uid: Number(row.uid),
                    name: row.name,
                    reason: row.reason,
                    revokedPermission: Number(row.revoked_permission),
                    addedPermission: Number(row.added_permission),
                    time: unixInstant(row.time),
                    user: JSON.parse(row.user_snapshot) as unknown
                };
            });
        }
    }
};

/** Keyset predicate `(time, key) > (t, k)` written so the index range starts at `time >= t`. */
function keysetSql(partition: Partition): string {
    return (
        ` AND ${partition.time} >= CAST(? AS DATETIME(6))` +
        ` AND (${partition.time} > CAST(? AS DATETIME(6)) OR ${partition.key} > ?)`
    );
}

/** Lower bound of every scan: legacy rows may hold MariaDB's zero date, an unknown instant. */
const EARLIEST_DB_TIME = "'1970-01-02 00:00:00'";

function candidateSql(definition: StreamDefinition, withCursor: boolean): string {
    const partitionSql = (partition: Partition, selectList: string) =>
        `SELECT ${selectList} FROM ${partition.from}` +
        ` WHERE ${partition.filter} AND ${partition.time} >= ${EARLIEST_DB_TIME}` +
        ` AND ${partition.time} < CAST(? AS DATETIME(6))` +
        (withCursor ? keysetSql(partition) : '') +
        ` ORDER BY ${partition.time}, ${partition.key} LIMIT ?`;

    if (definition.partitions.length === 1) {
        const [partition] = definition.partitions;
        return partitionSql(
            partition,
            `${partition.key} AS k, ${dbTime(partition.time)} AS t, ${definition.sizeOf} AS size`
        );
    }
    const union = definition.partitions
        .map(
            partition =>
                `(${partitionSql(partition, `${partition.key} AS k, ${partition.time} AS t`)})`
        )
        .join(' UNION ALL ');
    return (
        `SELECT u.k, ${dbTime('u.t')} AS t, ${definition.sizeOf} AS size` +
        ` FROM (SELECT k, t FROM (${union}) merged ORDER BY t, k LIMIT ?) u` +
        ` JOIN ${definition.sizeTable} x ON x.id = u.k ORDER BY u.t, u.k`
    );
}

function candidateParams(
    definition: StreamDefinition,
    cutoff: string,
    cursor: { time: string; key: FeedCursorKey } | null,
    limit: number
): unknown[] {
    const partitionParams = [
        cutoff,
        ...(cursor ? [cursor.time, cursor.time, cursor.key] : []),
        limit
    ];
    return definition.partitions.length === 1
        ? partitionParams
        : [...definition.partitions.flatMap(() => partitionParams), limit];
}

export class PeerExportService {
    private static clockCheckedAt = 0;

    /** True iff export is enabled and `authorization` carries the configured export token. */
    static isAuthorized(authorization: string | undefined): boolean {
        const expected = config.peer.exportToken;
        if (!expected || !authorization) return false;
        const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
        if (!match) return false;
        // Hashing first gives equal-length inputs, so the comparison time is independent of the
        // presented token's length and content.
        const presented = createHash('sha256').update(match[1]).digest();
        return timingSafeEqual(presented, createHash('sha256').update(expected).digest());
    }

    /**
     * Spec Section 10.3: the database wall-clock convention requires the Node.js UTC offset to
     * equal the MariaDB session offset. A successful check is reused for 10 minutes.
     */
    static async assertClockAlignment(manager: EntityManager = AppDataSource.manager) {
        if (Date.now() - this.clockCheckedAt < CLOCK_CHECK_TTL_MS) return;
        const [row] = await select<{ utc_offset: number | string }>(
            manager,
            'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(6), NOW(6)) AS utc_offset',
            []
        );
        const databaseOffset = Number(row.utc_offset);
        const processOffset = -new Date().getTimezoneOffset() * 60;
        if (databaseOffset !== processOffset) {
            logger.error(
                { databaseOffset, processOffset },
                'MariaDB session and Node.js UTC offsets differ; peering is unavailable'
            );
            throw new Error('MariaDB session and Node.js UTC offsets differ');
        }
        this.clockCheckedAt = Date.now();
    }

    /** Validates `after` for `stream`; throws {@link PeerCursorError} when malformed. */
    static parseCursor(stream: PeerStream, after: string) {
        if (after === '') return null;
        const cursor = decodeFeedCursor(after, STREAMS[stream].keyKind);
        if (!cursor) throw new PeerCursorError('Malformed cursor');
        return cursor;
    }

    /** Builds one page of `stream` after `after` (spec Section 11.3). */
    static async buildPage(stream: PeerStream, after: string): Promise<PeerFeedPage> {
        const definition = STREAMS[stream];
        const start = this.parseCursor(stream, after);
        await this.assertClockAlignment();

        return AppDataSource.transaction('REPEATABLE READ', async manager => {
            const [{ cutoff }] = await select<{ cutoff: string }>(
                manager,
                `SELECT ${dbTime(`NOW(6) - INTERVAL ${SETTLE_MINUTES} MINUTE`)} AS cutoff`,
                []
            );

            const accepted: Candidate[] = [];
            let bytes = 0;
            let more = false;
            let position = start;
            scan: while (true) {
                const limit = Math.min(definition.chunk, PAGE_ITEM_LIMIT + 1 - accepted.length);
                const rows = await select<Candidate>(
                    manager,
                    candidateSql(definition, position !== null),
                    candidateParams(definition, cutoff, position, limit)
                );
                for (const row of rows) {
                    if (accepted.length >= PAGE_ITEM_LIMIT || bytes >= PAGE_TEXT_BYTES) {
                        more = true;
                        break scan;
                    }
                    accepted.push(row);
                    bytes += Number(row.size);
                }
                if (rows.length < limit) break;
                const last = rows[rows.length - 1];
                position = { time: last.t, key: last.k };
            }

            if (accepted.length === 0) return { items: [], next: after, more: false };
            const keys = accepted.map(row =>
                definition.keyKind === 'integer' ? Number(row.k) : String(row.k)
            );
            const items = await definition.load(
                manager,
                keys,
                accepted.map(row => row.t)
            );
            const last = accepted[accepted.length - 1];
            return {
                items,
                next: encodeFeedCursor(last.t, keys[keys.length - 1]),
                more
            };
        });
    }
}
