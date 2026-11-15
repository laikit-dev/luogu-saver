import { EntityManager } from 'typeorm';

import { Article } from '@/entities/article';
import { ArticleComment } from '@/entities/article-comment';
import { getServiceRepository } from '@/services/helpers/repository.helper';

const COMMENTS_TTL_MS = 6 * 60 * 60 * 1000;

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
            order: { time: 'ASC' }
        });
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
