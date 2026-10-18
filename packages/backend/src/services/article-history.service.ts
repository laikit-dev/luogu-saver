import { ArticleHistory } from '@/entities/article-history';
import { Cacheable } from '@/decorators/cacheable';
import { Article } from '@/entities/article';
import { EntityManager } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import type { ArticleVersionComparison, ArticleVersionMetadata } from '@/shared/archive';
import { parseArchiveArticleId, parseArchiveVersion } from '@/utils/archive-query';

export class ArticleHistoryService {
    public static async listVersionMetadata(
        articleId: string,
        manager?: EntityManager
    ): Promise<{ versions: ArticleVersionMetadata[]; latestVersion: number | null } | null> {
        articleId = parseArchiveArticleId(articleId);
        const rows: { version: number | null; title: string | null; createdAt: Date | null }[] =
            await getServiceRepository<Article>(Article, manager)
                .createQueryBuilder('article')
                .leftJoin(ArticleHistory, 'history', 'history.articleId = article.id')
                .select([
                    'history.version AS version',
                    'history.title AS title',
                    'history.createdAt AS createdAt'
                ])
                .where('article.id = :articleId AND article.deleted = 0', { articleId })
                .orderBy('history.version', 'DESC')
                .getRawMany();
        if (!rows.length) return null;
        const versions = rows
            .filter(row => row.version !== null)
            .map(row => ({
                version: Number(row.version),
                title: row.title!,
                createdAt: row.createdAt!.toISOString()
            }));
        return { versions, latestVersion: versions[0]?.version ?? null };
    }

    public static async compareVersions(
        articleId: string,
        fromVersion: number,
        toVersion: number,
        manager?: EntityManager
    ): Promise<ArticleVersionComparison | null> {
        articleId = parseArchiveArticleId(articleId);
        fromVersion = parseArchiveVersion(fromVersion);
        toVersion = parseArchiveVersion(toVersion);
        if (fromVersion === toVersion) {
            throw Object.assign(new Error('Comparison requires two distinct versions'), {
                status: 400
            });
        }
        const rows: { version: number; title: string; content: string; createdAt: Date }[] =
            await getServiceRepository<ArticleHistory>(ArticleHistory, manager)
                .createQueryBuilder('history')
                .innerJoin(
                    Article,
                    'article',
                    'article.id = history.articleId AND article.deleted = 0'
                )
                .select([
                    'history.version AS version',
                    'history.title AS title',
                    'history.content AS content',
                    'history.createdAt AS createdAt'
                ])
                .where('history.articleId = :articleId AND history.version IN (:...versions)', {
                    articleId,
                    versions: [fromVersion, toVersion]
                })
                .getRawMany();
        const from = rows.find(row => Number(row.version) === fromVersion);
        const to = rows.find(row => Number(row.version) === toVersion);
        if (!from || !to) return null;
        return {
            from: {
                version: fromVersion,
                title: from.title,
                content: from.content,
                createdAt: from.createdAt.toISOString()
            },
            to: {
                version: toVersion,
                title: to.title,
                content: to.content,
                createdAt: to.createdAt.toISOString()
            }
        };
    }

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
