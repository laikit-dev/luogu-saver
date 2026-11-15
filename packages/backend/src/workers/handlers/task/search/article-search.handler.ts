import { Job } from 'bullmq';
import type {
    ChildrenValues,
    SearchTask,
    TaskCommonResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { SearchService } from '@/services/search.service';
import { clampInt } from '@/utils/number';

export class ArticleSearchHandler implements TaskHandler<SearchTask> {
    public taskType = 'search:article';

    public async handle(
        task: SearchTask,
        job: Job<SearchTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: { hits: [], total: 0 }
            };
        }

        const upstreamText = extractUpsteamData(
            childrenValues,
            data => typeof data.text === 'string',
            job.id
        )?.text;
        const query = task.payload.query || upstreamText || '';
        const limit = clampInt(task.payload.metadata?.limit, 5, 1, 100);
        const result = await SearchService.searchArticles({
            q: query,
            page: 1,
            limit,
            category: task.payload.metadata?.category,
            authorId: task.payload.metadata?.authorId
        });

        return {
            skipNextStep: false,
            data: {
                hits: result.hits.map((hit: any) => ({
                    ...hit,
                    query,
                    source: 'keyword'
                })),
                total: result.total
            }
        };
    }
}
