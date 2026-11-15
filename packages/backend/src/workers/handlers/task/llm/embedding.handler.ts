import type {
    AiTask,
    ChildrenValues,
    TaskEmbeddingRecord,
    TaskEmbeddingResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { UnrecoverableError, Job } from 'bullmq';
import { llm } from '@/lib/llm';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { logger } from '@/lib/logger';
import { EmbeddingService } from '@/services/embedding.service';

export class EmbeddingHandler implements TaskHandler<AiTask> {
    public taskType = 'llm:embedding';

    public async handle(
        task: AiTask,
        job: Job<AiTask>
    ): Promise<WorkflowResult<TaskEmbeddingResult>> {
        let content: string | null = null;

        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {
                    embedding: [],
                    embeddingLength: 0
                }
            };
        }

        if (task.payload.metadata?.mode === 'article_index') {
            return await this.buildArticleIndexEmbeddings(childrenValues, job.id);
        }

        content = extractUpsteamData(
            childrenValues,
            data => typeof data.text === 'string',
            job.id
        )?.text;

        if (!content) {
            throw new UnrecoverableError(
                `No upstream text data found for embedding task in job ${job.id}`
            );
        }

        const textToEmbed = content;
        const { embedding } = await llm.embedding(textToEmbed);
        logger.info(
            { jobId: job.id, inputLength: textToEmbed.length, embeddingLength: embedding.length },
            'Generated embedding'
        );
        /*
        await EmbeddingService.upsertVector(
            articleId!,
            {
                title: title!,
                authorId: authorId || 0,
                category: category || 0,
                tags: tags.join(',')
            },
            textToEmbed,
            embedding
        );
         */

        return {
            skipNextStep: false,
            data: {
                embedding,
                text: textToEmbed,
                embeddingLength: embedding.length
            }
        };
    }

    private async buildArticleIndexEmbeddings(
        childrenValues: ChildrenValues,
        jobId?: string
    ): Promise<WorkflowResult<TaskEmbeddingResult>> {
        const articleContent = this.getTextFromFather(childrenValues, 'save');
        const summaryText = this.getTextFromFather(childrenValues, 'summary');
        const summaryDocument = summaryText || articleContent;

        if (!summaryDocument) {
            throw new UnrecoverableError(
                `No upstream article text found for article embedding task in job ${jobId}`
            );
        }

        const chunks = articleContent ? EmbeddingService.splitArticleContent(articleContent) : [];
        const summaryEmbedding = (await llm.embedding(summaryDocument)).embedding;
        const chunkRecords: TaskEmbeddingRecord[] = [];
        for (const chunk of chunks) {
            chunkRecords.push({
                kind: 'chunk' as const,
                document: chunk.text,
                embedding: (await llm.embedding(chunk.text)).embedding,
                chunkIndex: chunk.index,
                start: chunk.start,
                end: chunk.end
            });
        }
        const embeddingRecords: TaskEmbeddingRecord[] = [
            {
                kind: 'summary',
                document: summaryDocument,
                embedding: summaryEmbedding
            },
            ...chunkRecords
        ];

        logger.info(
            {
                jobId,
                summaryLength: summaryDocument.length,
                chunkCount: chunks.length,
                embeddingCount: embeddingRecords.length
            },
            'Generated article index embeddings'
        );

        return {
            skipNextStep: false,
            data: {
                embedding: summaryEmbedding,
                text: summaryDocument,
                embeddingLength: summaryEmbedding.length,
                embeddingRecords
            }
        };
    }

    private getTextFromFather(childrenValues: ChildrenValues, fatherName: string) {
        const text = childrenValues[fatherName]?.data?.text;
        return typeof text === 'string' ? text.trim() : '';
    }
}
