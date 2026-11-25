import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'koa';

const mocks = vi.hoisted(() => ({ find: vi.fn(), search: vi.fn() }));

vi.mock('@/config', () => ({
    config: {
        meilisearch: {
            enable: true,
            host: 'http://127.0.0.1:7700',
            apiKey: '',
            articleIndexName: 'lgs_articles'
        },
        network: { timeout: 5000 }
    }
}));
vi.mock('@/entities/user', () => ({ User: { find: mocks.find } }));
vi.mock('@/entities/article', () => ({ Article: {} }));
vi.mock('@/services/article.service', () => ({ ArticleService: {} }));
vi.mock('@/lib/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

import searchRouter from '../src/routers/search.router';
import { SearchService } from '../src/services/search.service';

async function runRoute(query: Record<string, unknown>) {
    const success = vi.fn();
    const fail = vi.fn();
    await searchRouter.routes()(
        {
            method: 'GET',
            path: '/search/articles',
            query,
            request: {},
            success,
            fail
        } as unknown as Context,
        async () => {}
    );
    expect(fail).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(1);
}

describe('SearchService filter and sort builders', () => {
    it('always includes deleted = false and escapes quotes/backslashes in tags', () => {
        const filters = SearchService.buildArticleSearchFilters({
            category: [2, 4, 2],
            authorId: 12345,
            tags: ['DP', 'a"b\\c', 'DP', '  '],
            updatedAfter: 1700000000000,
            updatedBefore: 1710000000000,
            minViews: 100
        });

        expect(filters).toEqual([
            'deleted = false',
            'category IN [2, 4]',
            'authorId = 12345',
            'tags = "DP"',
            'tags = "a\\"b\\\\c"',
            'updatedAt >= 1700000000000',
            'updatedAt <= 1710000000000',
            'viewCount >= 100'
        ]);
    });

    it('uses exact category filter for single category and drops invalid numeric values', () => {
        const filters = SearchService.buildArticleSearchFilters({
            category: 3,
            authorId: 1.5,
            updatedAfter: -10,
            minViews: -5
        });

        expect(filters).toEqual(['deleted = false', 'category = 3']);
    });

    it('resolves sort rules for empty and non-empty queries', () => {
        expect(SearchService.resolveArticleSearchSort('', undefined)).toEqual(['updatedAt:desc']);
        expect(SearchService.resolveArticleSearchSort('dp', undefined)).toBeUndefined();
        expect(SearchService.resolveArticleSearchSort('dp', 'relevance')).toBeUndefined();
        expect(SearchService.resolveArticleSearchSort('dp', 'updated_desc')).toEqual([
            'updatedAt:desc'
        ]);
        expect(SearchService.resolveArticleSearchSort('dp', 'updated_asc')).toEqual([
            'updatedAt:asc'
        ]);
        expect(SearchService.resolveArticleSearchSort('dp', 'views_desc')).toEqual([
            'viewCount:desc',
            'updatedAt:desc'
        ]);
        expect(SearchService.resolveArticleSearchSort('dp', 'priority_desc')).toEqual([
            'priority:desc',
            'updatedAt:desc'
        ]);
    });
});

describe('GET /search/articles query parameter parsing', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.find.mockResolvedValue([]);
        mocks.search = vi.spyOn(SearchService, 'searchArticles').mockResolvedValue({
            hits: [],
            page: 1,
            limit: 10,
            total: 0,
            processingTimeMs: 1
        });
    });

    it('parses CSV/array categories, tags, date range, minViews, and valid sort', async () => {
        await runRoute({
            q: '线段树',
            category: '2,4,2',
            authorId: '42',
            tags: ['树状数组', '数据结构,树状数组'],
            updatedAfter: '1700000000000',
            updatedBefore: '1720000000000',
            minViews: '50',
            sort: 'views_desc',
            limit: '24'
        });

        expect(mocks.search).toHaveBeenCalledWith({
            q: '线段树',
            page: 1,
            limit: 24,
            category: [2, 4],
            authorId: 42,
            tags: ['树状数组', '数据结构'],
            updatedAfter: 1700000000000,
            updatedBefore: 1720000000000,
            minViews: 50,
            sort: 'views_desc'
        });
    });

    it('ignores invalid sort, negative minViews, and non-integer authorId', async () => {
        await runRoute({
            category: '3',
            authorId: 'abc',
            minViews: '-1',
            sort: 'drop_table'
        });

        expect(mocks.search).toHaveBeenCalledWith({
            q: '',
            page: 1,
            limit: 10,
            category: 3,
            authorId: undefined,
            tags: undefined,
            updatedAfter: undefined,
            updatedBefore: undefined,
            minViews: undefined,
            sort: undefined
        });
    });
});
