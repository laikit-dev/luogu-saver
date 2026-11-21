import { config } from '@/config';
import { Article } from '@/entities/article';
import { ArticleService } from '@/services/article.service';
import { logger } from '@/lib/logger';
import { clampInt } from '@/utils/number';

type DynamicImport = (specifier: string) => Promise<any>;
type MeilisearchConstructor = new (options: {
    host: string;
    apiKey?: string;
    timeout?: number;
}) => any;

// Keep the ESM-only Meilisearch client outside TypeScript's CommonJS import transform.
const importEsm = new Function('specifier', 'return import(specifier)') as DynamicImport;

type SearchParams = {
    page?: number;
    hitsPerPage?: number;
    filter?: string[];
    attributesToRetrieve?: string[];
    attributesToHighlight?: string[];
    highlightPreTag?: string;
    highlightPostTag?: string;
    sort?: string[];
};

export type ArticleSearchDocument = {
    id: string;
    title: string;
    content: string;
    summary: string;
    authorId: number;
    authorName: string;
    category: number;
    tags: string[];
    updatedAt: number;
    viewCount: number;
    priority: number;
    deleted: boolean;
};

export type DeletionMarkerBackfillResult = {
    skipped: boolean;
    processed: number;
    updated: number;
};

type SearchArticlesParams = {
    q?: string;
    page?: number;
    limit?: number;
    category?: number;
    authorId?: number;
};

type SearchArticlesResult = {
    hits: (Omit<ArticleSearchDocument, 'content' | 'deleted'> & {
        formatted?: Partial<ArticleSearchDocument>;
    })[];
    page: number;
    limit: number;
    total: number;
    processingTimeMs: number;
};

const SUMMARY_LIMIT = 220;
const FORMATTED_SUMMARY_LIMIT = 260;

export class SearchService {
    private static client: any = null;
    private static meilisearchConstructor: MeilisearchConstructor | null = null;
    private static articleIndexReady: Promise<void> | null = null;

    private static get enabled() {
        return config.meilisearch.enable;
    }

    private static async getMeilisearchConstructor(): Promise<MeilisearchConstructor> {
        if (!this.meilisearchConstructor) {
            const module = await importEsm('meilisearch');
            this.meilisearchConstructor = module.Meilisearch;
        }
        return this.meilisearchConstructor!;
    }

    private static async getClient() {
        if (!this.client) {
            const Meilisearch = await this.getMeilisearchConstructor();
            this.client = new Meilisearch({
                host: config.meilisearch.host,
                apiKey: config.meilisearch.apiKey || undefined,
                timeout: config.network.timeout
            });
        }
        return this.client;
    }

    private static async getArticleIndex() {
        const client = await this.getClient();
        return client.index(config.meilisearch.articleIndexName);
    }

    static async ensureArticleIndex(): Promise<void> {
        if (!this.enabled) return;
        if (this.articleIndexReady) return this.articleIndexReady;

        this.articleIndexReady = this.ensureArticleIndexInternal().catch(error => {
            this.articleIndexReady = null;
            throw error;
        });
        return this.articleIndexReady;
    }

    private static async ensureArticleIndexInternal(): Promise<void> {
        const client = await this.getClient();
        const indexName = config.meilisearch.articleIndexName;

        try {
            await client.getIndex(indexName);
        } catch {
            await client.createIndex(indexName, { primaryKey: 'id' });
        }

        const index = await this.getArticleIndex();
        const waitOptions = { timeout: config.network.timeout, interval: 100 };
        await Promise.all([
            index
                .updateSearchableAttributes(['title', 'summary', 'content', 'authorName', 'tags'])
                .waitTask(waitOptions),
            index
                .updateFilterableAttributes(['category', 'authorId', 'tags', 'deleted'])
                .waitTask(waitOptions),
            index
                .updateSortableAttributes(['updatedAt', 'viewCount', 'priority'])
                .waitTask(waitOptions)
        ]);
    }

    private static toDocument(article: Article): ArticleSearchDocument {
        return {
            id: article.id,
            title: article.title,
            content: article.content,
            summary: article.summary || '',
            authorId: article.authorId,
            authorName: article.author?.name || '',
            category: article.category,
            tags: article.tags || [],
            updatedAt: article.updatedAt.getTime(),
            viewCount: article.viewCount,
            priority: article.priority,
            deleted: Boolean(article.deleted)
        };
    }

    private static truncateText(text: string, maxCodePoints: number): string {
        const codePoints = Array.from(text || '');
        if (codePoints.length <= maxCodePoints) return text || '';
        return `${codePoints.slice(0, maxCodePoints).join('')}...`;
    }

    private static truncateMarkedText(text: string, maxCodePoints: number): string {
        let visible = 0;
        let output = '';
        const stack: string[] = [];

        for (let index = 0; index < text.length; ) {
            if (text.startsWith('<mark>', index)) {
                output += '<mark>';
                stack.push('mark');
                index += '<mark>'.length;
                continue;
            }
            if (text.startsWith('</mark>', index)) {
                output += '</mark>';
                stack.pop();
                index += '</mark>'.length;
                continue;
            }

            const char = Array.from(text.slice(index))[0];
            if (!char) break;
            if (visible >= maxCodePoints) {
                while (stack.pop()) output += '</mark>';
                return `${output}...`;
            }

            output += char;
            visible += 1;
            index += char.length;
        }

        return output;
    }

