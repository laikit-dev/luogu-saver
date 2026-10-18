import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '@/data-source';
import type {
    ArchiveArticlePage,
    ArchiveEvent,
    ArchiveKind,
    ArchiveStats,
    AuthorArticlesQuery,
    TimelinePage,
    TimelineQuery
} from '@/shared/archive';
import {
    parseArchiveUid,
    parseAuthorArticlesQuery,
    parseTimelineQuery,
    toArchiveArticleSummary
} from '@/utils/archive-query';
import { normalizePublishTime } from '@/services/helpers/publish-time.helper';

const ALL_KINDS: ArchiveKind[] = ['article', 'version', 'profile'];
const KIND_RANK: Record<ArchiveKind, number> = { article: 1, version: 2, profile: 3 };

type Scope = { kind: 'user' | 'owner'; id: number };
type EventSource = {
    kind: ArchiveKind;
    from: string;
    where: string;
    parameters: unknown[];
    observedAt: string;
    sourceId: string;
    uid: string;
    title: string;
    articleId: string;
    version: string;
    publishTime: string;
};
type EventRow = {
    kind: ArchiveKind;
    kind_rank: number | string;
    observed_at: Date | string;
    source_id: string | number;
    sort_id: string;
    uid: number | string;
    title: string;
    article_id: string | null;
    version: number | string | null;
    publish_time: number | string | null;
};
type ArticleRow = {
    id: string;
    title: string;
    category: number | string;
    summary: string | null;
    created_at: Date | string;
    published_seconds: number | string | null;
};
type Cursor = { v: 2; b: string; t: number; i: string; k?: number; p?: number | null };

function eventSources(scope: Scope, kinds: ArchiveKind[], eligibleOnly = false): EventSource[] {
    const sources: EventSource[] = [];
    for (const kind of kinds) {
        const isProfile = kind === 'profile';
        const observedAt = kind === 'article' ? 'a.created_at' : 'h.created_at';
        const uid = isProfile ? 'h.user_id' : 'a.author_id';
        const clauses = isProfile ? [] : ['a.deleted = 0'];
        if (kind === 'version') clauses.push('h.version > 1');
        const parameters: unknown[] = [];
        if (scope.kind === 'user') {
            clauses.push(`${uid} = ?`);
            parameters.push(scope.id);
        } else {
            const eligibleFollow = eligibleOnly ? ` AND f.created_at <= ${observedAt}` : '';
            const followed = `EXISTS (SELECT 1 FROM user_follow f WHERE f.owner_id = ? AND f.luogu_uid = ${uid}${eligibleFollow})`;
            parameters.push(scope.id);
            if (isProfile) {
                clauses.push(followed);
            } else {
                const eligibleSave = eligibleOnly ? ` AND s.created_at <= ${observedAt}` : '';
                clauses.push(
                    `(${followed} OR EXISTS (SELECT 1 FROM saved_article s WHERE s.owner_id = ? AND s.article_id = a.id${eligibleSave}))`
                );
                parameters.push(scope.id);
            }
        }
        sources.push({
            kind,
            from:
                kind === 'article'
                    ? 'article a'
                    : isProfile
                      ? 'user_profile_history h'
                      : 'article_history h INNER JOIN article a ON a.id = h.article_id',
            where: clauses.join(' AND '),
            parameters,
            observedAt,
            sourceId: kind === 'article' ? 'a.id' : 'h.id',
            uid,
            title: isProfile
                ? "CONCAT('资料快照 #', h.version, ' · ', JSON_UNQUOTE(JSON_EXTRACT(h.snapshot, '$.name')))"
                : kind === 'article'
                  ? 'a.title'
                  : 'h.title',
            articleId: isProfile ? 'NULL' : 'a.id',
            version: kind === 'article' ? 'NULL' : 'h.version',
            publishTime: isProfile ? 'NULL' : 'a.publish_time'
        });
    }
    return sources;
}

function decodeCursor(raw: string, binding: string): Cursor {
    try {
        const bytes = Buffer.from(raw, 'base64url');
        if (bytes.toString('base64url') !== raw) throw new Error();
        const value = JSON.parse(bytes.toString('utf8')) as Cursor;
        if (
            !value ||
            Array.isArray(value) ||
            value.v !== 2 ||
            value.b !== binding ||
            !Number.isSafeInteger(value.t) ||
            Math.abs(value.t) > 8_640_000_000_000_000 ||
            typeof value.i !== 'string'
        ) {
            throw new Error();
        }
        return value;
    } catch {
        throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
    }
}

export class UserTimelineService {
    public static async listForUser(uid: number, query: TimelineQuery = {}): Promise<TimelinePage> {
        return this.list({ kind: 'user', id: parseArchiveUid(uid) }, query);
    }

    public static async listForOwner(
        ownerId: number,
        query: TimelineQuery = {}
    ): Promise<TimelinePage> {
        return this.list({ kind: 'owner', id: parseArchiveUid(ownerId) }, query);
    }

