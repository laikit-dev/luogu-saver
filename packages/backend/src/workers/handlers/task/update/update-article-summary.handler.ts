import type {
    ChildrenValues,
    TaskCommonResult,
    TaskHandler,
    UpdateTask,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { Job, UnrecoverableError } from 'bullmq';
import { ArticleService } from '@/services/article.service';
import { logger } from '@/lib/logger';

export class UpdateArticleSummaryHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:article_summary';

    public async handle(
        task: UpdateTask,
        job: Job<UpdateTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        let content: string | null = null;

        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {}
            };
        }

        content = extractUpsteamData(childrenValues, data => typeof data.text === 'string')?.text;
        if (!content) {
            throw new UnrecoverableError(
                `No upstream text data found for update article summary task in job ${job.id}`
            );
        }

        const article = await ArticleService.getArticleByIdWithoutCache(task.payload.targetId);
        if (!article) {
            throw new UnrecoverableError(
                `Article with id ${task.payload.targetId} not found for job ${job.id}`
            );
        }
        article.summary = content;
        await ArticleService.saveArticle(article);
        logger.info(
            { articleId: article.id, summaryLength: content.length },
            'Updated article summary'
        );

        return {
            skipNextStep: false,
            data: {}
        };
    }
}