    static async upsertArticleById(
        articleId: string
    ): Promise<{ exists: boolean; indexed: boolean }> {
        const currentArticle = await ArticleService.getArticleByIdWithoutCache(articleId);
        if (!currentArticle) return { exists: false, indexed: false };
        if (!this.enabled) return { exists: true, indexed: false };
        await this.ensureArticleIndex();

        const index = await this.getArticleIndex();
        await index
            .addDocuments([this.toDocument(currentArticle)], { primaryKey: 'id' })
            .waitTask({ timeout: config.network.timeout, interval: 100 });

        // A deletion can commit while the Meilisearch task is queued. Re-read the flag and
        // repair the document when that race occurs.
        const latestArticle = await ArticleService.getArticleByIdWithoutCache(articleId);
        if (latestArticle && latestArticle.deleted !== currentArticle.deleted) {
            await index
                .addDocuments([this.toDocument(latestArticle)], { primaryKey: 'id' })
                .waitTask({ timeout: config.network.timeout, interval: 100 });
        }
        return { exists: true, indexed: true };
    }

    static async reindexArticles(batchSize: number = 100): Promise<number> {
        if (!this.enabled) return 0;
        await this.ensureArticleIndex();

        const index = await this.getArticleIndex();
        let indexed = 0;
        let afterUpdatedAt: Date | null = null;
        let afterId: string | null = null;

        while (true) {
            const articles = await ArticleService.getArticlesForSearchReindex(
                afterUpdatedAt,
                afterId,
                batchSize
            );
            if (articles.length === 0) break;

            await index
                .addDocuments(
                    articles.map(article => this.toDocument(article)),
                    {
                        primaryKey: 'id'
                    }
                )
                .waitTask({ timeout: config.network.timeout, interval: 100 });
            indexed += articles.length;
            const lastArticle = articles[articles.length - 1];
            afterUpdatedAt = lastArticle.updatedAt;
            afterId = lastArticle.id;
        }

        logger.info({ indexed }, 'Reindexed articles into Meilisearch');
        return indexed;
    }

    static async backfillArticleDeletionMarkers(
        batchSize: number = 100
    ): Promise<DeletionMarkerBackfillResult> {
        if (!this.enabled) return { skipped: true, processed: 0, updated: 0 };

        const normalizedBatchSize = clampInt(batchSize, 100, 1, 1000);
        await this.ensureArticleIndex();
        const index = await this.getArticleIndex();
        const waitOptions = { timeout: config.network.timeout, interval: 100 };
        let offset = 0;
        let processed = 0;
        let updated = 0;

        while (true) {
            const result = await index.getDocuments({
                offset,
                limit: normalizedBatchSize,
                fields: ['id']
            });
            const documents = (result.results || [])
                .map((document: { id?: unknown }) => ({ id: String(document.id || '').trim() }))
                .filter((document: { id: string }) => Boolean(document.id));
            if (documents.length === 0) break;

            const deletionStates = await ArticleService.getArticleDeletionStates(
                documents.map((document: { id: string }) => document.id)
            );
            const updates = documents.map((document: { id: string }) => ({
                id: document.id,
                deleted: deletionStates.get(document.id) ?? true
            }));
            await index.updateDocuments(updates, { primaryKey: 'id' }).waitTask(waitOptions);

            processed += documents.length;
            updated += updates.length;
            offset += documents.length;
            if (offset >= Number(result.total || 0)) break;
        }

        logger.info({ processed, updated }, 'Backfilled Meilisearch article deletion markers');
        return { skipped: false, processed, updated };
    }

    static async searchArticles(params: SearchArticlesParams): Promise<SearchArticlesResult> {
        const page = clampInt(params.page, 1, 1, Number.MAX_SAFE_INTEGER);
        const limit = clampInt(params.limit, 10, 1, 50);

        if (!this.enabled) {
            return { hits: [], page, limit, total: 0, processingTimeMs: 0 };
        }

        await this.ensureArticleIndex();

        const filter: string[] = ['deleted = false'];
        if (params.category !== undefined) filter.push(`category = ${params.category}`);
        if (params.authorId !== undefined) filter.push(`authorId = ${params.authorId}`);

        const searchParams: SearchParams = {
            page,
            hitsPerPage: limit,
            filter: filter.length ? filter : undefined,
            attributesToRetrieve: [
                'id',
                'title',
                'summary',
                'authorId',
                'authorName',
                'category',
                'tags',
                'updatedAt',
                'viewCount',
                'priority'
            ],
            attributesToHighlight: ['title', 'summary', 'authorName'],
            highlightPreTag: '<mark>',
            highlightPostTag: '</mark>'
        };

        const q = (params.q || '').trim();
        if (!q) searchParams.sort = ['updatedAt:desc'];

        const index = await this.getArticleIndex();
        const result = await index.search(q, searchParams);
        return {
            hits: result.hits.map(
                (hit: ArticleSearchDocument & { _formatted?: Partial<ArticleSearchDocument> }) => {
                    const { _formatted, ...rest } = hit as ArticleSearchDocument & {
                        _formatted?: Partial<ArticleSearchDocument>;
                    };
                    delete (rest as Partial<ArticleSearchDocument>).content;
                    return {
                        ...rest,
                        summary: this.truncateText(rest.summary, SUMMARY_LIMIT),
                        formatted: _formatted
                            ? {
                                  ..._formatted,
                                  summary: _formatted.summary
                                      ? this.truncateMarkedText(
                                            _formatted.summary,
                                            FORMATTED_SUMMARY_LIMIT
                                        )
                                      : undefined
                              }
                            : undefined
                    };
                }
            ),
            page,
            limit,
            total: result.totalHits || 0,
            processingTimeMs: result.processingTimeMs
        };
    }
}
