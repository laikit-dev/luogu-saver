import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { In } from 'typeorm';
import { User } from '@/entities/user';
import { SearchService } from '@/services/search.service';
import { logger } from '@/lib/logger';
import { clampInt } from '@/utils/number';

const router = new Router<DefaultState, Context>({ prefix: '/search' });

function parseOptionalNumber(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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
        const result = await SearchService.searchArticles({
            q: typeof ctx.query.q === 'string' ? ctx.query.q : '',
            page: clampInt(ctx.query.page, 1, 1, Number.MAX_SAFE_INTEGER),
            limit: clampInt(ctx.query.limit, 10, 1, 50),
            category: parseOptionalNumber(ctx.query.category),
            authorId: parseOptionalNumber(ctx.query.authorId)
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
