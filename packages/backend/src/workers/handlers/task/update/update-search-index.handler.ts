import type {
    ChildrenValues,
    TaskCommonResult,
    TaskHandler,
    UpdateTask,
    WorkflowResult
} from '@/workers/types';
import { Job, UnrecoverableError } from 'bullmq';
import { SearchService } from '@/services/search.service';
import { shouldSkip } from '@/workers/helpers/common.helper';

export class UpdateSearchIndexHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:search_index';

    public async handle(
        task: UpdateTask,
        job: Job<UpdateTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;
        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {
                    indexed: false,
                    articleId: task.payload.targetId
                }
            };
        }

        const articleId = task.payload.targetId;
        const { exists, indexed } = await SearchService.upsertArticleById(articleId);

        if (!exists) {
            throw new UnrecoverableError(`Article with id ${articleId} not found for search index`);
        }

        return {
            skipNextStep: false,
            data: {
                indexed,
                articleId
            }
        };
    }
}
