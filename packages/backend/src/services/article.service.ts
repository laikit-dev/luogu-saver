import { Cacheable } from '@/decorators/cacheable';
import { CacheEvict, evictCache } from '@/decorators/cache-evict';
import { Article } from '@/entities/article';
import { EntityManager, In, MoreThan } from 'typeorm';
import { ArticleHistoryService } from './article-history.service';
import { ArticleCategory } from '@/shared/article';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { markContentChecked, saveHashedContent } from '@/services/helpers/hashed-content.helper';
import { backfillPublishTime, normalizePublishTime } from '@/services/helpers/publish-time.helper';
import type { Article as LuoguArticle } from '@/types/luogu-api';
import { retryOnTransactionConflict } from '@/utils/db-errors';
import { logger } from '@/lib/logger';
import type { User } from '@/entities/user';
import { sampleWithoutReplacement } from '@/utils/array';

export type RecommendationArticleRow = {
    id: string;
    title: string;
    category: ArticleCategory;
    updatedAt: Date;
    tags: string[];
    summary?: string | null;
    contentPreview: string;
    author?: User;
};

const RECENT_ID_POOL_SIZE = 3000;

export class ArticleService {
    /*
     * Get article by ID.
     *
     * Result will be cached for 10 minutes.
     *
     * @param id Article ID
     * @return Article or null if not found
     */
    @Cacheable(600, id => `article:${id}`, Article)
    static async getArticleById(id: string, manager?: EntityManager): Promise<Article | null> {
        return await this.getArticleByIdWithoutCache(id, manager);
    }

    static async getArticleByIdWithoutCache(
        id: string,
        manager?: EntityManager
    ): Promise<Article | null> {
        return await getServiceRepository<Article>(Article, manager).findOne({
            where: { id },
            relations: ['author']
        });
    }

    /*
     * Get recent articles ordered by priority and updatedAt.
     *
     * Result will be cached for 10 minutes.
     *
     * @param count Number of articles to retrieve
     * @param updatedAfter Optional date to filter articles updated after this date
     * @return List of recent articles
     */
    @Cacheable(
        600,
        (count, after) => `article:recent:${count}:${after ? after.getTime() : 'all'}`,
        Article
    )
    static async getRecentArticles(
        count: number = 20,
        updatedAfter?: Date,
        manager?: EntityManager
    ): Promise<Article[]> {
        return await getServiceRepository<Article>(Article, manager).find({
            where: {
                deleted: false,
                updatedAt: updatedAfter ? MoreThan(updatedAfter) : undefined
            },
            order: {
                priority: 'DESC',
                updatedAt: 'DESC'
            },
            take: count,
            relations: ['author']
        });
    }

    /*
     * Get total count of non-deleted articles.
     *
     * Result will be cached for 10 minutes.
     *
     * @return Total article count
     */
    @Cacheable(600, () => 'article:count')
    static async getArticleCount(manager?: EntityManager): Promise<number> {
        return await getServiceRepository<Article>(Article, manager).count({
            where: { deleted: false }
        });
    }

    private static async getTopArticleIdsByMetric(
        metricColumn: 'viewCount' | 'upvote' | 'favorCount',
        limit: number,
        manager?: EntityManager
    ): Promise<string[]> {
        const rows = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select('article.id', 'id')
            .where('article.deleted = :deleted', { deleted: false })
            .orderBy(`article.${metricColumn}`, 'DESC')
            .addOrderBy('article.id', 'DESC')
            .limit(limit)
            .getRawMany<{ id: string }>();
        return rows.map(row => row.id);
    }

