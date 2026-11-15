import type {
    ChildrenValues,
    ReadTask,
    TaskHandler,
    TaskTextResult,
    WorkflowResult
} from '@/workers/types';
import { clampInt } from '@/utils/number';

export class ReadPlannedQueryHandler implements TaskHandler<ReadTask> {
    public taskType = 'read:planned_query';

    public async handle(
        task: ReadTask,
        job: any
    ): Promise<WorkflowResult<TaskTextResult & { queryIndex: number }>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;
        const queryIndex = clampInt(
            task.payload.metadata?.queryIndex,
            0,
            0,
            Number.MAX_SAFE_INTEGER
        );
        const queries = this.extractQueries(childrenValues);
        const text = queries[queryIndex] || '';

        return {
            skipNextStep: !text,
            data: {
                text,
                queryIndex
            }
        };
    }

    private extractQueries(childrenValues: ChildrenValues): string[] {
        for (const value of Object.values(childrenValues)) {
            const queries = value?.data?.queries;
            if (Array.isArray(queries)) {
                return queries.filter(query => typeof query === 'string' && query.trim());
            }
        }
        return [];
    }
}
