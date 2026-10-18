import type {
    ArchiveArticleSummary,
    ArchiveKind,
    AuthorArticlesQuery,
    TimelineQuery
} from '@/shared/archive';
import { normalizePublishTime } from '@/services/helpers/publish-time.helper';

const UINT32_MAX = 4_294_967_295;
const ARCHIVE_KINDS: ArchiveKind[] = ['article', 'version', 'profile'];

function invalidInput(message: string): never {
    throw Object.assign(new Error(message), { status: 400 });
}

function integerInput(raw: unknown, min: number, max: number, message: string): number {
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?\d+$/.test(raw))) {
        return invalidInput(message);
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        return invalidInput(message);
    }
    return value;
}

export function parseArchiveUid(raw: unknown): number {
    return integerInput(raw, 1, UINT32_MAX, 'Invalid user ID');
}

export function parseArchiveVersion(raw: unknown): number {
    return integerInput(raw, 1, UINT32_MAX, 'Invalid archive version');
}

export function parseArchiveArticleId(raw: unknown): string {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(raw)) {
        return invalidInput('Invalid article ID');
    }
    return raw;
}

function parseCursor(raw: unknown): string | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        return invalidInput('Invalid archive cursor');
    }
    return raw;
}

function parseUtcBound(raw: unknown, name: string): string | undefined {
    if (raw === undefined) return undefined;
    if (
        typeof raw !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)
    ) {
        return invalidInput(`Invalid ${name} UTC date`);
    }
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return invalidInput(`Invalid ${name} UTC date`);
    const normalized = date.toISOString();
    if (normalized.slice(0, 19) !== raw.slice(0, 19)) {
        return invalidInput(`Invalid ${name} UTC date`);
    }
    return normalized;
}

export function parseTimelineQuery(query: Record<string, unknown>): TimelineQuery {
    let kinds: ArchiveKind[] | undefined;
    if (query.kinds !== undefined) {
        if (typeof query.kinds !== 'string' || !query.kinds) {
            return invalidInput('Invalid archive event kinds');
        }
        const requested = query.kinds.split(',');
        if (requested.some(kind => !ARCHIVE_KINDS.includes(kind as ArchiveKind))) {
            return invalidInput('Invalid archive event kinds');
        }
        kinds = ARCHIVE_KINDS.filter(kind => requested.includes(kind));
    }
    const from = parseUtcBound(query.from, 'from');
    const to = parseUtcBound(query.to, 'to');
    if (from && to && Date.parse(from) >= Date.parse(to)) {
        return invalidInput('from must be earlier than to');
    }
    const limit =
        query.limit === undefined
            ? 20
            : integerInput(query.limit, 1, 50, 'Limit must be between 1 and 50');
    return { kinds, from, to, cursor: parseCursor(query.cursor), limit };
}

export function parseAuthorArticlesQuery(query: Record<string, unknown>): AuthorArticlesQuery {
    const sort = query.sort ?? 'archived';
    if (sort !== 'archived' && sort !== 'published') {
        return invalidInput('Invalid article ordering');
    }
    const category =
        query.category === undefined
            ? undefined
            : integerInput(
                  query.category,
                  -2_147_483_648,
                  2_147_483_647,
                  'Invalid article category'
              );
    const limit =
        query.limit === undefined
            ? 20
            : integerInput(query.limit, 1, 50, 'Limit must be between 1 and 50');
    return { sort, category, cursor: parseCursor(query.cursor), limit };
}

export function toArchiveArticleSummary(row: {
    id: string;
    title: string;
    category: number;
    summary?: string | null;
    createdAt: Date | string;
    publishTime?: unknown;
}): ArchiveArticleSummary {
    const publishTime = normalizePublishTime(row.publishTime);
    const summary =
        row.summary == null
            ? null
            : row.summary
                  .replace(/<[^>]*>/g, '')
                  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
                  .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
                  .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
                  .replace(/[`*_~]/g, '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 200);
    return {
        id: row.id,
        title: row.title,
        category: row.category,
        summary,
        createdAt:
            row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : new Date(row.createdAt).toISOString(),
        publishedAt: publishTime === null ? null : new Date(publishTime * 1000).toISOString()
    };
}