    /**
     * Computes hot article IDs via indexed top-K scans over view_count, upvote, and favor_count
     * rather than a full-table filesort on an unindexed arithmetic expression.
     */
    @Cacheable(300, (count = 200) => `article:recommendation:hot:${count}`)
    static async getHotArticleIds(count: number = 200, manager?: EntityManager): Promise<string[]> {
        if (count <= 0) return [];
        const perMetricLimit = Math.max(count * 2, 200);
        const [byView, byUpvote, byFavor, recentTieBreak] = await Promise.all([
            this.getTopArticleIdsByMetric('viewCount', perMetricLimit, manager),
            this.getTopArticleIdsByMetric('upvote', perMetricLimit, manager),
            this.getTopArticleIdsByMetric('favorCount', perMetricLimit, manager),
            manager
                ? this.getRecentArticleIdsWithoutCache(count, manager)
                : this.getRecentArticleIdPool().then(pool => pool.slice(0, count))
        ]);

        const candidateIds = [...new Set([...byView, ...byUpvote, ...byFavor, ...recentTieBreak])];
        if (candidateIds.length === 0) return [];

        const candidates = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select([
                'article.id',
                'article.viewCount',
                'article.upvote',
                'article.favorCount',
                'article.updatedAt'
            ])
            .where('article.id IN (:...candidateIds)', { candidateIds })
            .andWhere('article.deleted = :deleted', { deleted: false })
            .getMany();

        candidates.sort((a, b) => {
            const scoreDiff =
                b.viewCount +
                b.upvote * 3 +
                b.favorCount * 5 -
                (a.viewCount + a.upvote * 3 + a.favorCount * 5);
            if (scoreDiff !== 0) return scoreDiff;
            const timeDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
        });

        return candidates.slice(0, count).map(article => article.id);
    }

    /** Increments `view_count` for a non-deleted article without advancing `updated_at`. */
    static async incrementViewCount(id: string, manager?: EntityManager): Promise<void> {
        try {
            const repo = getServiceRepository<Article>(Article, manager);
            const values: Record<string, () => string> = {
                viewCount: () => 'view_count + 1'
            };
            const updateDateColumn = repo.metadata.updateDateColumn;
            if (updateDateColumn) {
                // Assigning the update date column to itself prevents MariaDB from advancing
                // `updated_at` on a view-count increment.
                const column = repo.manager.connection.driver.escape(updateDateColumn.databaseName);
                values[updateDateColumn.propertyName] = () => column;
            }
            await repo
                .createQueryBuilder()
                .update(Article)
                .set(values)
                .where('id = :id', { id })
                .andWhere('deleted = :deleted', { deleted: false })
                .execute();
        } catch (error) {
            logger.error({ error, articleId: id }, 'Failed to increment article view count');
        }
    }

    /*
     * Get recent articles without caching
     *
     * Result will not be cached
     *
     * @param count Number of articles to retrieve
     * @return List of recent articles
     */
    static async getRecentArticlesWithoutCache(
        count: number = 10,
        manager?: EntityManager
    ): Promise<Article[]> {
        return await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .where('article.deleted = :deleted', { deleted: false })
            .orderBy('article.updatedAt', 'DESC')
            .limit(count)
            .getMany();
    }

    static async getRecentArticleIdsWithoutCache(
        count: number = 10,
        manager?: EntityManager
    ): Promise<string[]> {
        const rows = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select('article.id', 'id')
            .where('article.deleted = :deleted', { deleted: false })
            .orderBy('article.updatedAt', 'DESC')
            .addOrderBy('article.id', 'DESC')
            .limit(count)
            .getRawMany<{ id: string }>();
        return rows.map(row => row.id);
    }

    @Cacheable(60, () => `article:recommendation:recent_pool:${RECENT_ID_POOL_SIZE}`)
    static async getRecentArticleIdPool(): Promise<string[]> {
        return this.getRecentArticleIdsWithoutCache(RECENT_ID_POOL_SIZE);
    }

    static async getRecentArticleIds(count: number = 10): Promise<string[]> {
        if (count <= RECENT_ID_POOL_SIZE) {
            return (await this.getRecentArticleIdPool()).slice(0, count);
        }
        return this.getRecentArticleIdsWithoutCache(count);
    }

    /** Unbiased partial Fisher-Yates sampling without replacement. */
    static sampleArticleIds(
        pool: readonly string[],
        count: number,
        exclude?: ReadonlySet<string>
    ): string[] {
        return sampleWithoutReplacement(pool, count, exclude);
    }
    static async getArticlesForSearchReindex(
        afterUpdatedAt: Date | null,
        afterId: string | null,
        take: number,
        manager?: EntityManager
    ): Promise<Article[]> {
        const query = getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .leftJoinAndSelect('article.author', 'author')
            .orderBy('article.updatedAt', 'ASC')
            .addOrderBy('article.id', 'ASC')
            .take(take);

        if (afterUpdatedAt && afterId) {
            query.andWhere(
                '(article.updatedAt > :afterUpdatedAt OR (article.updatedAt = :afterUpdatedAt AND article.id > :afterId))',
                { afterUpdatedAt, afterId }
            );
        }
        return await query.getMany();
    }

