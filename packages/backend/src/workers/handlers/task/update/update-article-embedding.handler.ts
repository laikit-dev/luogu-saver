import type {
    ChildrenValues,
    TaskCommonResult,
    TaskEmbeddingRecord,
    TaskHandler,
    UpdateTask,
    WorkflowResult
} from '@/workers/types';
import { Job, UnrecoverableError } from 'bullmq';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { EmbeddingService } from '@/services/embedding.service';
import { ArticleService } from '@/services/article.service';

export class UpdateArticleEmbeddingHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:article_embedding';

    public async handle(
        task: UpdateTask,
        job: Job<UpdateTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {}
            };
        }

        const embeddingData = extractUpsteamData(
            childrenValues,
            data => Array.isArray(data.embeddingRecords),
            job.id
        );
        const embeddingRecords = embeddingData?.embeddingRecords as
            | TaskEmbeddingRecord[]
            | undefined;
        if (!embeddingRecords || embeddingRecords.length === 0) {
            throw new UnrecoverableError(
                `No upstream embedding records found for article embedding update job ${job.id}`
            );
        }

        const article = await ArticleService.getArticleByIdWithoutCache(task.payload.targetId);
        if (!article) {
            throw new UnrecoverableError(
                `Article with id ${task.payload.targetId} not found for embedding update job ${job.id}`
            );
        }

        const vectorCount = await EmbeddingService.upsertArticleEmbeddingRecords(
            article,
            embeddingRecords
        );

        return {
            skipNextStep: false,
            data: {
                articleId: task.payload.targetId,
                vectorCount
            }
        };
    }
}
