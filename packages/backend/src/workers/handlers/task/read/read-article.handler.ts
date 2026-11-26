import { UnrecoverableError } from 'bullmq';
import type { ReadTask, TaskCommonResult, TaskHandler, WorkflowResult } from '@/workers/types';
import { ArticleService } from '@/services/article.service';

export class ReadArticleHandler implements TaskHandler<ReadTask> {
    public taskType = 'read:article';

    public async handle(task: ReadTask): Promise<WorkflowResult<TaskCommonResult>> {
        const articleId = task.payload.targetId;
        if (!articleId) throw new UnrecoverableError('Article read task requires targetId');

        const article = await ArticleService.getArticleByIdWithoutCache(articleId);
        if (!article) throw new UnrecoverableError(`Article ${articleId} not found`);
        if (article.deleted) throw new UnrecoverableError(`Article ${articleId} has been deleted`);
        return {
            skipNextStep: false,
            data: {
                id: article.id,
                title: article.title,
                summary: article.summary || '',
                content: article.content,
                text: article.content,
                authorId: article.authorId,
                authorName: article.author?.name || '',
                category: article.category,
                tags: article.tags || []
            }
        };
    }
}