    /** `LENGTH(title) + LENGTH(content)` in bytes of the existing articles among `ids`, by ID. */
    static async getArticleTextLengths(
        ids: string[],
        manager?: EntityManager
    ): Promise<Array<{ id: string; length: number }>> {
        if (ids.length === 0) return [];
        const rows = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select('article.id', 'id')
            .addSelect('LENGTH(article.title) + LENGTH(article.content)', 'length')
            .where('article.id IN (:...ids)', { ids })
            .orderBy('article.id', 'ASC')
            .getRawMany<{ id: string; length: number | string }>();
        return rows.map(row => ({ id: row.id, length: Number(row.length) }));
    }

    /** Articles among `ids`, including soft-deleted ones, with the `author` relation. */
    static async getArticlesForSearchIndex(
        ids: string[],
        manager?: EntityManager
    ): Promise<Article[]> {
        if (ids.length === 0) return [];
        return await getServiceRepository<Article>(Article, manager).find({
            where: { id: In(ids) },
            relations: ['author']
        });
    }

    static async getArticleDeletionStates(
        ids: string[],
        manager?: EntityManager
    ): Promise<Map<string, boolean>> {
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        if (uniqueIds.length === 0) return new Map();

        const articles = await getServiceRepository<Article>(Article, manager).find({
            select: ['id', 'deleted'],
            where: { id: In(uniqueIds) }
        });
        return new Map(articles.map(article => [article.id, Boolean(article.deleted)]));
    }

    static async getArticlesForContentRebuild(
        afterId: string | null,
        take: number,
        manager?: EntityManager
    ): Promise<Article[]> {
        const query = getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .leftJoinAndSelect('article.author', 'author')
            .where('article.deleted = :deleted', { deleted: false })
            .orderBy('article.id', 'ASC')
            .take(take);

        if (afterId) {
            query.andWhere('article.id > :afterId', { afterId });
        }

        return await query.getMany();
    }

    static async getRandomArticleIds(
        count: number = 10,
        exclude?: ReadonlySet<string>
    ): Promise<string[]> {
        const recentIds = await this.getRecentArticleIdPool();
        return this.sampleArticleIds(recentIds, count, exclude);
    }

    /*
     * Get articles by a list of IDs
     *
     * Result will not be cached
     *
     * @param ids List of article IDs
     * @return List of articles matching the IDs
     */
    static async getArticlesByIds(ids: string[], manager?: EntityManager) {
        if (!ids || ids.length === 0) return [];

        const articles = await getServiceRepository<Article>(Article, manager).find({
            where: { id: In(ids), deleted: false },
            relations: ['author']
        });
        const articleMap = new Map(articles.map(a => [a.id, a]));
        return ids.map(id => articleMap.get(id)).filter(article => !!article);
    }

    /**
     * Loads recommendation card fields without transferring full `mediumtext` `content`.
     * Preserves input ID order and omits deleted rows.
     */
    static async getRecommendationArticlesByIds(
        ids: string[],
        manager?: EntityManager
    ): Promise<RecommendationArticleRow[]> {
        if (!ids || ids.length === 0) return [];

        const { entities, raw } = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .leftJoinAndSelect('article.author', 'author')
            .select([
                'article.id',
                'article.title',
                'article.category',
                'article.updatedAt',
                'article.tags',
                'article.summary',
                'article.authorId',
                'author'
            ])
            .addSelect(
                "CASE WHEN article.summary IS NOT NULL AND article.summary != '' THEN '' ELSE LEFT(article.content, 200) END",
                'contentPreview'
            )
            .where('article.id IN (:...ids)', { ids })
            .andWhere('article.deleted = :deleted', { deleted: false })
            .getRawAndEntities();

        const previewById = new Map<string, string>();
        for (const row of raw) {
            const rowId = row.article_id ?? row.id;
            if (typeof rowId === 'string' && !previewById.has(rowId)) {
                previewById.set(
                    rowId,
                    typeof row.contentPreview === 'string' ? row.contentPreview : ''
                );
            }
        }

        const articleMap = new Map<string, RecommendationArticleRow>();
        for (const article of entities) {
            articleMap.set(article.id, {
                id: article.id,
                title: article.title,
                category: article.category,
                updatedAt: article.updatedAt,
                tags: article.tags,
                summary: article.summary,
                contentPreview: previewById.get(article.id) ?? '',
                author: article.author
            });
        }

        return ids
            .map(id => articleMap.get(id))
            .filter((row): row is RecommendationArticleRow => row !== undefined);
    }
    /*
     * Get articles by author ID
     *
     * Result will not be cached
     *
     * @param authorId Author ID
     * @return List of articles by the author
     */
    static async getArticlesByAuthor(authorId: number, manager?: EntityManager) {
        return await getServiceRepository<Article>(Article, manager).find({
            where: { authorId: authorId, deleted: false },
            relations: ['author']
        });
    }