    private static async list(scope: Scope, query: TimelineQuery): Promise<TimelinePage> {
        if (query.kinds !== undefined && !Array.isArray(query.kinds)) {
            throw Object.assign(new Error('Invalid archive event kinds'), { status: 400 });
        }
        const normalized = parseTimelineQuery({
            ...query,
            kinds: query.kinds?.join(',')
        });
        const kinds = normalized.kinds ?? ALL_KINDS;
        const binding = createHash('sha256')
            .update(
                JSON.stringify([
                    'timeline',
                    scope.kind,
                    scope.id,
                    kinds,
                    normalized.from ?? null,
                    normalized.to ?? null
                ])
            )
            .digest('hex');
        const cursor = normalized.cursor ? decodeCursor(normalized.cursor, binding) : null;
        if (
            cursor &&
            (!Number.isInteger(cursor.k) ||
                !kinds.some(kind => KIND_RANK[kind] === cursor.k) ||
                !(cursor.k === 1 ? /^[A-Za-z0-9]{1,8}$/ : /^\d{20}$/).test(cursor.i) ||
                (cursor.k !== 1 && Number(cursor.i) < 1))
        ) {
            throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
        }
        const sources = eventSources(scope, kinds);
        // Retain DATETIME so results and Date parameters use the driver's entity-read timezone.
        const projections = sources.map(source => {
            const sortId =
                source.kind === 'article'
                    ? source.sourceId
                    : `LPAD(CAST(${source.sourceId} AS CHAR), 20, '0')`;
            return `SELECT '${source.kind}' AS kind, ${KIND_RANK[source.kind]} AS kind_rank,
                TIMESTAMPADD(MICROSECOND, -MOD(MICROSECOND(${source.observedAt}), 1000), ${source.observedAt}) AS observed_at,
                ${source.sourceId} AS source_id,
                CONVERT(${sortId} USING utf8mb4) COLLATE utf8mb4_bin AS sort_id,
                ${source.uid} AS uid, ${source.title} AS title,
                ${source.articleId} AS article_id, ${source.version} AS version,
                ${source.publishTime} AS publish_time
                FROM ${source.from} WHERE ${source.where}`;
        });
        const parameters = sources.flatMap(source => source.parameters);
        const conditions: string[] = [];
        if (normalized.from !== undefined) {
            conditions.push('observed_at >= ?');
            parameters.push(new Date(normalized.from));
        }
        if (normalized.to !== undefined) {
            conditions.push('observed_at < ?');
            parameters.push(new Date(normalized.to));
        }
        if (cursor) {
            conditions.push(
                '(observed_at < ? OR (observed_at = ? AND (kind_rank < ? OR (kind_rank = ? AND sort_id < CONVERT(? USING utf8mb4) COLLATE utf8mb4_bin))))'
            );
            const observedAt = new Date(cursor.t);
            parameters.push(observedAt, observedAt, cursor.k, cursor.k, cursor.i);
        }
        const limit = normalized.limit!;
        parameters.push(limit + 1);
        const rows: EventRow[] = await AppDataSource.manager.query(
            `SELECT * FROM (${projections.join(' UNION ALL ')}) archive_events
            ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            ORDER BY observed_at DESC, kind_rank DESC, sort_id DESC LIMIT ?`,
            parameters
        );
        const pageRows = rows.slice(0, limit);
        const items: ArchiveEvent[] = pageRows.map(row => {
            const publishTime = normalizePublishTime(
                row.publish_time === null ? null : Number(row.publish_time)
            );
            return {
                eventId: `${row.kind}:${row.source_id}`,
                kind: row.kind,
                observedAt: new Date(row.observed_at).toISOString(),
                uid: Number(row.uid),
                title: row.title,
                articleId: row.article_id,
                version: row.version === null ? null : Number(row.version),
                publishedAt:
                    publishTime === null ? null : new Date(publishTime * 1000).toISOString()
            };
        });
        const last = pageRows[pageRows.length - 1];
        const nextCursor =
            rows.length > limit && last
                ? Buffer.from(
                      JSON.stringify({
                          v: 2,
                          b: binding,
                          t: new Date(last.observed_at).getTime(),
                          k: Number(last.kind_rank),
                          i: last.sort_id
                      } satisfies Cursor)
                  ).toString('base64url')
                : null;
        return { items, nextCursor };
    }

