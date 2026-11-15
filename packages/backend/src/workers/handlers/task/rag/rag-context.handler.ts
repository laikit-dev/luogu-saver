import { Job, UnrecoverableError } from 'bullmq';
import type {
    ChildrenValues,
    RagTask,
    TaskCommonResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { ArticleService } from '@/services/article.service';
import { clampInt } from '@/utils/number';
import { llm } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import { Article } from '@/entities/article';

type MergedHit = {
    id: string;
    score: number;
    keywordScore?: number;
    vectorScore?: number;
    rerankScore?: number;
    keywordRank?: number;
    vectorDistance?: number;
    chunkText?: string;
    chunkIndex?: number;
    sources: string[];
    queries: string[];
};

type RagDocument = {
    id: string;
    title: string;
    summary: string;
    excerpt: string;
    authorName: string;
    score: number;
    sources: string[];
    queries: string[];
    vectorDistance?: number;
    keywordScore?: number;
    vectorScore?: number;
    rerankScore?: number;
    chunkText?: string;
    chunkIndex?: number;
};

export class RagContextHandler implements TaskHandler<RagTask> {
    public taskType = 'rag:context';

    public async handle(
        task: RagTask,
        job: Job<RagTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        const question = this.extractQuestion(childrenValues, task.payload.query);
        if (!question)
            throw new UnrecoverableError(`No question found for rag context job ${job.id}`);

        const maxArticles = clampInt(task.payload.metadata?.maxArticles, 10, 1, 10);
        const maxChars = clampInt(task.payload.metadata?.maxChars, 20000, 1000, 20000);
        const forcedArticleIds = this.normalizeArticleIds(task.payload.metadata?.articleIds);
        const documents: RagDocument[] = [];
        const includedIds = new Set<string>();

        const mergedResult = await this.mergeHits(question, childrenValues, forcedArticleIds);

        for (const articleId of forcedArticleIds) {
            if (documents.length >= maxArticles) break;
            const document = this.loadArticleDocument(
                articleId,
                {
                    score: 100,
                    sources: ['knowledge-base'],
                    queries: []
                },
                mergedResult.articles
            );
            if (!document) continue;
            documents.push(document);
            includedIds.add(document.id);
        }

        const merged = mergedResult.hits.filter(hit => !includedIds.has(hit.id));
        for (const hit of merged) {
            if (documents.length >= maxArticles) break;
            const document = this.loadArticleDocument(hit.id, hit, mergedResult.articles);
            if (!document) continue;
            documents.push(document);
        }

        let text = `<question>\n${question}\n</question>\n<documents>\n`;
        for (const doc of documents) {
            const matchedChunk = doc.chunkText
                ? `<matched_chunk index="${doc.chunkIndex ?? ''}">${doc.chunkText}</matched_chunk>\n`
                : '';
            const candidate = `<document id="${doc.id}" title="${this.escapeAttr(doc.title)}" source="${doc.sources.join(',')}" queries="${this.escapeAttr(doc.queries.join(' | '))}">
<summary>${doc.summary}</summary>
${matchedChunk}<score keyword="${doc.keywordScore ?? 0}" vector="${doc.vectorScore ?? 0}" rerank="${doc.rerankScore ?? 0}">${doc.score}</score>
<excerpt>${doc.excerpt}</excerpt>
</document>
`;
            if ((text + candidate + '</documents>').length > maxChars) break;
            text += candidate;
        }
        text += '</documents>';

        return {
            skipNextStep: false,
            data: {
                text,
                documents
            }
        };
    }

    private loadArticleDocument(
        articleId: string,
        hit: Pick<
            MergedHit,
            | 'score'
            | 'sources'
            | 'queries'
            | 'vectorDistance'
            | 'keywordScore'
            | 'vectorScore'
            | 'rerankScore'
            | 'chunkText'
            | 'chunkIndex'
        >,
        articles: Map<string, Article>
    ): RagDocument | null {
        const article = articles.get(articleId);
        if (!article || article.deleted) return null;
        return {
            id: article.id,
            title: article.title,
            summary: article.summary || '',
            excerpt: this.truncate(article.content || '', 900),
            authorName: article.author?.name || '',
            score: hit.score,
            sources: hit.sources,
            queries: hit.queries,
            vectorDistance: hit.vectorDistance,
            keywordScore: hit.keywordScore,
            vectorScore: hit.vectorScore,
            rerankScore: hit.rerankScore,
            chunkText: hit.chunkText,
            chunkIndex: hit.chunkIndex
        };
    }

    private normalizeArticleIds(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        const ids: string[] = [];
        const seen = new Set<string>();
        for (const item of value) {
            const articleId = String(item || '').trim();
            if (!articleId || seen.has(articleId)) continue;
            ids.push(articleId);
            seen.add(articleId);
            if (ids.length >= 10) break;
        }
        return ids;
    }

    private extractQuestion(childrenValues: ChildrenValues, fallback?: string): string {
        for (const value of Object.values(childrenValues)) {
            if (typeof value?.data?.text === 'string' && value.data.text.trim()) {
                return value.data.text.trim();
            }
        }
        return (fallback || '').trim();
    }

    private async mergeHits(
        question: string,
        childrenValues: ChildrenValues,
        additionalArticleIds: string[]
    ): Promise<{ hits: MergedHit[]; articles: Map<string, Article> }> {
        const merged = new Map<string, MergedHit>();

        for (const value of Object.values(childrenValues)) {
            const hits = value?.data?.hits;
            if (!Array.isArray(hits)) continue;

            hits.forEach((hit: any, index: number) => {
                if (!hit?.id) return;
                const current: MergedHit = merged.get(hit.id) || {
                    id: hit.id,
                    score: 0,
                    keywordScore: 0,
                    vectorScore: 0,
                    rerankScore: 0,
                    sources: [],
                    queries: []
                };
                const query = typeof hit.query === 'string' ? hit.query.trim() : '';
                if (hit.source === 'vector') {
                    const vectorScore =
                        typeof hit.score === 'number'
                            ? hit.score
                            : Math.max(0, 1 - (hit.distance || 1));
                    current.vectorScore = Math.max(current.vectorScore || 0, vectorScore);
                    if (
                        current.vectorDistance === undefined ||
                        hit.distance < current.vectorDistance
                    ) {
                        current.vectorDistance = hit.distance;
                        current.chunkText = hit.chunkText;
                        current.chunkIndex = hit.chunkIndex;
                    }
                    if (!current.sources.includes('vector')) current.sources.push('vector');
                } else {
                    current.keywordScore = Math.max(current.keywordScore || 0, 1 / (index + 1));
                    current.keywordRank = index;
                    if (!current.sources.includes('keyword')) current.sources.push('keyword');
                }
                if (query && !current.queries.includes(query)) {
                    current.queries.push(query);
                }
                merged.set(hit.id, current);
            });
        }

        const candidates = [...merged.values()]
            .sort((a, b) => this.baseScore(b) - this.baseScore(a))
            .slice(0, config.rag.candidateArticleLimit);

        const articleIds = [
            ...new Set([...additionalArticleIds, ...candidates.map(candidate => candidate.id)])
        ];
        const articleRows = await ArticleService.getArticlesByIds(articleIds);
        const articles = new Map(articleRows.map(article => [article.id, article]));
        await this.applyRerank(question, candidates, articles);

        for (const hit of candidates) {
            hit.score =
                (hit.keywordScore || 0) * config.rag.keywordWeight +
                (hit.vectorScore || 0) * config.rag.vectorWeight +
                (hit.rerankScore || 0) * config.rag.rerankWeight;
            if (hit.sources.includes('keyword') && hit.sources.includes('vector'))
                hit.score += 0.05;
            if (hit.queries.length > 1) hit.score += (hit.queries.length - 1) * 0.025;
        }

        return { hits: candidates.sort((a, b) => b.score - a.score), articles };
    }

    private baseScore(hit: MergedHit) {
        return (
            (hit.keywordScore || 0) * config.rag.keywordWeight +
            (hit.vectorScore || 0) * config.rag.vectorWeight
        );
    }

    private async applyRerank(
        question: string,
        candidates: MergedHit[],
        articles: Map<string, Article>
    ) {
        if (!llm.hasRerank() || candidates.length === 0) return;

        const documents = candidates.map(hit => {
            const article = articles.get(hit.id);
            if (!article || article.deleted) return '';
            return [
                `标题：${article.title}`,
                `摘要：${article.summary || ''}`,
                hit.chunkText ? `命中片段：${hit.chunkText}` : '',
                `正文开头：${this.truncate(article.content || '', 900)}`
            ]
                .filter(Boolean)
                .join('\n');
        });

        try {
            const response = await llm.rerank(question, documents, candidates.length);
            for (const result of response.results) {
                const candidate = candidates[result.index];
                if (!candidate) continue;
                candidate.rerankScore = Math.max(0, result.relevanceScore);
            }
        } catch (error) {
            logger.warn({ error }, 'RAG rerank failed; falling back to retrieval scores');
        }
    }

    private truncate(text: string, max: number): string {
        const chars = Array.from(text || '');
        if (chars.length <= max) return text || '';
        return `${chars.slice(0, max).join('')}...`;
    }

    private escapeAttr(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
}
