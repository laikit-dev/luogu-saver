import { ArticleHistory } from '@/entities/article-history';
import { Cacheable } from '@/decorators/cacheable';
import { Article } from '@/entities/article';
import { EntityManager } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';

export class ArticleHistoryService {
    /**
     * Append a history version within the caller-owned transaction.
     * The transaction owner must evict the history cache after committing.
     */
    public static async pushNewVersion(
        articleId: string,
        title: string,
        content: string,
        manager: EntityManager
    ): Promise<void> {
        await getServiceRepository<Article>(Article, manager).findOne({
            where: { id: articleId },
            select: ['id'],
            lock: { mode: 'pessimistic_write' }
        });

        const repository = getServiceRepository<ArticleHistory>(ArticleHistory, manager);
        const latestHistory = await repository.findOne({
            where: { articleId },
            order: { version: 'DESC' },
            select: ['version']
        });
        const newVersion = latestHistory ? latestHistory.version + 1 : 1;
        const newHistory = repository.create({
            articleId,
            version: newVersion,
            title,
            content
        });
        await repository.save(newHistory);
    }

    /*
     * Get the history of an article by its ID
     *
     * Result will be cached for 10 minutes
     *
     * @param articleId - The ID of the article
     * @returns An array of ArticleHistory entries
     */
    @Cacheable(600, (articleId: string) => `article_history:${articleId}`, ArticleHistory)
    public static async getHistoryByArticleId(
        articleId: string,
        manager?: EntityManager
    ): Promise<ArticleHistory[]> {
        return await getServiceRepository<ArticleHistory>(ArticleHistory, manager).find({
            where: { articleId },
            order: { version: 'ASC' }
        });
    }
}
