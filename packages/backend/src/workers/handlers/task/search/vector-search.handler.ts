import { Job, UnrecoverableError } from 'bullmq';
import type {
    ChildrenValues,
    SearchTask,
    TaskCommonResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { EmbeddingService } from '@/services/embedding.service';
import { clampInt } from '@/utils/number';

export class VectorSearchHandler implements TaskHandler<SearchTask> {
    public taskType = 'search:vector';

    public async handle(
        task: SearchTask,
        job: Job<SearchTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;
        if (shouldSkip(childrenValues)) {
            return { skipNextStep: true, data: { hits: [], total: 0 } };
        }

        const embeddingData = extractUpsteamData(
            childrenValues,
            data => Array.isArray(data.embedding),
            job.id
        );
        const embedding = embeddingData?.embedding as number[] | undefined;
        const query = embeddingData?.text as string | undefined;

        if (!embedding) {
            throw new UnrecoverableError(
                `No upstream embedding found for vector search job ${job.id}`
            );
        }

        const limit = clampInt(task.payload.metadata?.limit, 10, 1, 100);
        const rawLimit = clampInt(task.payload.metadata?.rawLimit, 500, 1, 5000);
        const hits = (
            await EmbeddingService.getNearestArticleCandidates(embedding, limit, rawLimit)
        ).map(hit => ({
            ...hit,
            query,
            source: 'vector'
        }));

        return {
            skipNextStep: false,
            data: {
                hits,
                total: hits.length
            }
        };
    }
}
