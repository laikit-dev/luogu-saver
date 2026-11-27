import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

const entities = vi.hoisted(() => {
    class Article {}
    class ArticleComment {}
    return { Article, ArticleComment };
});

vi.mock('@/entities/article', () => ({ Article: entities.Article }));
vi.mock('@/entities/article-comment', () => ({ ArticleComment: entities.ArticleComment }));

import {
    CommentService,
    decodeCommentCursor,
    encodeCommentCursor,
    parseCommentsQuery
} from '../src/services/comment.service';

describe('comment cursor & query parsing', () => {
    it('encodes and decodes a valid comment cursor', () => {
        const cursor = encodeCommentCursor(1700000123, '987654321098765432');
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeCommentCursor(cursor)).toEqual({
            t: 1700000123,
            id: '987654321098765432'
        });
    });

    it('uses default limit 20 when omitted and accepts bounds [1, 50]', () => {
        expect(parseCommentsQuery({})).toEqual({ cursor: undefined, limit: 20 });
        expect(parseCommentsQuery({ limit: '1' })).toEqual({ cursor: undefined, limit: 1 });
        expect(parseCommentsQuery({ limit: '50' })).toEqual({ cursor: undefined, limit: 50 });
    });

    it('rejects out-of-range or non-integer limits with status 400', () => {
        for (const badLimit of ['0', '51', '-1', 'abc', '1.5', ['20']]) {
            let caught: unknown;
            try {
                parseCommentsQuery({ limit: badLimit });
            } catch (err) {
                caught = err;
            }
            expect((caught as { status?: number; message?: string })?.status).toBe(400);
            expect((caught as { message?: string })?.message).toBe(
                'Limit must be between 1 and 50'
            );
        }
    });

    it('rejects malformed or tampered cursors with status 400', () => {
        const badPayloads = [
            '',
            'not-base64url!',
            Buffer.from(JSON.stringify({ t: 1.5, id: '123' })).toString('base64url'),
            Buffer.from(JSON.stringify({ t: 100, id: 'abc' })).toString('base64url'),
            Buffer.from(JSON.stringify([100, '123'])).toString('base64url'),
            'a'.repeat(257)
        ];
        for (const badCursor of badPayloads) {
            let caught: unknown;
            try {
                parseCommentsQuery({ cursor: badCursor });
            } catch (err) {
                caught = err;
            }
            expect((caught as { status?: number; message?: string })?.status).toBe(400);
            expect((caught as { message?: string })?.message).toBe('Invalid comments cursor');
        }
    });
});

describe('CommentService.getCommentsPageByArticle', () => {
    function createMockManager(rows: Array<{ id: string; time: number; content: string }>) {
        const qb = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            addOrderBy: vi.fn().mockReturnThis(),
            take: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(rows)
        };
        const manager = {
            getRepository: vi.fn().mockReturnValue({
                createQueryBuilder: vi.fn().mockReturnValue(qb)
            })
        } as unknown as EntityManager;
        return { manager, qb };
    }

    it('returns up to limit comments and sets nextCursor when more rows exist', async () => {
        const rows = [
            { id: '10', time: 1000, content: 'c1' },
            { id: '11', time: 1000, content: 'c2' },
            { id: '12', time: 1001, content: 'c3' }
        ];
        const { manager, qb } = createMockManager(rows);

        const page = await CommentService.getCommentsPageByArticle(
            'abc12345',
            { limit: 2 },
            manager
        );

        expect(qb.where).toHaveBeenCalledWith('comment.articleId = :articleId', {
            articleId: 'abc12345'
        });
        expect(qb.andWhere).not.toHaveBeenCalled();
        expect(qb.orderBy).toHaveBeenCalledWith('comment.time', 'ASC');
        expect(qb.addOrderBy).toHaveBeenCalledWith('comment.id', 'ASC');
        expect(qb.take).toHaveBeenCalledWith(3);

        expect(page.comments.map(c => c.id)).toEqual(['10', '11']);
        expect(decodeCommentCursor(page.nextCursor)).toEqual({ t: 1000, id: '11' });
    });

    it('applies the keyset predicate when cursor is provided and returns nextCursor=null on last page', async () => {
        const rows = [{ id: '12', time: 1001, content: 'c3' }];
        const { manager, qb } = createMockManager(rows);
        const cursor = { t: 1000, id: '11' };

        const page = await CommentService.getCommentsPageByArticle(
            'abc12345',
            { cursor, limit: 2 },
            manager
        );

        expect(qb.andWhere).toHaveBeenCalledWith(
            '(comment.time > :cursorTime OR (comment.time = :cursorTime AND comment.id > :cursorId))',
            { cursorTime: 1000, cursorId: '11' }
        );
        expect(page.comments).toEqual(rows);
        expect(page.nextCursor).toBeNull();
    });
});