    static async getArticleTitlesByAuthor(
        authorId: number,
        manager?: EntityManager
    ): Promise<Array<{ id: string; title: string }>> {
        return await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select(['article.id', 'article.title'])
            .where('article.authorId = :authorId', { authorId })
            .andWhere('article.deleted = :deleted', { deleted: false })
            .getMany();
    }

    static async getArticleTitlesByIds(
        ids: string[],
        manager?: EntityManager
    ): Promise<Map<string, string>> {
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        if (uniqueIds.length === 0) return new Map();
        const rows = await getServiceRepository<Article>(Article, manager)
            .createQueryBuilder('article')
            .select(['article.id', 'article.title'])
            .where('article.id IN (:...ids)', { ids: uniqueIds })
            .andWhere('article.deleted = :deleted', { deleted: false })
            .getMany();
        const titleById = new Map<string, string>();
        for (const row of rows) {
            titleById.set(row.id, row.title);
        }
        return titleById;
    }

    /*
     * Save an article
     *
     * Will evict cache for the specific article ID
     *
     * @param article Article to save
     */
    @CacheEvict((article: Article) => [`article:${article.id}`, `article:count`])
    static async saveArticle(article: Article, manager?: EntityManager) {
        await getServiceRepository<Article>(Article, manager).save(article);
    }

    @CacheEvict((article: LuoguArticle) => [`article:${article.lid}`, `article:count`])
    static async saveLuoguArticle(
        data: LuoguArticle,
        forceUpdate: boolean = false
    ): Promise<{ skipped: boolean; content: string }> {
        const publishTime = normalizePublishTime(data.time);
        const result = await retryOnTransactionConflict(() =>
            Article.transaction(async manager => {
                const checkedAt = new Date();
                const saveResult = await saveHashedContent<Article>({
                    manager,
                    entity: Article,
                    id: data.lid,
                    content: data.content,
                    forceUpdate,
                    incomingData: {
                        title: data.title,
                        authorId: data.author.uid,
                        category: data.category as ArticleCategory,
                        solutionForPid: data.solutionFor?.pid,
                        upvote: data.upvote,
                        favorCount: data.favorCount,
                        checkedAt,
                        // Omitted rather than written as null: an unusable `time` must not
                        // erase a publish time an earlier payload already delivered.
                        ...(publishTime === null ? {} : { publishTime })
                    },
                    defaults: {
                        deleted: false,
                        viewCount: 0,
                        tags: [],
                        priority: 0
                    },
                    comparisonFields: ['title'],
                    isUnchanged: (article, hash) =>
                        article.title === data.title && article.contentHash === hash
                });

                if (saveResult.skipped) {
                    await backfillPublishTime(manager, Article, data.lid, data.time);
                    await markContentChecked(manager, Article, data.lid, checkedAt);
                    return { skipped: true, content: '' };
                }

                const article = saveResult.entity;
                await ArticleHistoryService.pushNewVersion(
                    article.id,
                    article.title,
                    article.content,
                    manager,
                    checkedAt
                );

                return { skipped: false, content: article.content };
            })
        );

        if (!result.skipped) {
            await evictCache(`article_history:${data.lid}`);
        }
        return result;
    }
}
