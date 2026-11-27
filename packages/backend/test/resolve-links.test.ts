import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

const entities = vi.hoisted(() => {
    class User {}
    class Article {}
    class Paste {}
    return { User, Article, Paste };
});

vi.mock('@/entities/user', () => ({ User: entities.User }));
vi.mock('@/entities/article', () => ({ Article: entities.Article }));
vi.mock('@/entities/paste', () => ({ Paste: entities.Paste }));

import { LinkResolveService, parseResolveLinksBody } from '../src/services/link-resolve.service';

describe('parseResolveLinksBody', () => {
    it('deduplicates valid IDs and defaults omitted fields to empty arrays', () => {
        expect(
            parseResolveLinksBody({
                userIds: [1, 2, 1],
                articleIds: ['abc12345', 'abc12345'],
                pasteIds: ['pst00001']
            })
        ).toEqual({
            userIds: [1, 2],
            articleIds: ['abc12345'],
            pasteIds: ['pst00001']
        });

        expect(parseResolveLinksBody({})).toEqual({
            userIds: [],
            articleIds: [],
            pasteIds: []
        });
    });

    it('rejects non-object bodies, invalid IDs, and arrays exceeding 100 entries', () => {
        for (const bad of [
            null,
            [],
            'str',
            { userIds: 'not-array' },
            { userIds: [0] },
            { userIds: [1.5] },
            { userIds: Array.from({ length: 101 }, (_, i) => i + 1) },
            { articleIds: ['bad-id!'] },
            { articleIds: ['too_long_lid'] },
            { pasteIds: [''] }
        ]) {
            let caught: unknown;
            try {
                parseResolveLinksBody(bad);
            } catch (err) {
                caught = err;
            }
            expect((caught as { status?: number })?.status).toBe(400);
        }
    });
});

describe('LinkResolveService.resolve', () => {
    it('resolves users, non-deleted articles, and normalized paste previews', async () => {
        const userQb = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue([
                {
                    id: 1001,
                    name: 'kkksc03',
                    color: 'Purple',
                    ccfLevel: 9,
                    xcpcLevel: 4,
                    badge: '站长'
                }
            ])
        };
        const articleQb = {
            leftJoin: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getRawMany: vi.fn().mockResolvedValue([
                {
                    article_id: 'abc12345',
                    article_title: '线段树模板',
                    article_category: 4,
                    author_name: 'Alex_Wei'
                }
            ])
        };
        const pasteQb = {
            leftJoin: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            addSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getRawMany: vi.fn().mockResolvedValue([
                {
                    paste_id: 'pst00001',
                    author_name: 'kkksc03',
                    pastePreview: '第一行\n\n   第二行   '
                }
            ])
        };

        const repoMap = new Map<unknown, unknown>([
            [entities.User, { createQueryBuilder: () => userQb }],
            [entities.Article, { createQueryBuilder: () => articleQb }],
            [entities.Paste, { createQueryBuilder: () => pasteQb }]
        ]);

        const manager = {
            getRepository: vi.fn((entity: unknown) => repoMap.get(entity))
        } as unknown as EntityManager;

        const res = await LinkResolveService.resolve(
            { userIds: [1001], articleIds: ['abc12345'], pasteIds: ['pst00001'] },
            manager
        );

        expect(res).toEqual({
            users: {
                '1001': {
                    id: 1001,
                    name: 'kkksc03',
                    color: 'Purple',
                    ccfLevel: 9,
                    xcpcLevel: 4,
                    badge: '站长'
                }
            },
            articles: {
                abc12345: {
                    id: 'abc12345',
                    title: '线段树模板',
                    category: 4,
                    authorName: 'Alex_Wei'
                }
            },
            pastes: {
                pst00001: {
                    id: 'pst00001',
                    authorName: 'kkksc03',
                    preview: '第一行 第二行'
                }
            }
        });
    });
});
