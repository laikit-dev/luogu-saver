import type { TaskCommonResult, TaskHandler, UpdateTask, WorkflowResult } from '@/workers/types';
import { ArticleService } from '@/services/article.service';
import { SearchService } from '@/services/search.service';
import { ArticleSummaryService } from '@/services/article-summary.service';
import { logger } from '@/lib/logger';
import { runWithConcurrency } from '@/utils/concurrency';
import { clampInt } from '@/utils/number';

export class UpdateArticleSummaryRebuildHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:article_summary_rebuild';

    public async handle(task: UpdateTask): Promise<WorkflowResult<TaskCommonResult>> {
        const batchSize = clampInt(task.payload.metadata?.batchSize, 20, 1, 100);
        const concurrency = clampInt(task.payload.metadata?.concurrency, 5, 1, 20);
        const failedArticleIds: string[] = [];
        let processed = 0;
        let updated = 0;
        let afterId: string | null = null;

        while (true) {
            const articles = await ArticleService.getArticlesForContentRebuild(afterId, batchSize);
            if (articles.length === 0) break;
            afterId = articles[articles.length - 1].id;

            await runWithConcurrency(articles, concurrency, async article => {
                processed += 1;
                try {
                    article.summary = await ArticleSummaryService.generate(article.content);
                    await ArticleService.saveArticle(article);
                    await SearchService.upsertArticleById(article.id);
                    updated += 1;
                } catch (error) {
                    failedArticleIds.push(article.id);
                    logger.error(
                        { error, articleId: article.id },
                        'Failed to rebuild article summary'
                    );
                }
            });
        }

        return {
            skipNextStep: false,
            data: {
                processed,
                updated,
                failed: failedArticleIds.length,
                failedArticleIds
            }
        };
    }
}
