import type { EntityManager } from 'typeorm';

import { Article } from '@/entities/article';
import { Paste } from '@/entities/paste';
import { User } from '@/entities/user';
import { getServiceRepository } from '@/services/helpers/repository.helper';

const UINT32_MAX = 4_294_967_295;
const MAX_IDS_PER_KIND = 100;
const LID_PATTERN = /^[A-Za-z0-9]{1,8}$/;
const PASTE_PREVIEW_QUERY_LIMIT = 120;
const PASTE_PREVIEW_MAX_CHARS = 80;

export interface ResolveLinksInput {
    userIds: number[];
    articleIds: string[];
    pasteIds: string[];
}

export interface ResolvedLinkUser {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

export interface ResolvedLinkArticle {
    id: string;
    title: string;
    category: number;
    authorName: string | null;
}

export interface ResolvedLinkPaste {
    id: string;
    authorName: string | null;
    preview: string;
}

export interface ResolveLinksResult {
    users: Record<string, ResolvedLinkUser>;
    articles: Record<string, ResolvedLinkArticle>;
    pastes: Record<string, ResolvedLinkPaste>;
}

function invalidResolveInput(message: string): never {
    throw Object.assign(new Error(message), { status: 400 });
}

function parseIdArray<T>(raw: unknown, field: string, parseItem: (item: unknown) => T): T[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        invalidResolveInput(`${field} must be an array`);
    }
    if (raw.length > MAX_IDS_PER_KIND) {
        invalidResolveInput(`${field} exceeds limit of ${MAX_IDS_PER_KIND}`);
    }
    const seen = new Set<T>();
    for (const item of raw) {
        seen.add(parseItem(item));
    }
    return [...seen];
}

export function parseResolveLinksBody(body: unknown): ResolveLinksInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        invalidResolveInput('Request body must be a JSON object');
    }
    const record = body as Record<string, unknown>;

    const userIds = parseIdArray(record.userIds, 'userIds', item => {
        if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > UINT32_MAX) {
            invalidResolveInput('Invalid userIds item');
        }
        return item;
    });

    const articleIds = parseIdArray(record.articleIds, 'articleIds', item => {
        if (typeof item !== 'string' || !LID_PATTERN.test(item)) {
            invalidResolveInput('Invalid articleIds item');
        }
        return item;
    });

    const pasteIds = parseIdArray(record.pasteIds, 'pasteIds', item => {
        if (typeof item !== 'string' || !LID_PATTERN.test(item)) {
            invalidResolveInput('Invalid pasteIds item');
        }
        return item;
    });

    return { userIds, articleIds, pasteIds };
}

function formatPastePreview(raw: string): string {
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    return Array.from(collapsed).slice(0, PASTE_PREVIEW_MAX_CHARS).join('');
}

export class LinkResolveService {
    static async resolve(
        input: ResolveLinksInput,
        manager?: EntityManager
    ): Promise<ResolveLinksResult> {
        const users: Record<string, ResolvedLinkUser> = {};
        const articles: Record<string, ResolvedLinkArticle> = {};
        const pastes: Record<string, ResolvedLinkPaste> = {};

        const userTask =
            input.userIds.length === 0
                ? Promise.resolve()
                : getServiceRepository<User>(User, manager)
                      .createQueryBuilder('user')
                      .select([
                          'user.id',
                          'user.name',
                          'user.color',
                          'user.ccfLevel',
                          'user.xcpcLevel',
                          'user.badge'
                      ])
                      .where('user.id IN (:...ids)', { ids: input.userIds })
                      .getMany()
                      .then(rows => {
                          for (const row of rows) {
                              users[String(row.id)] = {
                                  id: Number(row.id),
                                  name: row.name,
                                  color: row.color,
                                  ccfLevel: Number(row.ccfLevel ?? 0),
                                  xcpcLevel: Number(row.xcpcLevel ?? 0),
                                  badge: row.badge ?? null
                              };
                          }
                      });

        const articleTask =
            input.articleIds.length === 0
                ? Promise.resolve()
                : getServiceRepository<Article>(Article, manager)
                      .createQueryBuilder('article')
                      .leftJoin('article.author', 'author')
                      .select(['article.id', 'article.title', 'article.category', 'author.name'])
                      .where('article.id IN (:...ids)', { ids: input.articleIds })
                      .andWhere('article.deleted = :deleted', { deleted: false })
                      .getRawMany()
                      .then(rows => {
                          for (const row of rows) {
                              const id = row.article_id ?? row.id;
                              if (typeof id !== 'string') continue;
                              articles[id] = {
                                  id,
                                  title: String(row.article_title ?? row.title ?? ''),
                                  category: Number(row.article_category ?? row.category ?? 0),
                                  authorName:
                                      typeof row.author_name === 'string' ? row.author_name : null
                              };
                          }
                      });

        const pasteTask =
            input.pasteIds.length === 0
                ? Promise.resolve()
                : getServiceRepository<Paste>(Paste, manager)
                      .createQueryBuilder('paste')
                      .leftJoin('paste.author', 'author')
                      .select(['paste.id', 'author.name'])
                      .addSelect(
                          `LEFT(paste.content, ${PASTE_PREVIEW_QUERY_LIMIT})`,
                          'pastePreview'
                      )
                      .where('paste.id IN (:...ids)', { ids: input.pasteIds })
                      .andWhere('paste.deleted = :deleted', { deleted: false })
                      .getRawMany()
                      .then(rows => {
                          for (const row of rows) {
                              const id = row.paste_id ?? row.id;
                              if (typeof id !== 'string') continue;
                              pastes[id] = {
                                  id,
                                  authorName:
                                      typeof row.author_name === 'string' ? row.author_name : null,
                                  preview: formatPastePreview(
                                      typeof row.pastePreview === 'string' ? row.pastePreview : ''
                                  )
                              };
                          }
                      });

        await Promise.all([userTask, articleTask, pasteTask]);
        return { users, articles, pastes };
    }
}
