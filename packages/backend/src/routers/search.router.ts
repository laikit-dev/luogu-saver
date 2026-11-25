import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { In } from 'typeorm';
import { User } from '@/entities/user';
import { type ArticleSearchSort, SearchService } from '@/services/search.service';
import { logger } from '@/lib/logger';
import { clampInt } from '@/utils/number';

const router = new Router<DefaultState, Context>({ prefix: '/search' });
const ALLOWED_SORTS = new Set<ArticleSearchSort>([
    'relevance',
    'updated_desc',
    'updated_asc',
    'views_desc',
    'priority_desc'
]);

function toStringList(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const rawItems = Array.isArray(value) ? value : [value];
    return rawItems
        .filter((item): item is string => typeof item === 'string')
        .flatMap(item => item.split(','))
        .map(item => item.trim())
        .filter(Boolean);
}

function parseOptionalInteger(value: unknown): number | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : undefined;
}

function parseOptionalNonNegativeNumber(value: unknown): number | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseCategoryParam(value: unknown): number | number[] | undefined {
    const categories = [
        ...new Set(
            toStringList(value)
                .map(item => Number(item))
                .filter(num => Number.isInteger(num))
        )
    ].slice(0, 20);
    if (categories.length === 0) return undefined;
    return categories.length === 1 ? categories[0] : categories;
}

function parseTagsParam(value: unknown): string[] | undefined {
    const tags = [...new Set(toStringList(value))].slice(0, 10);
    return tags.length > 0 ? tags : undefined;
}

function parseSortParam(value: unknown): ArticleSearchSort | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return undefined;
    return ALLOWED_SORTS.has(raw as ArticleSearchSort) ? (raw as ArticleSearchSort) : undefined;
}

async function getSearchAuthors(authorIds: number[]) {
    if (!authorIds.length) return new Map<number, User>();
    try {
        const authors = await User.find({
            where: { id: In(authorIds) },
            select: {
                id: true,
                name: true,
                color: true,
                ccfLevel: true,
                xcpcLevel: true,
                badge: true
            }
        });
        return new Map(authors.map(author => [author.id, author]));
    } catch (error) {
        logger.warn({ error }, 'Failed to load article search authors');
        return new Map<number, User>();
    }
}

router.get('/articles', async (ctx: Context) => {
    try {
        const minViews = parseOptionalInteger(ctx.query.minViews);
        const result = await SearchService.searchArticles({
            q: typeof ctx.query.q === 'string' ? ctx.query.q : '',
            page: clampInt(ctx.query.page, 1, 1, Number.MAX_SAFE_INTEGER),
            limit: clampInt(ctx.query.limit, 10, 1, 50),
            category: parseCategoryParam(ctx.query.category),
            authorId: parseOptionalInteger(ctx.query.authorId),
            tags: parseTagsParam(ctx.query.tags),
            updatedAfter: parseOptionalNonNegativeNumber(ctx.query.updatedAfter),
            updatedBefore: parseOptionalNonNegativeNumber(ctx.query.updatedBefore),
            minViews: minViews !== undefined && minViews >= 0 ? minViews : undefined,
            sort: parseSortParam(ctx.query.sort)
        });

        const authorIds = new Set(
            result.hits
                .map(hit => hit.authorId)
                .filter(id => Number.isInteger(id) && id >= 1 && id <= 4294967295)
        );
        const authors = await getSearchAuthors([...authorIds]);
        ctx.success({
            ...result,
            hits: result.hits.map(hit => ({ ...hit, author: authors.get(hit.authorId) ?? null }))
        });
    } catch (error) {
        logger.error({ error }, 'Failed to search articles');
        ctx.fail(500, error instanceof Error ? error.message : 'Failed to search articles');
    }
});

export default router;
