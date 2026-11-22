import { createHash } from 'node:crypto';
import { AppDataSource } from '@/data-source';
import { Article } from '@/entities/article';
import {
    toArchiveArticleSummary,
    type ArchiveArticleSummary,
    type ArchiveKind,
    type AuthorArticlesQuery,
    type TimelineQuery
} from '@/utils/archive-query';
import { normalizePublishTime } from '@/services/helpers/publish-time.helper';

export interface ArchiveEvent {
    eventId: string;
    kind: ArchiveKind;
    observedAt: string;
    uid: number;
    title: string;
    articleId: string | null;
    version: number | null;
    publishedAt: string | null;
}

export interface TimelinePage {
    items: ArchiveEvent[];
    nextCursor: string | null;
}

export interface ArchiveArticlePage {
    items: ArchiveArticleSummary[];
    nextCursor: string | null;
}

export interface ArchiveStats {
    articles: number;
    versions: number;
    profiles: number;
}

const ALL_KINDS: ArchiveKind[] = ['article', 'version', 'profile'];
const KIND_RANK: Record<ArchiveKind, number> = { article: 1, version: 2, profile: 3 };

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

function eventSources(userId: number, kinds: ArchiveKind[]): EventSource[] {
    const sources: EventSource[] = [];
    for (const kind of kinds) {
        const isProfile = kind === 'profile';
        const observedAt = kind === 'article' ? 'a.created_at' : 'h.created_at';
        const uid = isProfile ? 'h.user_id' : 'a.author_id';
        const clauses = isProfile ? [] : ['a.deleted = 0'];
        if (kind === 'version') clauses.push('h.version > 1');
        clauses.push(`${uid} = ?`);
        sources.push({
            kind,
            from:
                kind === 'article'
                    ? 'article a'
                    : isProfile
                      ? 'user_profile_history h'
                      : 'article_history h INNER JOIN article a ON a.id = h.article_id',
            where: clauses.join(' AND '),
            parameters: [userId],
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
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) {
        throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
    }
    let value: Cursor;
    try {
        value = JSON.parse(bytes.toString('utf8')) as Cursor;
    } catch {
        throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
    }
    if (
        !value ||
        Array.isArray(value) ||
        value.v !== 2 ||
        value.b !== binding ||
        !Number.isSafeInteger(value.t) ||
        Math.abs(value.t) > 8_640_000_000_000_000 ||
        typeof value.i !== 'string'
    ) {
        throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
    }
    return value;
}

export class UserTimelineService {
    public static async listForUser(uid: number, query: TimelineQuery = {}): Promise<TimelinePage> {
        const kinds = query.kinds?.length ? query.kinds : ALL_KINDS;
        const binding = createHash('sha256')
            .update(
                JSON.stringify([
                    'timeline',
                    'user',
                    uid,
                    kinds,
                    query.from ?? null,
                    query.to ?? null
                ])
            )
            .digest('hex');
        const cursor = query.cursor ? decodeCursor(query.cursor, binding) : null;
        if (
            cursor &&
            (!Number.isInteger(cursor.k) ||
                !kinds.some(kind => KIND_RANK[kind] === cursor.k) ||
                !(cursor.k === 1 ? /^[A-Za-z0-9]{1,8}$/ : /^\d{20}$/).test(cursor.i) ||
                (cursor.k !== 1 && Number(cursor.i) < 1))
        ) {
            throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
        }
        const sources = eventSources(uid, kinds);
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
        if (query.from !== undefined) {
            conditions.push('observed_at >= ?');
            parameters.push(new Date(query.from));
        }
        if (query.to !== undefined) {
            conditions.push('observed_at < ?');
            parameters.push(new Date(query.to));
        }
        if (cursor) {
            conditions.push(
                '(observed_at < ? OR (observed_at = ? AND (kind_rank < ? OR (kind_rank = ? AND sort_id < CONVERT(? USING utf8mb4) COLLATE utf8mb4_bin))))'
            );
            const observedAt = new Date(cursor.t);
            parameters.push(observedAt, observedAt, cursor.k, cursor.k, cursor.i);
        }
        const limit = query.limit ?? 20;
        const builder = AppDataSource.createQueryBuilder()
            .select('archive_events.*')
            .from(`(${projections.join(' UNION ALL ')})`, 'archive_events')
            .orderBy('archive_events.observed_at', 'DESC')
            .addOrderBy('archive_events.kind_rank', 'DESC')
            .addOrderBy('archive_events.sort_id', 'DESC')
            .limit(limit + 1);
        if (conditions.length) builder.where(conditions.join(' AND '));
        // Preserve the union projections' positional parameter order.
        const rows: EventRow[] = await AppDataSource.manager.query(builder.getQuery(), parameters);
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

    public static async statsForUser(uid: number): Promise<ArchiveStats> {
        const sources = eventSources(uid, ALL_KINDS);
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
        const sort = query.sort ?? 'archived';
        const binding = createHash('sha256')
            .update(JSON.stringify(['articles', uid, sort, query.category ?? null]))
            .digest('hex');
        const cursor = query.cursor ? decodeCursor(query.cursor, binding) : null;
        if (
            cursor &&
            (!/^[A-Za-z0-9]{1,8}$/.test(cursor.i) ||
                (sort === 'published' &&
                    cursor.p !== null &&
                    (typeof cursor.p !== 'number' || normalizePublishTime(cursor.p) === null)))
        ) {
            throw Object.assign(new Error('Invalid archive cursor'), { status: 400 });
        }
        const articleQuery = AppDataSource.getRepository(Article)
            .createQueryBuilder('article')
            .select('article.id', 'id')
            .addSelect('article.title', 'title')
            .addSelect('article.category', 'category')
            .addSelect('article.summary', 'summary')
            .addSelect(
                'TIMESTAMPADD(MICROSECOND, -MOD(MICROSECOND(article.createdAt), 1000), article.createdAt)',
                'created_at'
            )
            .addSelect(
                'CASE WHEN article.publishTime BETWEEN 1 AND 4294967295 THEN article.publishTime END',
                'published_seconds'
            )
            .where('article.authorId = :uid', { uid })
            .andWhere('article.deleted = 0');
        if (query.category !== undefined) {
            articleQuery.andWhere('article.category = :category', {
                category: query.category
            });
        }
        const builder = AppDataSource.createQueryBuilder()
            .select('archive_articles.*')
            .from(`(${articleQuery.getQuery()})`, 'archive_articles')
            .setParameters(articleQuery.getParameters());
        if (cursor) {
            const archivedAfter =
                '(archive_articles.created_at < :cursorTime OR (archive_articles.created_at = :cursorTime AND BINARY archive_articles.id < BINARY :cursorId))';
            const parameters = { cursorTime: new Date(cursor.t), cursorId: cursor.i };
            if (sort === 'archived' || cursor.p === null) {
                if (sort === 'published') {
                    builder.andWhere('archive_articles.published_seconds IS NULL');
                }
                builder.andWhere(archivedAfter, parameters);
            } else {
                builder.andWhere(
                    `(archive_articles.published_seconds IS NULL OR archive_articles.published_seconds < :cursorPublished OR (archive_articles.published_seconds = :cursorPublished AND ${archivedAfter}))`,
                    { ...parameters, cursorPublished: cursor.p }
                );
            }
        }
        if (sort === 'published') {
            builder
                .orderBy('archive_articles.published_seconds IS NULL', 'ASC')
                .addOrderBy('archive_articles.published_seconds', 'DESC');
        }
        builder
            .addOrderBy('archive_articles.created_at', 'DESC')
            .addOrderBy('BINARY archive_articles.id', 'DESC');
        const limit = query.limit ?? 20;
        const rows = await builder.limit(limit + 1).getRawMany<ArticleRow>();
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
