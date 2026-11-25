import type { EntityManager } from 'typeorm';
import { AppDataSource } from '@/data-source';
import { logger } from '@/lib/logger';
import { createJudgementDedupKey } from '@/entities/judgement-record';
import type { UserPrize } from '@/entities/user';
import type { UserColor } from '@/shared/user';
import { isDuplicateKeyError, retryOnTransactionConflict } from '@/utils/db-errors';
import {
    applyVersionItem,
    mergeArchived,
    mergeComments,
    mergeUser,
    planVersionList,
    userCursorTime,
    type Observation,
    type UserRecord,
    type VersionListPlan,
    type VersionState
} from '@/services/helpers/peer-merge.helper';
import {
    sha256Hex,
    toPeerSnapshot,
    type PeerArticleItem,
    type PeerArticleVersionItem,
    type PeerComment,
    type PeerCommentsItem,
    type PeerItemByStream,
    type PeerItemSchemas,
    type PeerJudgementItem,
    type PeerPasteItem,
    type PeerProfileVersionItem,
    type PeerStream,
    type PeerUserItem
} from '@/services/helpers/peer-items.helper';
import {
    DB_TIME_FORMAT,
    formatDbTime,
    parseDbTime,
    type Micros
} from '@/services/helpers/peer-time.helper';

/** Statement size limits derived from `@@max_allowed_packet` (spec Section 12.2). */
export interface PeerImportLimits {
    textLimit: number;
    statementBudget: number;
}

/** Post-commit work of one applied page (spec Section 12.7). */
export interface PeerPageEffects {
    cacheKeys: Set<string>;
    searchArticleIds: Set<string>;
    applied: number;
    skipped: number;
}

export interface PeerPageContext {
    peer: string;
    stream: PeerStream;
    after: string;
    next: string;
    limits: PeerImportLimits;
    /** True when this page was already deferred once for missing users (spec Section 12.4). */
    skipMissingUsers: boolean;
}

/** Thrown inside a page transaction to roll it back when it needs users absent locally. */
export class PeerMissingUsersError extends Error {
    constructor(readonly uids: number[]) {
        super(`Peer page references ${uids.length} users absent locally`);
    }
}

const dbTime = (column: string) => `DATE_FORMAT(${column}, '${DB_TIME_FORMAT}')`;
/** Stored text of a JSON column, which the driver may otherwise parse (spec Section 9.4). */
const dbJson = (column: string) => `CAST(${column} AS CHAR)`;

type ArticleTextSource =
    | { kind: 'stored'; rowId: number }
    | { kind: 'copy'; rowId: number }
    | { kind: 'article' }
    | { kind: 'incoming'; title: string; content: string };

type ProfileSource = { rowId: number | null; snapshot: string };

/** Result of folding observations into one article's versions. */
interface ArticleTextMerge {
    plan: VersionListPlan<ArticleTextSource>;
    /** Current text after the fold; null for an article that has no row and gets none. */
    current: VersionState<ArticleTextSource>['current'];
    /** Text of the article row before the fold; null when the row does not exist. */
    initialText: string | null;
    /** Creation time of the last version after the fold. */
    newestTime: Micros;
}

interface ArticleRow {
    id: string;
    title: string;
    content_sha: string;
    author_id: number;
    category: number;
    solution_for_pid: string | null;
    upvote: number;
    favor_count: number;
    publish_time: number | null;
    deleted: number;
    created_at: string;
    checked_at: string;
}

interface ArticleHistoryRow {
    id: number;
    version: number;
    created_at: string;
    title: string;
    content_sha: string;
}

interface UserRow {
    id: number;
    name: string;
    color: string;
    ccf_level: number;
    xcpc_level: number;
    badge: string | null;
    slogan: string | null;
    introduction: string | null;
    prizes: string | null;
    profile_fetched_at: string | null;
    updated_at: string;
    profile_history_enabled: number;
}

interface ProfileHistoryRow {
    id: number;
    version: number;
    created_at: string;
    snapshot: string;
}

interface PasteRow {
    id: string;
    content_sha: string;
    author_id: number;
    publish_time: number | null;
    deleted: number;
    created_at: string;
    checked_at: string;
}

interface ResultHeader {
    affectedRows: number;
    insertId: number;
}

async function select<T>(manager: EntityManager, sql: string, params: unknown[]): Promise<T[]> {
    return (await manager.query(sql, params)) as T[];
}

async function execute(
    manager: EntityManager,
    sql: string,
    params: unknown[]
): Promise<ResultHeader> {
    return (await manager.query(sql, params)) as ResultHeader;
}

/**
 * Reads a local instant for merge comparisons, truncated to milliseconds. Peers exchange
 * millisecond instants, so a local microsecond value echoed back by the other peer must compare
 * equal to itself instead of appearing later than its own echo. MariaDB's zero date, left by
 * legacy rows, is an unknown instant and counts as the earliest one.
 */
function requireDbTime(value: string): Micros {
    if (value.startsWith('0000-00-00')) return 0;
    const instant = parseDbTime(value);
    if (instant === null) throw new Error(`Unexpected database time ${JSON.stringify(value)}`);
    return Math.floor(instant / 1000) * 1000;
}

