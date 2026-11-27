import { EntityManager } from 'typeorm';

import { Article } from '@/entities/article';
import { ArticleComment } from '@/entities/article-comment';
import { getServiceRepository } from '@/services/helpers/repository.helper';

const COMMENTS_TTL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_COMMENTS_PAGE_LIMIT = 20;
export const MAX_COMMENTS_PAGE_LIMIT = 50;

export interface CommentCursor {
    t: number;
    id: string;
}

export interface CommentsPageQuery {
    cursor?: CommentCursor;
    limit: number;
}

export interface CommentsPageResult {
    comments: ArticleComment[];
    nextCursor: string | null;
}

function invalidCommentsQuery(message: string): never {
    throw Object.assign(new Error(message), { status: 400 });
}

export function encodeCommentCursor(time: number | string, id: number | string): string {
    return Buffer.from(JSON.stringify({ t: Number(time), id: String(id) }), 'utf8').toString(
        'base64url'
    );
}

export function decodeCommentCursor(raw: unknown): CommentCursor {
    if (
        typeof raw !== 'string' ||
        raw.length === 0 ||
        raw.length > 256 ||
        !/^[A-Za-z0-9_-]+$/.test(raw)
    ) {
        invalidCommentsQuery('Invalid comments cursor');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
        invalidCommentsQuery('Invalid comments cursor');
    }
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !Number.isInteger((parsed as { t?: unknown }).t) ||
        typeof (parsed as { id?: unknown }).id !== 'string' ||
        !/^\d+$/.test((parsed as { id: string }).id)
    ) {
        invalidCommentsQuery('Invalid comments cursor');
    }
    return {
        t: (parsed as { t: number }).t,
        id: (parsed as { id: string }).id
    };
}

export function parseCommentsQuery(query: Record<string, unknown>): CommentsPageQuery {
    let limit = DEFAULT_COMMENTS_PAGE_LIMIT;
    if (query.limit !== undefined) {
        const raw = query.limit;
        if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?\d+$/.test(raw))) {
            invalidCommentsQuery('Limit must be between 1 and 50');
        }
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_COMMENTS_PAGE_LIMIT) {
            invalidCommentsQuery('Limit must be between 1 and 50');
        }
        limit = parsed;
    }

    const cursor = query.cursor === undefined ? undefined : decodeCommentCursor(query.cursor);
    return { cursor, limit };
}

export interface LuoguComment {
    id: number;
    authorId: number;
    time: number; // Unix seconds.
    content: string;
}

export class CommentService {
    /**
     * Returns all stored comments for an article, oldest first, with authors joined.
     */
    static async getCommentsByArticle(
        articleId: string,
        manager?: EntityManager
    ): Promise<ArticleComment[]> {
        return await getServiceRepository<ArticleComment>(ArticleComment, manager).find({
            where: { articleId },
            relations: ['author'],
            order: { time: 'ASC', id: 'ASC' }
        });
    }

    /**
     * Returns a cursor-paginated slice of stored comments ordered by (comment_time ASC, id ASC).
     */
    static async getCommentsPageByArticle(
        articleId: string,
        options: { cursor?: CommentCursor; limit?: number } = {},
        manager?: EntityManager
    ): Promise<CommentsPageResult> {
        const limit = options.limit ?? DEFAULT_COMMENTS_PAGE_LIMIT;
        const qb = getServiceRepository<ArticleComment>(ArticleComment, manager)
            .createQueryBuilder('comment')
            .leftJoinAndSelect('comment.author', 'author')
            .where('comment.articleId = :articleId', { articleId });

        if (options.cursor) {
            qb.andWhere(
                '(comment.time > :cursorTime OR (comment.time = :cursorTime AND comment.id > :cursorId))',
                {
                    cursorTime: options.cursor.t,
                    cursorId: options.cursor.id
                }
            );
        }

        const rows = await qb
            .orderBy('comment.time', 'ASC')
            .addOrderBy('comment.id', 'ASC')
            .take(limit + 1)
            .getMany();

        const hasMore = rows.length > limit;
        const comments = hasMore ? rows.slice(0, limit) : rows;
        const last = comments[comments.length - 1];
        const nextCursor = hasMore && last ? encodeCommentCursor(last.time, last.id) : null;

        return { comments, nextCursor };
    }

    /**
     * True when the article's comments have never been fetched, or the last fetch
     * is older than COMMENTS_TTL_MS. Unknown article (null) is treated as stale.
     */
    static isCommentsStale(article: Article | null): boolean {
        if (!article) return true;
        if (!article.commentsFetchedAt) return true;
        const last = new Date(article.commentsFetchedAt).getTime();
        return Date.now() - last > COMMENTS_TTL_MS;
    }

    /**
     * Authoritative comment write path (the save:comments handler). Replaces the
     * full comment set for the article wholesale and bumps `comments_fetched_at`.
     *
     * Authors are NOT written here; the handler upserts them into `user` first
     * (reusing buildUser / upsertLuoguUser) so that badges and colors are available.
     *
     * The whole operation is transactional: delete-then-insert plus the timestamp
     * bump succeed or fail together, so readers never see a half-replaced set.
     */
    static async saveLuoguComments(articleId: string, comments: LuoguComment[]): Promise<void> {
        await Article.transaction(async manager => {
            const commentRepo = getServiceRepository<ArticleComment>(ArticleComment, manager);
            const articleRepo = getServiceRepository<Article>(Article, manager);

            await commentRepo.delete({ articleId });

            if (comments.length > 0) {
                const rows = comments.map(c =>
                    commentRepo.create({
                        id: c.id,
                        articleId,
                        authorId: c.authorId,
                        content: c.content,
                        time: c.time
                    })
                );
                // chunk to keep the insert statement size bounded
                const CHUNK = 500;
                for (let i = 0; i < rows.length; i += CHUNK) {
                    await commentRepo.insert(rows.slice(i, i + CHUNK));
                }
            }

            await articleRepo.update({ id: articleId }, { commentsFetchedAt: new Date() });
        });
    }
}
