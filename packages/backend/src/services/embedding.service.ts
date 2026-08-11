import { ChromaDataSource } from '@/data-source';
import type { Collection, Metadata } from 'chromadb';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { ArticleService } from '@/services/article.service';
import { runWithConcurrency } from '@/utils/concurrency';
import { llm } from '@/lib/llm';
import type { Article } from '@/entities/article';
import type { TaskEmbeddingRecord } from '@/workers/types';
import { clampInt } from '@/utils/number';

type ChromaWhere = Record<string, any>;

export type ArticleChunk = {
    index: number;
    start: number;
    end: number;
    text: string;
};

export type ArticleVectorCandidate = {
    id: string;
    score: number;
    distance: number;
    vectorId: string;
    vectorKind: 'summary' | 'chunk' | 'unknown';
    chunkIndex?: number;
    chunkStart?: number;
    chunkEnd?: number;
    chunkText?: string;
};

export type ArticleEmbeddingRebuildResult = {
    processed: number;
    updated: number;
    failed: number;
    failedArticleIds: string[];
};

export type EmbeddingDeletionMarkerBackfillResult = {
    skipped: boolean;
    processed: number;
    updated: number;
};

export class EmbeddingService {
    private static _collection: Collection | null = null;
    private static _collectionPromise: Promise<Collection> | null = null;

    private static async getCollection(): Promise<Collection> {
        if (this._collection) return this._collection;

        if (!this._collectionPromise) {
            this._collectionPromise = ChromaDataSource.getOrCreateCollection({
                name: config.chroma.collectionName,
                embeddingFunction: null
            })
                .then(collection => {
                    this._collection = collection;
                    logger.info(
                        { collection: config.chroma.collectionName },
                        'Chroma collection loaded successfully'
                    );
                    return collection;
                })
                .catch(error => {
                    this._collectionPromise = null;
                    logger.error(
                        { error, collection: config.chroma.collectionName },
                        'Failed to get Chroma collection'
                    );
                    throw error;
                });
        }

        return this._collectionPromise;
    }

    static async getVector(articleId: string) {
        if (!config.chroma.enable) return [];
        const collection = await this.getCollection();
        try {
            const targetData = await collection.get({
                ids: [articleId],
                include: ['embeddings']
            });
            if (!targetData || targetData.ids.length === 0) {
                return null;
            }
            return targetData.embeddings[0];
        } catch (error) {
            logger.error({ error, articleId }, `Failed to get vector`);
            return null;
        }
    }

    static async getNearestVectors(embedding: number[], n: number, where?: ChromaWhere) {
        if (!config.chroma.enable) return { ids: [[]], distances: [[]] };
        try {
            if (!embedding || embedding.length === 0) {
                return { ids: [[]], distances: [[]] };
            }
            const collection = await this.getCollection();
            return await collection.query({
                queryEmbeddings: [embedding],
                nResults: n,
                where: where ? { $and: [{ deleted: false }, where] } : { deleted: false },
                include: ['distances', 'documents', 'metadatas']
            });
        } catch (error) {
            logger.error({ error }, 'Failed to get nearest vectors');
            return { ids: [[]], distances: [[]] };
        }
    }

    static async upsertVector(
        id: string,
        metadata: Metadata,
        document: string,
        embedding: number[]
    ) {
        if (!config.chroma.enable) return;
        try {
            const collection = await this.getCollection();
            await collection.upsert({
                ids: [id],
                metadatas: [metadata],
                documents: [document],
                embeddings: [embedding]
            });
            logger.info({ id }, 'Upserted vector to Chroma');
        } catch (error) {
            logger.error({ error, id }, 'Failed to upsert vector');
            throw error;
        }
    }