    public static async countForOwner(
        ownerId: number,
        from: Date,
        to: Date,
        manager?: EntityManager
    ): Promise<number> {
        if (
            !(from instanceof Date) ||
            !(to instanceof Date) ||
            !Number.isFinite(from.getTime()) ||
            !Number.isFinite(to.getTime()) ||
            from >= to
        ) {
            throw Object.assign(new Error('Invalid archive count interval'), { status: 400 });
        }
        const sources = eventSources(
            { kind: 'owner', id: parseArchiveUid(ownerId) },
            ALL_KINDS,
            true
        );
        const parameters = sources.flatMap(source => [...source.parameters, from, to]);
        const counts = sources.map(
            source => `SELECT COUNT(*) AS event_count FROM ${source.from}
            WHERE ${source.where} AND ${source.observedAt} >= ? AND ${source.observedAt} < ?`
        );
        const rows: { event_count: string | number }[] = await (
            manager ?? AppDataSource.manager
        ).query(
            `SELECT SUM(event_count) AS event_count FROM (${counts.join(' UNION ALL ')}) archive_counts`,
            parameters
        );
        return Number(rows[0].event_count);
    }

    public static async statsForUser(uid: number): Promise<ArchiveStats> {
        const sources = eventSources({ kind: 'user', id: parseArchiveUid(uid) }, ALL_KINDS);
        const rows: { kind: ArchiveKind; event_count: string | number }[] =
            await AppDataSource.manager.query(
                sources
                    .map(
                        source =>
                            `SELECT '${source.kind}' AS kind, COUNT(*) AS event_count FROM ${source.from} WHERE ${source.where}`
                    )
                    .join(' UNION ALL '),
                sources.flatMap(source => source.parameters)
            );
        const stats: ArchiveStats = { articles: 0, versions: 0, profiles: 0 };
        for (const row of rows) {
            stats[
                row.kind === 'article'
                    ? 'articles'
                    : row.kind === 'version'
                      ? 'versions'
                      : 'profiles'
            ] = Number(row.event_count);
        }
        return stats;
    }

    public static async articlesForUser(
        uid: number,
        query: AuthorArticlesQuery = {}
    ): Promise<ArchiveArticlePage> {
        uid = parseArchiveUid(uid);
        const normalized = parseAuthorArticlesQuery({ ...query });
        const sort = normalized.sort!;
        const binding = createHash('sha256')
            .update(JSON.stringify(['articles', uid, sort, normalized.category ?? null]))
            .digest('hex');
        const cursor = normalized.cursor ? decodeCursor(normalized.cursor, binding) : null;
        if (
            cursor &&
            (!/^[A-Za-z0-9]{1,8}$/.test(cursor.i) ||
                (sort === 'published' &&
                    cursor.p !== null &&
                    (typeof cursor.p !== 'number' || normalizePublishTime(cursor.p) === null)))
        ) {
            throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
        }
        const parameters: unknown[] = [uid];
        const category = normalized.category === undefined ? '' : ' AND a.category = ?';
        if (normalized.category !== undefined) parameters.push(normalized.category);
        let after = '';
        if (cursor) {
            const archivedAfter = '(created_at < ? OR (created_at = ? AND BINARY id < BINARY ?))';
            if (sort === 'archived' || cursor.p === null) {
                after = `WHERE ${sort === 'published' ? 'published_seconds IS NULL AND ' : ''}${archivedAfter}`;
            } else {
                after = `WHERE (published_seconds IS NULL OR published_seconds < ? OR (published_seconds = ? AND ${archivedAfter}))`;
                parameters.push(cursor.p, cursor.p);
            }
            const createdAt = new Date(cursor.t);
            parameters.push(createdAt, createdAt, cursor.i);
        }
        const limit = normalized.limit!;
        parameters.push(limit + 1);
        const rows: ArticleRow[] = await AppDataSource.manager.query(
            `SELECT * FROM (
                SELECT a.id, a.title, a.category, a.summary,
                    TIMESTAMPADD(MICROSECOND, -MOD(MICROSECOND(a.created_at), 1000), a.created_at) AS created_at,
                    CASE WHEN a.publish_time BETWEEN 1 AND 4294967295 THEN a.publish_time ELSE NULL END AS published_seconds
                FROM article a WHERE a.author_id = ? AND a.deleted = 0${category}
            ) archive_articles ${after}
            ORDER BY ${sort === 'published' ? 'published_seconds IS NULL ASC, published_seconds DESC, ' : ''}created_at DESC, BINARY id DESC LIMIT ?`,
            parameters
        );
        const pageRows = rows.slice(0, limit);
        const items = pageRows.map(row =>
            toArchiveArticleSummary({
                id: row.id,
                title: row.title,
                category: Number(row.category),
                summary: row.summary,
                createdAt: row.created_at,
                publishTime: row.published_seconds === null ? null : Number(row.published_seconds)
            })
        );
        const last = pageRows[pageRows.length - 1];
        const nextCursor =
            rows.length > limit && last
                ? Buffer.from(
                      JSON.stringify({
                          v: 2,
                          b: binding,
                          t: new Date(last.created_at).getTime(),
                          i: last.id,
                          p:
                              sort === 'published' && last.published_seconds !== null
                                  ? Number(last.published_seconds)
                                  : null
                      } satisfies Cursor)
                  ).toString('base64url')
                : null;
        return { items, nextCursor };
    }
}
