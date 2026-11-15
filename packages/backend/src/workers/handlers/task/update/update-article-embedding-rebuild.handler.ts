import type { TaskCommonResult, TaskHandler, UpdateTask, WorkflowResult } from '@/workers/types';
import { EmbeddingService } from '@/services/embedding.service';
import { clampInt } from '@/utils/number';

export class UpdateArticleEmbeddingRebuildHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:article_embedding_rebuild';

    public async handle(task: UpdateTask): Promise<WorkflowResult<TaskCommonResult>> {
        const batchSize = clampInt(task.payload.metadata?.batchSize, 20, 1, 100);
        const concurrency = clampInt(task.payload.metadata?.concurrency, 5, 1, 50);
        const result = await EmbeddingService.rebuildArticleEmbeddings(batchSize, concurrency);

        return {
            skipNextStep: false,
            data: result
        };
    }
}