    static splitArticleContent(content: string): ArticleChunk[] {
        const chars = Array.from(content || '');
        if (chars.length === 0) return [];

        const chunkSize = Math.max(1, config.rag.chunkSize);
        const overlap = Math.min(Math.max(0, config.rag.chunkOverlap), chunkSize - 1);
        const step = chunkSize - overlap;
        const chunks: ArticleChunk[] = [];

        for (let start = 0; start < chars.length; start += step) {
            const end = Math.min(chars.length, start + chunkSize);
            chunks.push({
                index: chunks.length,
                start,
                end,
                text: chars.slice(start, end).join('')
            });
            if (end >= chars.length) break;
        }

        return chunks;
    }

    static async upsertArticleEmbeddings(article: Article, summary?: string): Promise<number> {
        const currentArticle =
            (await ArticleService.getArticleByIdWithoutCache(article.id)) || article;
        const summaryDocument =
            summary?.trim() || currentArticle.summary?.trim() || currentArticle.content;
        const chunks = this.splitArticleContent(currentArticle.content || '');
        const summaryEmbedding = (await llm.embedding(summaryDocument)).embedding;
        const chunkEmbeddings = await Promise.all(
            chunks.map(async chunk => ({
                chunk,
                embedding: (await llm.embedding(chunk.text)).embedding
            }))
        );

        await this.deleteArticleChunkVectors(currentArticle.id);
        await this.upsertVector(
            currentArticle.id,
            this.buildArticleMetadata(currentArticle, {
                articleId: currentArticle.id,
                kind: 'summary'
            }),
            summaryDocument,
            summaryEmbedding
        );

        await this.upsertVectors(
            chunkEmbeddings.map(({ chunk, embedding }) => ({
                id: this.getChunkVectorId(currentArticle.id, chunk.index),
                metadata: this.buildArticleMetadata(currentArticle, {
                    articleId: currentArticle.id,
                    kind: 'chunk',
                    chunkIndex: chunk.index,
                    start: chunk.start,
                    end: chunk.end
                }),
                document: chunk.text,
                embedding
            }))
        );

        const latestArticle = await ArticleService.getArticleByIdWithoutCache(currentArticle.id);
        if (latestArticle && latestArticle.deleted !== currentArticle.deleted) {
            await this.updateArticleDeletionState(latestArticle.id, Boolean(latestArticle.deleted));
        }

        const vectorCount = 1 + chunkEmbeddings.length;
        logger.info(
            { articleId: currentArticle.id, vectorCount, chunkCount: chunkEmbeddings.length },
            'Rebuilt article embeddings'
        );

        return vectorCount;
    }

    static async upsertArticleEmbeddingRecords(
        article: Article,
        records: TaskEmbeddingRecord[]
    ): Promise<number> {
        const currentArticle =
            (await ArticleService.getArticleByIdWithoutCache(article.id)) || article;
        const validRecords = records.filter(
            record =>
                record.document && Array.isArray(record.embedding) && record.embedding.length > 0
        );
        const summaryRecord = validRecords.find(record => record.kind === 'summary');
        const chunkRecords = validRecords.filter(record => record.kind === 'chunk');

        if (!summaryRecord) {
            throw new Error(`Missing summary embedding record for article ${currentArticle.id}`);
        }

        await this.deleteArticleChunkVectors(currentArticle.id);

        const vectorRecords = [
            {
                id: currentArticle.id,
                metadata: this.buildArticleMetadata(currentArticle, {
                    articleId: currentArticle.id,
                    kind: 'summary'
                }),
                document: summaryRecord.document,
                embedding: summaryRecord.embedding
            },
            ...chunkRecords.map((record, index) => {
                const chunkIndex = record.chunkIndex ?? index;
                const chunkMetadata: Metadata = {
                    articleId: currentArticle.id,
                    kind: 'chunk',
                    chunkIndex
                };
                if (record.start !== undefined) chunkMetadata.start = record.start;
                if (record.end !== undefined) chunkMetadata.end = record.end;
                return {
                    id: this.getChunkVectorId(currentArticle.id, chunkIndex),
                    metadata: this.buildArticleMetadata(currentArticle, chunkMetadata),
                    document: record.document,
                    embedding: record.embedding
                };
            })
        ];

        await this.upsertVectors(vectorRecords);
        const latestArticle = await ArticleService.getArticleByIdWithoutCache(currentArticle.id);
        if (latestArticle && latestArticle.deleted !== currentArticle.deleted) {
            await this.updateArticleDeletionState(latestArticle.id, Boolean(latestArticle.deleted));
        }
        logger.info(
            {
                articleId: currentArticle.id,
                vectorCount: vectorRecords.length,
                chunkCount: chunkRecords.length
            },
            'Updated article embeddings from upstream records'
        );
        return vectorRecords.length;
    }

