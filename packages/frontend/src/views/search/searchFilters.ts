import type { ArticleSearchSort } from '@/api/search.ts';

export const SEARCH_PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
export const DEFAULT_SEARCH_LIMIT = 12;

export const SEARCH_SORT_OPTIONS: ReadonlyArray<{ label: string; value: ArticleSearchSort }> = [
    { label: '默认排序', value: 'relevance' },
    { label: '最近更新', value: 'updated_desc' },
    { label: '最早更新', value: 'updated_asc' },
    { label: '阅读最多', value: 'views_desc' },
    { label: '推荐优先', value: 'priority_desc' }
];

const ALLOWED_SORTS = new Set<ArticleSearchSort>(SEARCH_SORT_OPTIONS.map(option => option.value));
const AUTHOR_UID_PATTERN = /(?:^|\s)(?:author|uid|作者)\s*[:：]\s*(\d+)(?=\s|$)/i;

export function parseRouteNumber(value: unknown): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parsePositiveInt(value: unknown): number | null {
    const parsed = parseRouteNumber(value);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

export function parseNonNegativeInt(value: unknown): number | null {
    const parsed = parseRouteNumber(value);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

export function parseCategoryListQuery(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    const seen = new Set<number>();
    const result: number[] = [];

    for (const entry of list) {
        if (typeof entry !== 'string' && typeof entry !== 'number') continue;
        for (const piece of String(entry).split(',')) {
            const trimmed = piece.trim();
            if (!trimmed) continue;
            const parsed = Number(trimmed);
            if (!Number.isInteger(parsed) || seen.has(parsed)) continue;
            seen.add(parsed);
            result.push(parsed);
        }
    }

    return result.slice(0, 20);
}

export function parseTagsQuery(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entry of list) {
        if (typeof entry !== 'string') continue;
        for (const piece of entry.split(',')) {
            const cleaned = piece.trim();
            if (!cleaned || seen.has(cleaned)) continue;
            seen.add(cleaned);
            result.push(cleaned);
        }
    }

    return result.slice(0, 10);
}

export function parseSearchSort(value: unknown): ArticleSearchSort {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && ALLOWED_SORTS.has(raw as ArticleSearchSort)) {
        return raw as ArticleSearchSort;
    }
    return 'relevance';
}

export function normalizeSearchLimit(value: unknown): number {
    const parsed = parsePositiveInt(value);
    if (parsed === null) return DEFAULT_SEARCH_LIMIT;
    if (SEARCH_PAGE_SIZE_OPTIONS.includes(parsed as (typeof SEARCH_PAGE_SIZE_OPTIONS)[number])) {
        return parsed;
    }
    return Math.min(50, Math.max(1, parsed));
}

export function sanitizeExactPhrase(raw: string): string {
    return raw.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseExactPhrasesQuery(value: unknown): string[] {
    const list = Array.isArray(value)
        ? value
        : value !== undefined && value !== null
          ? [value]
          : [];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entry of list) {
        if (typeof entry !== 'string') continue;
        const cleaned = sanitizeExactPhrase(entry);
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        result.push(cleaned);
    }

    return result;
}

/**
 * Extracts inline `uid:123` / `author:123` / `作者:123` syntax from free text so users can either
 * use the dedicated Author UID filter or type the shorthand in the main search input.
 */
export function extractInlineAuthorUid(value: string): { text: string; authorId: number | null } {
    const match = value.match(AUTHOR_UID_PATTERN);
    if (!match) {
        return { text: value.trim(), authorId: null };
    }

    const parsed = Number(match[1]);
    return {
        text: value.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
        authorId: Number.isInteger(parsed) && parsed > 0 ? parsed : null
    };
}

/**
 * Composes the final Meilisearch `q` string by combining free-text keywords with exact-phrase
 * filters wrapped in double quotes.
 */
export function composeSearchQuery(freeText: string, exactPhrases: readonly string[]): string {
    const parts: string[] = [];
    const trimmed = freeText.trim();
    if (trimmed) {
        parts.push(trimmed);
    }
    for (const phrase of exactPhrases) {
        const cleaned = sanitizeExactPhrase(phrase);
        if (cleaned) {
            parts.push(`"${cleaned}"`);
        }
    }
    return parts.join(' ');
}
