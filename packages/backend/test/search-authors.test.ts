import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'koa';
import { In } from 'typeorm';

const mocks = vi.hoisted(() => ({ find: vi.fn(), search: vi.fn(), warn: vi.fn() }));

vi.mock('@/entities/user', () => ({ User: { find: mocks.find } }));
vi.mock('@/services/search.service', () => ({ SearchService: { searchArticles: mocks.search } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn() } }));

import searchRouter from '../src/routers/search.router';

const author = {
    id: 42,
    name: 'Current author',
    color: 'Purple',
    ccfLevel: 6,
    xcpcLevel: 8,
    badge: 'Aya'
};
const result = {
    hits: [
        {
            id: 'a1',
            authorId: 42,
            authorName: 'Former name',
            formatted: { authorName: '<mark>Former</mark> name' }
        },
        { id: 'a2', authorId: 42, authorName: 'Former name' },
        { id: 'a3', authorId: 19, authorName: 'Missing author' },
        { id: 'a4', authorId: -1 },
        { id: 'a5', authorId: 3.5 },
        { id: 'a6', authorId: 4294967296 },
        { id: 'a7', authorId: '42' },
        { id: 'a8' }
    ],
    page: 2,
    limit: 10,
    total: 18,
    processingTimeMs: 4
};

async function request() {
    const success = vi.fn();
    const fail = vi.fn();
    await searchRouter.routes()(
        {
            path: '/search/articles',
            method: 'GET',
            query: { q: 'author', page: '2' },
            request: {},
            success,
            fail
        } as unknown as Context,
        async () => {}
    );
    expect(fail).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(1);
    return success.mock.calls[0][0];
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.search.mockResolvedValue(result);
    mocks.find.mockResolvedValue([author]);
});

describe('HTTP article search author enrichment', () => {
    it('loads distinct valid IDs once and preserves indexed names, highlights, and pagination', async () => {
        expect(await request()).toEqual({
            ...result,
            hits: result.hits.map(hit => ({ ...hit, author: hit.authorId === 42 ? author : null }))
        });
        expect(mocks.find).toHaveBeenCalledExactlyOnceWith({
            where: { id: In([42, 19]) },
            select: {
                id: true,
                name: true,
                color: true,
                ccfLevel: true,
                xcpcLevel: true,
                badge: true
            }
        });
        expect(mocks.search).toHaveBeenCalledExactlyOnceWith({
            q: 'author',
            page: 2,
            limit: 10,
            category: undefined,
            authorId: undefined
        });
    });

    it('does not query users for an empty page or a page with only invalid IDs', async () => {
        const empty = { ...result, hits: [], total: 0 };
        mocks.search.mockResolvedValueOnce(empty);
        expect(await request()).toEqual(empty);

        const invalid = { ...result, hits: result.hits.slice(3) };
        mocks.search.mockResolvedValueOnce(invalid);
        expect(await request()).toEqual({
            ...invalid,
            hits: invalid.hits.map(hit => ({ ...hit, author: null }))
        });
        expect(mocks.find).not.toHaveBeenCalled();
    });

    it('keeps search results readable when the local author query fails', async () => {
        const error = new Error('Database unavailable');
        mocks.find.mockRejectedValue(error);
        expect(await request()).toEqual({
            ...result,
            hits: result.hits.map(hit => ({ ...hit, author: null }))
        });
        expect(mocks.warn).toHaveBeenCalledWith({ error }, expect.any(String));
    });
});