    static async upsertVectors(
        records: { id: string; metadata: Metadata; document: string; embedding: number[] }[]
    ) {
        if (!config.chroma.enable || records.length === 0) return;
        try {
            const collection = await this.getCollection();
            await collection.upsert({
                ids: records.map(record => record.id),
                metadatas: records.map(record => record.metadata),
                documents: records.map(record => record.document),
                embeddings: records.map(record => record.embedding)
            });
            logger.info({ count: records.length }, 'Upserted vectors to Chroma');
        } catch (error) {
            logger.error({ error }, 'Failed to upsert vectors');
            throw error;
        }
    }

    static async updateArticleDeletionState(articleId: string, deleted: boolean): Promise<number> {
        if (!config.chroma.enable) return 0;

        const collection = await this.getCollection();
        const batchSize = 500;
        let offset = 0;
        let vectorCount = 0;
        const records = new Map<string, Metadata>();

        while (true) {
            const result = await collection.get({
                where: { articleId },
                offset,
                limit: batchSize,
                include: ['metadatas']
            });
            if (!result.ids.length) break;

            result.ids.forEach((id, index) => {
                records.set(id, {
                    ...(result.metadatas?.[index] || {}),
                    deleted
                });
            });
            offset += result.ids.length;
            if (result.ids.length < batchSize) break;
        }

        const legacySummary = await collection.get({ ids: [articleId], include: ['metadatas'] });
        legacySummary.ids.forEach((id, index) => {
            records.set(id, {
                ...(legacySummary.metadatas?.[index] || {}),
                articleId,
                deleted
            });
        });

        if (records.size > 0) {
            await collection.update({
                ids: [...records.keys()],
                metadatas: [...records.values()]
            });
            vectorCount = records.size;
        }

        logger.info({ articleId, deleted, vectorCount }, 'Updated article vector deletion markers');
        return vectorCount;
    }

    static async backfillArticleDeletionMarkers(
        batchSize: number = 100
    ): Promise<EmbeddingDeletionMarkerBackfillResult> {
        if (!config.chroma.enable) return { skipped: true, processed: 0, updated: 0 };

        const normalizedBatchSize = clampInt(batchSize, 100, 1, 1000);
        const collection = await this.getCollection();
        const total = await collection.count();
        let offset = 0;
        let processed = 0;
        let updated = 0;

        while (offset < total) {
            const result = await collection.get({
                offset,
                limit: normalizedBatchSize,
                include: ['metadatas']
            });
            if (!result.ids.length) break;

            const articleIds = result.ids.map((vectorId, index) =>
                this.extractArticleId(vectorId, result.metadatas?.[index] || {})
            );
            const deletionStates = await ArticleService.getArticleDeletionStates(articleIds);
            await collection.update({
                ids: result.ids,
                metadatas: result.ids.map((_, index) => ({
                    ...(result.metadatas?.[index] || {}),
                    articleId: articleIds[index],
                    deleted: deletionStates.get(articleIds[index]) ?? true
                }))
            });

            processed += result.ids.length;
            updated += result.ids.length;
            offset += result.ids.length;
        }

        logger.info({ processed, updated }, 'Backfilled Chroma article deletion markers');
        return { skipped: false, processed, updated };
    }

