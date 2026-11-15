import type {
    AiTask,
    ChildrenValues,
    TaskHandler,
    TaskTextResult,
    WorkflowResult
} from '@/workers/types';
import { UnrecoverableError, Job } from 'bullmq';
import { ArticleSummaryService } from '@/services/article-summary.service';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { logger } from '@/lib/logger';

export class SummaryHandler implements TaskHandler<AiTask> {
    public taskType = 'llm:summary';

    public async handle(task: AiTask, job: Job<AiTask>): Promise<WorkflowResult<TaskTextResult>> {
        let content: string | null = null;

        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {
                    text: ''
                }
            };
        }

        content = extractUpsteamData(
            childrenValues,
            data => typeof data.text === 'string',
            job.id
        )?.text;

        if (!content) {
            throw new UnrecoverableError(
                `No upstream text data found for summary task in job ${job.id}`
            );
        }

        const result = await ArticleSummaryService.generate(content);
        logger.info(
            { jobId: job.id, inputLength: content.length, summaryLength: result.length },
            'Generated article summary'
        );

        return {
            skipNextStep: false,
            data: {
                text: result
            }
        };
    }
}
