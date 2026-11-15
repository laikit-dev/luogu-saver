import type { TaskCommonResult, TaskHandler, UpdateTask, WorkflowResult } from '@/workers/types';
import { SearchService } from '@/services/search.service';
import { clampInt } from '@/utils/number';

export class UpdateSearchReindexHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:search_reindex';

    public async handle(task: UpdateTask): Promise<WorkflowResult<TaskCommonResult>> {
        const batchSize = clampInt(task.payload.metadata?.batchSize, 100, 1, 500);
        const indexed = await SearchService.reindexArticles(batchSize);

        return {
            skipNextStep: false,
            data: { indexed }
        };
    }
}