    static async deleteArticleChunkVectors(articleId: string) {
        if (!config.chroma.enable) return;
        try {
            const collection = await this.getCollection();
            await collection.delete({
                where: {
                    $and: [{ articleId }, { kind: 'chunk' }]
                }
            });
        } catch (error) {
            logger.warn({ error, articleId }, 'Failed to delete article chunk vectors');
        }
    }

    static async getNearestArticleCandidates(
        embedding: number[],
        distinctArticleLimit: number = config.rag.candidateArticleLimit,
        rawVectorLimit: number = config.rag.rawVectorResultLimit
    ): Promise<ArticleVectorCandidate[]> {
        const result = await this.getNearestVectors(embedding, rawVectorLimit);
        const ids = result.ids?.[0] || [];
        const distances = result.distances?.[0] || [];
        const metadatas = 'metadatas' in result ? result.metadatas?.[0] || [] : [];
        const documents = 'documents' in result ? result.documents?.[0] || [] : [];
        const candidates = new Map<string, ArticleVectorCandidate>();

        ids.forEach((vectorId, index) => {
            const metadata = metadatas[index] || {};
            const distance = Number(distances[index] ?? 1);
            const score = Math.max(0, 1 - distance);
            const articleId = this.extractArticleId(vectorId, metadata);
            if (!articleId) return;

            const candidate: ArticleVectorCandidate = {
                id: articleId,
                score,
                distance,
                vectorId,
                vectorKind: this.normalizeVectorKind(metadata.kind),
                chunkIndex: this.toOptionalNumber(metadata.chunkIndex),
                chunkStart: this.toOptionalNumber(metadata.start),
                chunkEnd: this.toOptionalNumber(metadata.end),
                chunkText: documents[index] || undefined
            };

            const current = candidates.get(articleId);
            if (!current || candidate.score > current.score) {
                candidates.set(articleId, candidate);
            }
        });

        return [...candidates.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, distinctArticleLimit);
    }

    static async rebuildArticleEmbeddings(
        batchSize: number = 20,
        concurrency: number = 5
    ): Promise<ArticleEmbeddingRebuildResult> {
        const failedArticleIds: string[] = [];
        let processed = 0;
        let updated = 0;
        let afterId: string | null = null;

        while (true) {
            const articles = await ArticleService.getArticlesForEmbeddingRebuild(
                afterId,
                batchSize
            );
            if (articles.length === 0) break;
            afterId = articles[articles.length - 1].id;

            await runWithConcurrency(articles, concurrency, async article => {
                processed += 1;
                try {
                    await this.upsertArticleEmbeddings(article);
                    updated += 1;
                } catch (error) {
                    failedArticleIds.push(article.id);
                    logger.error(
                        { error, articleId: article.id },
                        'Failed to rebuild article embedding'
                    );
                }
            });
        }

        return {
            processed,
            updated,
            failed: failedArticleIds.length,
            failedArticleIds
        };
    }

    private static getChunkVectorId(articleId: string, index: number) {
        return `${articleId}:chunk:${index}`;
    }

    private static buildArticleMetadata(article: Article, metadata: Metadata): Metadata {
        return {
            title: article.title,
            authorId: article.authorId,
            category: article.category,
            tags: article.tags.join(','),
            ...metadata,
            deleted: Boolean(article.deleted)
        };
    }

    private static extractArticleId(vectorId: string, metadata: Metadata) {
        const metadataArticleId = metadata.articleId;
        if (typeof metadataArticleId === 'string' && metadataArticleId) return metadataArticleId;
        const chunkIndex = vectorId.indexOf(':chunk:');
        if (chunkIndex >= 0) return vectorId.slice(0, chunkIndex);
        return vectorId;
    }

    private static normalizeVectorKind(value: Metadata[string]): 'summary' | 'chunk' | 'unknown' {
        if (value === 'summary' || value === 'chunk') return value;
        return 'unknown';
    }

    private static toOptionalNumber(value: Metadata[string]) {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : undefined;
    }
}