/** Splits rows into consecutive batches of at most `budget` text bytes, at least one row each. */
function batchByBytes<T>(rows: readonly T[], bytes: (row: T) => number, budget: number): T[][] {
    const batches: T[][] = [];
    let current: T[] = [];
    let size = 0;
    for (const row of rows) {
        const rowBytes = bytes(row);
        if (current.length > 0 && size + rowBytes > budget) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(row);
        size += rowBytes;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

/**
 * Reads a row for update. Without `known`, an unlocked read first checks existence so that a
 * missing primary key never takes a gap lock; a caller whose insert hit a duplicate key passes
 * `known` because its consistent-read snapshot cannot see the concurrently inserted row.
 */
async function lockRow<T>(
    manager: EntityManager,
    table: 'article' | 'paste' | 'user',
    columns: string,
    id: string | number,
    known = false
): Promise<T | null> {
    if (!known) {
        const present = await select(
            manager,
            `SELECT 1 AS present FROM \`${table}\` WHERE id = ?`,
            [id]
        );
        if (present.length === 0) return null;
    }
    const [row] = await select<T>(
        manager,
        `SELECT ${columns} FROM \`${table}\` WHERE id = ? FOR UPDATE`,
        [id]
    );
    return row ?? null;
}

async function existingUserIds(manager: EntityManager, uids: number[]): Promise<Set<number>> {
    const unique = [...new Set(uids)];
    if (unique.length === 0) return new Set();
    const rows = await select<{ id: number }>(manager, 'SELECT id FROM `user` WHERE id IN (?)', [
        unique
    ]);
    return new Set(rows.map(row => Number(row.id)));
}

function sortedBy<T>(items: readonly T[], key: (item: T) => string | number): T[] {
    // Ascending key order fixes the row-lock order of a page; equal keys keep page order.
    return [...items].sort((left, right) => {
        const a = key(left);
        const b = key(right);
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

function groupBy<T, K extends string | number>(
    items: readonly T[],
    key: (item: T) => K
): [K, T[]][] {
    const groups = new Map<K, T[]>();
    for (const item of items) {
        const group = groups.get(key(item));
        if (group) group.push(item);
        else groups.set(key(item), [item]);
    }
    return sortedBy([...groups.entries()], ([groupKey]) => groupKey);
}

const articleTextKey = (title: string, contentSha: string) => JSON.stringify([title, contentSha]);

const ARTICLE_COLUMNS = [
    'id',
    'title',
    'SHA2(content, 256) AS content_sha',
    'author_id',
    'category',
    'solution_for_pid',
    'upvote',
    'favor_count',
    'publish_time',
    'deleted',
    `${dbTime('created_at')} AS created_at`,
    `${dbTime('COALESCE(checked_at, updated_at)')} AS checked_at`
].join(', ');

const USER_COLUMNS = [
    'id',
    'name',
    'color',
    'ccf_level',
    'xcpc_level',
    'badge',
    'slogan',
    'introduction',
    `${dbJson('prizes')} AS prizes`,
    `${dbTime('profile_fetched_at')} AS profile_fetched_at`,
    `${dbTime('updated_at')} AS updated_at`,
    'profile_history_enabled'
].join(', ');

const PASTE_COLUMNS = [
    'id',
    'SHA2(content, 256) AS content_sha',
    'author_id',
    'publish_time',
    'deleted',
    `${dbTime('created_at')} AS created_at`,
    `${dbTime('COALESCE(checked_at, updated_at)')} AS checked_at`
].join(', ');

function parsePrizes(value: string | null): UserPrize[] | null {
    return value === null ? null : (JSON.parse(value) as UserPrize[]);
}

function userRecordOf(row: UserRow): UserRecord {
    return {
        details: {
            name: row.name,
            color: row.color,
            ccfLevel: Number(row.ccf_level),
            xcpcLevel: Number(row.xcpc_level),
            badge: row.badge
        },
        changedAt: requireDbTime(row.updated_at),
        profile:
            row.profile_fetched_at === null
                ? null
                : {
                      slogan: row.slogan,
                      introduction: row.introduction,
                      prizes: parsePrizes(row.prizes) ?? [],
                      fetchedAt: requireDbTime(row.profile_fetched_at)
                  }
    };
}

/** Snapshot text of a user record's current profile, or null without a fetched profile. */
function currentProfileSnapshot(uid: number, record: UserRecord): string | null {
    if (!record.profile) return null;
    return JSON.stringify(
        toPeerSnapshot({
            id: uid,
            name: record.details.name,
            color: record.details.color as UserColor,
            ccfLevel: record.details.ccfLevel,
            xcpcLevel: record.details.xcpcLevel,
            slogan: record.profile.slogan,
            introduction: record.profile.introduction,
            prizes: record.profile.prizes
        })
    );
}

export class PeerImportService {
    /** Validates raw page items; invalid items are logged and dropped (spec Section 12.3). */
    static validateItems<S extends PeerStream>(
        stream: S,
        rawItems: unknown[],
        schemas: PeerItemSchemas
    ): PeerItemByStream[S][] {
        const schema = schemas[stream];
        const valid: PeerItemByStream[S][] = [];
        rawItems.forEach((raw, index) => {
            const result = schema.safeParse(raw);
            if (result.success) {
                valid.push(result.data);
            } else {
                logger.warn(
                    {
                        stream,
                        index,
                        issues: result.error.issues.slice(0, 5).map(issue => ({
                            path: issue.path.join('.'),
                            message: issue.message
                        }))
                    },
                    'Skipped invalid peer item'
                );
            }
        });
        return valid;
    }

    static async loadCursor(
        peer: string,
        stream: PeerStream
    ): Promise<{ cursor: string; deferredCursor: string | null }> {
        const rows = await select<{ cursor_value: string; deferred_cursor: string | null }>(
            AppDataSource.manager,
            'SELECT cursor_value, deferred_cursor FROM peer_cursor WHERE peer = ? AND stream = ?',
            [peer, stream]
        );
        return rows[0]
            ? { cursor: rows[0].cursor_value, deferredCursor: rows[0].deferred_cursor }
            : { cursor: '', deferredCursor: null };
    }

    /** Remembers that the page at `after` was rolled back once for missing users. */
    static async recordDeferral(peer: string, stream: PeerStream, after: string): Promise<void> {
        await AppDataSource.manager.query(
            `INSERT INTO peer_cursor (peer, stream, cursor_value, deferred_cursor, updated_at)
             VALUES (?, ?, ?, ?, NOW(6))
             ON DUPLICATE KEY UPDATE deferred_cursor = VALUES(deferred_cursor), updated_at = NOW(6)`,
            [peer, stream, after, after]
        );
    }

    /**
     * Applies the validated items of one page and stores `next` in one transaction, retried as a
     * whole on deadlock or lock-wait timeout. Throws {@link PeerMissingUsersError} when the page
     * needs absent users and has not been deferred before.
     */
    static async applyPage<S extends PeerStream>(
        items: PeerItemByStream[S][],
        context: PeerPageContext & { stream: S }
    ): Promise<PeerPageEffects> {
        return retryOnTransactionConflict(() =>
            AppDataSource.transaction(async manager => {
                const effects: PeerPageEffects = {
                    cacheKeys: new Set(),
                    searchArticleIds: new Set(),
                    applied: 0,
                    skipped: 0
                };
                const applier = new PageApplier(manager, context, effects);
                switch (context.stream) {
                    case 'users':
                        await applier.users(items as PeerUserItem[]);
                        break;
                    case 'profile-versions':
                        await applier.profileVersions(items as PeerProfileVersionItem[]);
                        break;
                    case 'articles':
                        await applier.articles(items as PeerArticleItem[]);
                        break;
                    case 'article-versions':
                        await applier.articleVersions(items as PeerArticleVersionItem[]);
                        break;
                    case 'comments':
                        await applier.comments(items as PeerCommentsItem[]);
                        break;
                    case 'pastes':
                        await applier.pastes(items as PeerPasteItem[]);
                        break;
                    case 'judgements':
                        await applier.judgements(items as PeerJudgementItem[]);
                        break;
                }
                await manager.query(
                    `INSERT INTO peer_cursor (peer, stream, cursor_value, deferred_cursor, updated_at)
                     VALUES (?, ?, ?, NULL, NOW(6))
                     ON DUPLICATE KEY UPDATE cursor_value = VALUES(cursor_value),
                         deferred_cursor = NULL, updated_at = NOW(6)`,
                    [context.peer, context.stream, context.next]
                );
                return effects;
            })
        );
    }
}

/** Item application inside one page transaction. */
class PageApplier {
    constructor(
        private readonly manager: EntityManager,
        private readonly context: PeerPageContext,
        private readonly effects: PeerPageEffects
    ) {}

    /**
     * Spec Section 12.4: an absent referenced user rolls the page back the first time and makes the
     * item skipped on the retry of the same page.
     */
    private async usersPresent(uids: number[], key: string): Promise<boolean> {
        const present = await existingUserIds(this.manager, uids);
        const missing = [...new Set(uids)].filter(uid => !present.has(uid));
        if (missing.length === 0) return true;
        if (!this.context.skipMissingUsers) throw new PeerMissingUsersError(missing);
        logger.warn(
            { stream: this.context.stream, key, missingUids: missing },
            'Skipped peer data referencing users absent locally'
        );
        return false;
    }

    // -------------------------------------------------------------------------------- users

    async users(items: PeerUserItem[]): Promise<void> {
        for (const item of sortedBy(items, entry => entry.uid)) {
            await this.user(item);
            this.effects.applied++;
        }
    }

    private async user(item: PeerUserItem, known = false): Promise<void> {
        const incoming: UserRecord = {
            details: {
                name: item.name,
                color: item.color,
                ccfLevel: item.ccfLevel,
                xcpcLevel: item.xcpcLevel,
                badge: item.badge
            },
            changedAt: item.changedAt,
            profile: item.profile
        };
        const row = await lockRow<UserRow>(this.manager, 'user', USER_COLUMNS, item.uid, known);
        const local = row ? userRecordOf(row) : null;
        const merged = mergeUser(local, incoming);
        const record = merged.record;
        const cursorTime = userCursorTime(record);
        const values = [
            record.details.name,
            record.details.color,
            record.details.ccfLevel,
            record.details.xcpcLevel,
            record.details.badge,
            record.profile?.slogan ?? null,
            record.profile?.introduction ?? null,
            record.profile ? JSON.stringify(record.profile.prizes) : null,
            record.profile ? formatDbTime(record.profile.fetchedAt) : null
        ];

        if (!row) {
            try {
                await execute(
                    this.manager,
                    `INSERT INTO \`user\` (id, name, color, ccf_level, xcpc_level, badge, slogan,
                         introduction, prizes, profile_fetched_at, profile_history_enabled,
                         profile_history_version, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW(6), ?)`,
                    [item.uid, ...values, formatDbTime(cursorTime)]
                );
            } catch (error) {
                if (!isDuplicateKeyError(error) || known) throw error;
                return this.user(item, true);
            }
        } else if (merged.detailsApplied || merged.profileApplied) {
            // `updated_at` is the feed's `changedAt`; writing max(changedAt, fetchedAt) keeps
            // `profile_fetched_at <= updated_at` (spec Section 13.3).
            await execute(
                this.manager,
                `UPDATE \`user\` SET name = ?, color = ?, ccf_level = ?, xcpc_level = ?, badge = ?,
                     slogan = ?, introduction = ?, prizes = ?, profile_fetched_at = ?, updated_at = ?
                 WHERE id = ?`,
                [...values, formatDbTime(cursorTime), item.uid]
            );
        }
        if (!row || merged.detailsApplied || merged.profileApplied) {
            this.effects.cacheKeys.add(`user:${item.uid}`);
        }

        if (!item.profile) return;
        if (row && !Number(row.profile_history_enabled)) return;
        const incomingSnapshot = currentProfileSnapshot(item.uid, incoming)!;
        const localSnapshot = local ? currentProfileSnapshot(item.uid, local) : null;
        await this.mergeProfileHistory(
            item.uid,
            localSnapshot !== null && local?.profile
                ? { text: localSnapshot, time: local.profile.fetchedAt }
                : null,
            [{ incoming: [], current: { text: incomingSnapshot, time: item.profile.fetchedAt } }]
        );
    }

    // --------------------------------------------------------------------- profile-versions

    async profileVersions(items: PeerProfileVersionItem[]): Promise<void> {
        for (const [uid, group] of groupBy(items, item => item.uid)) {
            if (await this.profileVersionGroup(uid, group)) this.effects.applied += group.length;
            else this.effects.skipped += group.length;
        }
    }

    private async profileVersionGroup(
        uid: number,
        group: PeerProfileVersionItem[],
        known = false
    ): Promise<boolean> {
        const row = await lockRow<UserRow>(this.manager, 'user', USER_COLUMNS, uid, known);
        if (!row) {
            // The FK from user_profile_history requires a user row; its details come from the
            // newest snapshot and its profile stays unfetched (spec Section 12.6).
            const newest = group.reduce((best, item) =>
                item.observedAt >= best.observedAt ? item : best
            );
            try {
                await execute(
                    this.manager,
                    `INSERT INTO \`user\` (id, name, color, ccf_level, xcpc_level, badge, slogan,
                         introduction, prizes, profile_fetched_at, profile_history_enabled,
                         profile_history_version, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 1, 0, NOW(6), ?)`,
                    [
                        uid,
                        newest.snapshot.name,
                        newest.snapshot.color,
                        newest.snapshot.ccfLevel,
                        newest.snapshot.xcpcLevel,
                        formatDbTime(newest.observedAt)
                    ]
                );
            } catch (error) {
                if (!isDuplicateKeyError(error) || known) throw error;
                return this.profileVersionGroup(uid, group, true);
            }
            this.effects.cacheKeys.add(`user:${uid}`);
        } else if (!Number(row.profile_history_enabled)) {
            logger.debug({ uid }, 'Skipped peer profile versions of a user with history disabled');
            return false;
        }

        const local = row ? userRecordOf(row) : null;
        const localSnapshot = local ? currentProfileSnapshot(uid, local) : null;
        await this.mergeProfileHistory(
            uid,
            localSnapshot !== null && local?.profile
                ? { text: localSnapshot, time: local.profile.fetchedAt }
                : null,
            group.map(item => ({
                incoming: [{ text: JSON.stringify(item.snapshot), time: item.observedAt }],
                current: null
            }))
        );
        return true;
    }

    /**
     * Folds profile observations into a user's stored versions and rewrites the changed part of
     * the list. The current profile is governed by Section 6.1 rules 1 and 2, so the fold never
     * adopts the last version as the current profile.
     */
    private async mergeProfileHistory(
        uid: number,
        localCurrent: { text: string; time: Micros } | null,
        steps: {
            incoming: { text: string; time: Micros }[];
            current: { text: string; time: Micros } | null;
        }[]
    ): Promise<void> {
        const storedRows = await select<ProfileHistoryRow>(
            this.manager,
            `SELECT id, version, ${dbTime('created_at')} AS created_at,
                 ${dbJson('snapshot')} AS snapshot
             FROM user_profile_history WHERE user_id = ? ORDER BY version, id FOR UPDATE`,
            [uid]
        );
        const storedById = new Map(storedRows.map(row => [Number(row.id), row]));
        const toObservation = (entry: { text: string; time: Micros }) => ({
            time: entry.time,
            text: entry.text,
            source: { rowId: null, snapshot: entry.text } as ProfileSource
        });

        let state: VersionState<ProfileSource> = {
            versions: storedRows.map(row => ({
                time: requireDbTime(row.created_at),
                text: JSON.stringify(toPeerSnapshot({ ...JSON.parse(row.snapshot), id: uid })),
                source: { rowId: Number(row.id), snapshot: row.snapshot }
            })),
            current: localCurrent ? toObservation(localCurrent) : null,
            currentTime: localCurrent?.time ?? null
        };
        for (const step of steps) {
            state = applyVersionItem(
                state,
                step.incoming.map(toObservation),
                step.current ? toObservation(step.current) : null,
                false,
                source => source
            );
        }

        const plan = planVersionList(
            storedRows.map(row => ({ rowId: Number(row.id), version: Number(row.version) })),
            state.versions,
            source => source.rowId
        );
        if (plan.unchanged) return;

        // (user_id, version) is unique, so renumbered rows are deleted and inserted again.
        const renumbered = plan.retained.filter(row => row.oldVersion !== row.newVersion);
        const deleted = [...plan.removed, ...renumbered.map(row => row.rowId)];
        if (deleted.length > 0) {
            await execute(this.manager, 'DELETE FROM user_profile_history WHERE id IN (?)', [
                deleted
            ]);
        }
        const rows: [number, number, string, string][] = [
            ...renumbered.map(row => {
                const stored = storedById.get(row.rowId)!;
                return [uid, row.newVersion, stored.snapshot, stored.created_at] as [
                    number,
                    number,
                    string,
                    string
                ];
            }),
            ...plan.inserted.map(
                entry =>
                    [
                        uid,
                        entry.version,
                        entry.observation.source.snapshot,
                        formatDbTime(entry.observation.time)
                    ] as [number, number, string, string]
            )
        ];
        for (const batch of batchByBytes(
            rows,
            row => Buffer.byteLength(row[2], 'utf8'),
            this.context.limits.statementBudget
        )) {
            await execute(
                this.manager,
                'INSERT INTO user_profile_history (user_id, version, snapshot, created_at) VALUES ?',
                [batch]
            );
        }
        await execute(
            this.manager,
            'UPDATE `user` SET profile_history_version = ?, updated_at = updated_at WHERE id = ?',
            [state.versions.length, uid]
        );
        this.effects.cacheKeys.add(`user:${uid}`);
    }

    // ----------------------------------------------------------------------------- articles

    async articles(items: PeerArticleItem[]): Promise<void> {
        for (const item of sortedBy(items, entry => entry.id)) {
            if (await this.article(item)) this.effects.applied++;
            else this.effects.skipped++;
        }
    }

    private async article(item: PeerArticleItem, known = false): Promise<boolean> {
        const row = await lockRow<ArticleRow>(
            this.manager,
            'article',
            ARTICLE_COLUMNS,
            item.id,
            known
        );
        if (row && Number(row.deleted)) return false;

        const incomingMeta = {
            authorId: item.authorId,
            category: item.category,
            solutionForPid: item.solutionForPid,
            upvote: item.upvote,
            favorCount: item.favorCount,
            publishTime: item.publishTime
        };
        const local = row
            ? {
                  meta: {
                      authorId: Number(row.author_id),
                      category: Number(row.category),
                      solutionForPid: row.solution_for_pid,
                      upvote: Number(row.upvote),
                      favorCount: Number(row.favor_count),
                      publishTime: row.publish_time === null ? null : Number(row.publish_time)
                  },
                  archivedAt: requireDbTime(row.created_at),
                  checkedAt: requireDbTime(row.checked_at)
              }
            : null;
        const merged = mergeArchived(local, {
            meta: incomingMeta,
            archivedAt: item.archivedAt,
            checkedAt: item.checkedAt
        });
        if (merged.metaApplied && !(await this.usersPresent([item.authorId], item.id))) {
            return false;
        }

        const text = await this.mergeArticleText(item.id, row, [
            {
                incoming: [],
                current: {
                    time: item.checkedAt,
                    title: item.title,
                    content: item.content
                }
            }
        ]);
        if (!row) {
            const current = text.current!;
            const values = [
                item.id,
                item.authorId,
                item.category,
                item.upvote,
                item.favorCount,
                item.solutionForPid,
                item.publishTime,
                formatDbTime(merged.archivedAt),
                formatDbTime(text.newestTime),
                formatDbTime(merged.checkedAt)
            ];
            const columns = `(id, author_id, category, upvote, favor_count, solution_for_pid,
                publish_time, created_at, updated_at, checked_at, title, content, content_hash,
                priority, deleted, tags, view_count)`;
            try {
                if (current.source.kind === 'incoming') {
                    await execute(
                        this.manager,
                        `INSERT INTO article ${columns}
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', 0)`,
                        [
                            ...values,
                            current.source.title,
                            current.source.content,
                            sha256Hex(current.source.content)
                        ]
                    );
                } else if (current.source.kind === 'copy') {
                    await execute(
                        this.manager,
                        `INSERT INTO article ${columns}
                         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, h.title, h.content,
                             SHA2(h.content, 256), 0, 0, '[]', 0
                         FROM article_history h WHERE h.id = ?`,
                        [...values, current.source.rowId]
                    );
                } else {
                    throw new Error(
                        `Unexpected text source ${current.source.kind} for new article`
                    );
                }
            } catch (error) {
                if (!isDuplicateKeyError(error) || known) throw error;
                return this.article(item, true);
            }
            this.effects.cacheKeys.add('article:count');
            this.effects.cacheKeys.add(`article:${item.id}`);
            this.effects.searchArticleIds.add(item.id);
            await this.writeArticleVersions(item.id, text, null);
            return true;
        }

        const assignments: string[] = [];
        const params: unknown[] = [];
        if (merged.archivedAt !== local!.archivedAt) {
            assignments.push('a.created_at = ?');
            params.push(formatDbTime(merged.archivedAt));
        }
        if (merged.metaApplied) {
            assignments.push(
                'a.author_id = ?',
                'a.category = ?',
                'a.upvote = ?',
                'a.favor_count = ?',
                'a.solution_for_pid = ?',
                'a.publish_time = ?',
                'a.checked_at = ?'
            );
            params.push(
                item.authorId,
                item.category,
                item.upvote,
                item.favorCount,
                item.solutionForPid,
                item.publishTime,
                formatDbTime(merged.checkedAt)
            );
        }
        await this.writeArticleVersions(item.id, text, { assignments, params });
        return true;
    }

    // --------------------------------------------------------------------- article-versions

    async articleVersions(items: PeerArticleVersionItem[]): Promise<void> {
        for (const [articleId, group] of groupBy(items, item => item.articleId)) {
            const row = await lockRow<ArticleRow>(
                this.manager,
                'article',
                ARTICLE_COLUMNS,
                articleId
            );
            if (row && Number(row.deleted)) {
                this.effects.skipped += group.length;
                continue;
            }
            const text = await this.mergeArticleText(
                articleId,
                row,
                group.map(item => ({
                    incoming: [{ time: item.observedAt, title: item.title, content: item.content }],
                    current: null
                }))
            );
            await this.writeArticleVersions(
                articleId,
                text,
                row ? { assignments: [], params: [] } : null
            );
            this.effects.applied += group.length;
        }
    }

    /**
     * Folds article observations into the stored versions (Section 7). For an existing article
     * the current text follows the last version after every step (Section 6.3 rule 4).
     */
    private async mergeArticleText(
        articleId: string,
        row: ArticleRow | null,
        steps: {
            incoming: { time: Micros; title: string; content: string }[];
            current: { time: Micros; title: string; content: string } | null;
        }[]
    ): Promise<ArticleTextMerge> {
        const storedRows = await select<ArticleHistoryRow>(
            this.manager,
            `SELECT id, version, ${dbTime('created_at')} AS created_at, title,
                 SHA2(content, 256) AS content_sha
             FROM article_history WHERE article_id = ? ORDER BY version, id FOR UPDATE`,
            [articleId]
        );
        const toObservation = (entry: {
            time: Micros;
            title: string;
            content: string;
        }): Observation<ArticleTextSource> => ({
            time: entry.time,
            text: articleTextKey(entry.title, sha256Hex(entry.content)),
            source: { kind: 'incoming', title: entry.title, content: entry.content }
        });
        const initialText = row ? articleTextKey(row.title, row.content_sha) : null;

        let state: VersionState<ArticleTextSource> = {
            versions: storedRows.map(stored => ({
                time: requireDbTime(stored.created_at),
                text: articleTextKey(stored.title, stored.content_sha),
                source: { kind: 'stored', rowId: Number(stored.id) }
            })),
            current:
                initialText === null ? null : { text: initialText, source: { kind: 'article' } },
            currentTime: row ? requireDbTime(row.checked_at) : null
        };
        for (const step of steps) {
            state = applyVersionItem(
                state,
                step.incoming.map(toObservation),
                step.current ? toObservation(step.current) : null,
                // A missing article adopts a current text only when this item creates it.
                row !== null || step.current !== null,
                source =>
                    source.kind === 'stored' ? { kind: 'copy', rowId: source.rowId } : source
            );
        }

        const plan = planVersionList(
            storedRows.map(stored => ({
                rowId: Number(stored.id),
                version: Number(stored.version),
                text: articleTextKey(stored.title, stored.content_sha)
            })),
            state.versions,
            source => (source.kind === 'stored' ? source.rowId : null),
            true
        );
        const last = state.versions[state.versions.length - 1];
        return { plan, current: state.current, initialText, newestTime: last ? last.time : 0 };
    }

    /**
     * Writes a planned article version list in the order of spec Section 12.6: inserts (copying
     * local texts server-side before they can be deleted or overwritten), the article row update,
     * deletions, then renumbering of retained rows.
     */
    private async writeArticleVersions(
        articleId: string,
        text: ArticleTextMerge,
        articleUpdate: { assignments: string[]; params: unknown[] } | null
    ): Promise<void> {
        const { plan } = text;
        if (!plan.unchanged) this.effects.cacheKeys.add(`article_history:${articleId}`);
        const incomingRows: [string, number, string, string, string][] = [];
        for (const entry of plan.inserted) {
            const createdAt = formatDbTime(entry.observation.time);
            const source = entry.observation.source;
            if (source.kind === 'incoming') {
                incomingRows.push([
                    articleId,
                    entry.version,
                    source.title,
                    source.content,
                    createdAt
                ]);
            } else if (source.kind === 'article') {
                await execute(
                    this.manager,
                    `INSERT INTO article_history (article_id, version, title, content, created_at)
                     SELECT id, ?, title, content, ? FROM article WHERE id = ?`,
                    [entry.version, createdAt, articleId]
                );
            } else {
                await execute(
                    this.manager,
                    `INSERT INTO article_history (article_id, version, title, content, created_at)
                     SELECT article_id, ?, title, content, ? FROM article_history WHERE id = ?`,
                    [entry.version, createdAt, source.rowId]
                );
            }
        }
        for (const batch of batchByBytes(
            incomingRows,
            row => Buffer.byteLength(row[2], 'utf8') + Buffer.byteLength(row[3], 'utf8'),
            this.context.limits.statementBudget
        )) {
            await execute(
                this.manager,
                'INSERT INTO article_history (article_id, version, title, content, created_at) VALUES ?',
                [batch]
            );
        }

        if (articleUpdate && text.initialText !== null) {
            const assignments = [...articleUpdate.assignments];
            const params = [...articleUpdate.params];
            const current = text.current!;
            const textChanged = current.text !== text.initialText;
            let join = '';
            const joinParams: unknown[] = [];
            if (textChanged) {
                if (current.source.kind === 'incoming') {
                    assignments.push('a.title = ?', 'a.content = ?', 'a.content_hash = ?');
                    params.push(
                        current.source.title,
                        current.source.content,
                        sha256Hex(current.source.content)
                    );
                } else if (current.source.kind === 'copy') {
                    join = 'JOIN article_history h ON h.id = ?';
                    joinParams.push(current.source.rowId);
                    assignments.push(
                        'a.title = h.title',
                        'a.content = h.content',
                        'a.content_hash = SHA2(h.content, 256)'
                    );
                }
                assignments.push('a.updated_at = ?');
                params.push(formatDbTime(text.newestTime));
            } else if (assignments.length > 0) {
                assignments.push('a.updated_at = a.updated_at');
            }
            if (assignments.length > 0) {
                await execute(
                    this.manager,
                    `UPDATE article a ${join} SET ${assignments.join(', ')} WHERE a.id = ?`,
                    [...joinParams, ...params, articleId]
                );
                this.effects.cacheKeys.add(`article:${articleId}`);
                this.effects.searchArticleIds.add(articleId);
            }
        }

        if (plan.removed.length > 0) {
            await execute(this.manager, 'DELETE FROM article_history WHERE id IN (?)', [
                plan.removed
            ]);
        }
        for (const row of plan.relocated) {
            await execute(
                this.manager,
                'UPDATE article_history SET version = ?, created_at = ? WHERE id = ?',
                [row.version, formatDbTime(row.observation.time), row.rowId]
            );
        }
        const renumbered = plan.retained.filter(row => row.oldVersion !== row.newVersion);
        if (renumbered.length > 0) {
            await execute(
                this.manager,
                `UPDATE article_history
                 SET version = CASE id ${renumbered.map(() => 'WHEN ? THEN ?').join(' ')} END
                 WHERE id IN (?)`,
                [
                    ...renumbered.flatMap(row => [row.rowId, row.newVersion]),
                    renumbered.map(row => row.rowId)
                ]
            );
        }
    }

    // ----------------------------------------------------------------------------- comments

    async comments(items: PeerCommentsItem[]): Promise<void> {
        for (const item of sortedBy(items, entry => entry.articleId)) {
            if (await this.commentsItem(item)) this.effects.applied++;
            else this.effects.skipped++;
        }
    }

    private async commentsItem(item: PeerCommentsItem): Promise<boolean> {
        const row = await lockRow<{
            id: string;
            deleted: number;
            comments_fetched_at: string | null;
        }>(
            this.manager,
            'article',
            `id, deleted, ${dbTime('comments_fetched_at')} AS comments_fetched_at`,
            item.articleId
        );
        if (row && Number(row.deleted)) return false;

        const localRows = await select<{ id: string | number; content_sha: string }>(
            this.manager,
            `SELECT id, SHA2(content, 256) AS content_sha FROM article_comment
             WHERE article_id = ? FOR UPDATE`,
            [item.articleId]
        );
        const localFetchedAt =
            row?.comments_fetched_at != null ? requireDbTime(row.comments_fetched_at) : null;
        const merged = mergeComments(
            {
                fetchedAt: localFetchedAt,
                contentHashes: new Map(
                    localRows.map(local => [Number(local.id), local.content_sha])
                )
            },
            item,
            comment => sha256Hex(comment.content)
        );

        let inserted: PeerComment[] = merged.inserted;
        const authorIds = inserted.map(comment => comment.authorId);
        if (!(await this.usersPresent(authorIds, item.articleId))) {
            const present = await existingUserIds(this.manager, authorIds);
            inserted = inserted.filter(comment => present.has(comment.authorId));
        }

        for (const batch of batchByBytes(
            inserted,
            comment => Buffer.byteLength(comment.content, 'utf8'),
            this.context.limits.statementBudget
        )) {
            // A comment ID already stored under another article stays unchanged.
            await execute(
                this.manager,
                `INSERT INTO article_comment (id, article_id, author_id, content, comment_time)
                 VALUES ? ON DUPLICATE KEY UPDATE id = id`,
                [
                    batch.map(comment => [
                        comment.id,
                        item.articleId,
                        comment.authorId,
                        comment.content,
                        comment.time
                    ])
                ]
            );
        }
        for (const comment of merged.contentUpdated) {
            await execute(this.manager, 'UPDATE article_comment SET content = ? WHERE id = ?', [
                comment.content,
                comment.id
            ]);
        }

        // An article absent locally has no row to hold `fetchedAt`; it is discarded.
        if (row && merged.fetchedAt !== localFetchedAt) {
            await execute(
                this.manager,
                `UPDATE article SET comments_fetched_at = ?, updated_at = updated_at WHERE id = ?`,
                [formatDbTime(merged.fetchedAt), item.articleId]
            );
            this.effects.cacheKeys.add(`article:${item.articleId}`);
        }
        return true;
    }

    // ------------------------------------------------------------------------------- pastes

    async pastes(items: PeerPasteItem[]): Promise<void> {
        for (const item of sortedBy(items, entry => entry.id)) {
            if (await this.paste(item)) this.effects.applied++;
            else this.effects.skipped++;
        }
    }

    private async paste(item: PeerPasteItem, known = false): Promise<boolean> {
        const row = await lockRow<PasteRow>(this.manager, 'paste', PASTE_COLUMNS, item.id, known);
        if (row && Number(row.deleted)) return false;

        const contentSha = sha256Hex(item.content);
        const merged = mergeArchived(
            row
                ? {
                      meta: {
                          contentSha: row.content_sha,
                          authorId: Number(row.author_id),
                          publishTime: row.publish_time === null ? null : Number(row.publish_time)
                      },
                      archivedAt: requireDbTime(row.created_at),
                      checkedAt: requireDbTime(row.checked_at)
                  }
                : null,
            {
                meta: { contentSha, authorId: item.authorId, publishTime: item.publishTime },
                archivedAt: item.archivedAt,
                checkedAt: item.checkedAt
            }
        );
        if (merged.metaApplied && !(await this.usersPresent([item.authorId], item.id))) {
            return false;
        }

        if (!row) {
            try {
                await execute(
                    this.manager,
                    `INSERT INTO paste (id, content, content_hash, author_id, publish_time,
                         created_at, updated_at, checked_at, deleted)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                    [
                        item.id,
                        item.content,
                        contentSha,
                        item.authorId,
                        item.publishTime,
                        formatDbTime(merged.archivedAt),
                        formatDbTime(item.checkedAt),
                        formatDbTime(item.checkedAt)
                    ]
                );
            } catch (error) {
                if (!isDuplicateKeyError(error) || known) throw error;
                return this.paste(item, true);
            }
            this.effects.cacheKeys.add('paste:count');
            this.effects.cacheKeys.add(`paste:${item.id}`);
            return true;
        }

        const assignments: string[] = [];
        const params: unknown[] = [];
        const archivedAtChanged = merged.archivedAt !== requireDbTime(row.created_at);
        if (archivedAtChanged) {
            assignments.push('created_at = ?');
            params.push(formatDbTime(merged.archivedAt));
        }
        if (merged.metaApplied) {
            const contentChanged = contentSha !== row.content_sha;
            if (contentChanged) {
                assignments.push('content = ?', 'content_hash = ?');
                params.push(item.content, contentSha);
            }
            assignments.push('author_id = ?', 'publish_time = ?', 'checked_at = ?');
            params.push(item.authorId, item.publishTime, formatDbTime(item.checkedAt));
            assignments.push(contentChanged ? 'updated_at = ?' : 'updated_at = updated_at');
            if (contentChanged) params.push(formatDbTime(item.checkedAt));
        } else if (archivedAtChanged) {
            assignments.push('updated_at = updated_at');
        }
        if (assignments.length > 0) {
            await execute(this.manager, `UPDATE paste SET ${assignments.join(', ')} WHERE id = ?`, [
                ...params,
                item.id
            ]);
            this.effects.cacheKeys.add(`paste:${item.id}`);
        }
        return true;
    }

    // --------------------------------------------------------------------------- judgements

    async judgements(items: PeerJudgementItem[]): Promise<void> {
        const unique = new Map<string, PeerJudgementItem>();
        for (const item of items) {
            const key = createJudgementDedupKey({
                uid: item.uid,
                time: item.time,
                reason: item.reason,
                revokedPermission: item.revokedPermission,
                addedPermission: item.addedPermission
            });
            if (!unique.has(key)) unique.set(key, item);
        }
        this.effects.applied += items.length;
        if (unique.size === 0) return;

        const existing = await select<{ dedup_key: string }>(
            this.manager,
            'SELECT dedup_key FROM judgement_record WHERE dedup_key IN (?)',
            [[...unique.keys()]]
        );
        const existingKeys = new Set(existing.map(row => row.dedup_key));
        const pending = [...unique.entries()].filter(([key]) => !existingKeys.has(key));
        if (pending.length === 0) return;

        const log = await execute(
            this.manager,
            `INSERT INTO judgement_fetch_log (fetched_at, record_count, new_record_count,
                 skipped_count, status, error_message, raw_response, source)
             VALUES (NOW(6), ?, 0, 0, 'success', NULL, NULL, 'peer')`,
            [items.length]
        );
        const rows = pending.map(([key, item]) => [
            key,
            item.uid,
            item.name,
            item.reason,
            item.revokedPermission,
            item.addedPermission,
            item.time,
            JSON.stringify(item.user),
            JSON.stringify({
                user: item.user,
                time: item.time,
                reason: item.reason,
                revokedPermission: item.revokedPermission,
                addedPermission: item.addedPermission
            }),
            log.insertId
        ]);
        for (const batch of batchByBytes(
            rows,
            row => Buffer.byteLength(String(row[7]), 'utf8') * 2,
            this.context.limits.statementBudget
        )) {
            await execute(
                this.manager,
                `INSERT INTO judgement_record (dedup_key, uid, name, reason, revoked_permission,
                     added_permission, time, user_snapshot, full_record, fetch_log_id)
                 VALUES ? ON DUPLICATE KEY UPDATE id = id`,
                [batch]
            );
        }
        const [counted] = await select<{ inserted: number | string }>(
            this.manager,
            'SELECT COUNT(*) AS inserted FROM judgement_record WHERE fetch_log_id = ?',
            [log.insertId]
        );
        const inserted = Number(counted.inserted);
        await execute(
            this.manager,
            'UPDATE judgement_fetch_log SET new_record_count = ?, skipped_count = ? WHERE id = ?',
            [inserted, items.length - inserted, log.insertId]
        );
    }
}
