import { Job } from 'bullmq';
import {
    DiscoverTask,
    DiscoverTarget,
    DiscoverUserArticlesMetadata,
    TaskType
} from '@/shared/task';
import { TaskHandler, WorkflowResult } from '@/workers/types';
import { fetch } from '@/utils/fetch';
import { C3vkMode } from '@/shared/c3vk';
import { DiscoveryService } from '@/services/discovery.service';
import { TaskService } from '@/services/task.service';
import { logger } from '@/lib/logger';
import { ArticleListResponse, extractArticleIds, getTotalPages } from './article-list-utils';

function buildUserArticlesUrl(uid: number, page: number) {
    const url = new URL(`https://www.luogu.com/user/${uid}/article`);
    url.searchParams.set('page', String(page));
    return url.toString();
}

export class UserArticlesDiscoveryHandler implements TaskHandler<DiscoverTask> {
    public taskType = `${TaskType.DISCOVER}:${DiscoverTarget.USER_ARTICLES}`;

    public async handle(
        task: DiscoverTask,
        job: Job<DiscoverTask>
    ): Promise<WorkflowResult<{ text: string; articleIds: string[]; nextTaskId?: string }>> {
        const metadata = task.payload.metadata as DiscoverUserArticlesMetadata;
        const runId = metadata.runId;
        const uid = Math.max(1, Math.trunc(Number(metadata.uid) || Number(task.payload.targetId)));
        const page = Math.max(1, Math.trunc(Number(metadata.page) || 1));
        const maxPages = Math.max(1, Math.trunc(Number(metadata.maxPages) || 1000));

        const isRetry = job.attemptsMade > 0;
        if (!(await DiscoveryService.claimPage(runId, !isRetry))) {
            await DiscoveryService.finishPage(runId, false);
            return {
                skipNextStep: false,
                data: {
                    text: 'Discovery run is inactive or page budget is exhausted',
                    articleIds: []
                }
            };
        }

        const url = buildUserArticlesUrl(uid, page);
        await job.updateProgress(`Fetching ${url}`);

        try {
            const resp: ArticleListResponse = await fetch(url, C3vkMode.MODERN);
            const articleIds = extractArticleIds(resp);
            const totalPages = getTotalPages(resp);

            for (const articleId of articleIds) {
                await DiscoveryService.discoverArticle({
                    runId,
                    articleId,
                    forceUpdate: metadata.forceUpdate === true
                });
            }

            let nextTaskId: string | undefined;
            const shouldContinue =
                articleIds.length > 0 &&
                page < maxPages &&
                (totalPages === null || page < totalPages);
            if (shouldContinue) {
                const nextTask = await TaskService.createTask(TaskType.DISCOVER, {
                    target: DiscoverTarget.USER_ARTICLES,
                    targetId: String(uid),
                    metadata: {
                        ...metadata,
                        uid,
                        page: page + 1
                    }
                });
                await TaskService.dispatchTask(nextTask.id);
                nextTaskId = nextTask.id;
            }

            logger.info(
                { runId, uid, page, totalPages, articleCount: articleIds.length, nextTaskId },
                'User articles discovery page processed'
            );

            await DiscoveryService.finishPage(runId, Boolean(nextTaskId));

            return {
                skipNextStep: false,
                data: {
                    text: `Discovered ${articleIds.length} article(s) from ${url}`,
                    articleIds,
                    nextTaskId
                }
            };
        } catch (error) {
            const attempts = job.opts.attempts || 1;
            const isFinalAttempt = job.attemptsMade + 1 >= attempts;
            if (isFinalAttempt) {
                await DiscoveryService.markPageFailed(runId, error);
                await DiscoveryService.finishPage(runId, false);
            }
            throw error;
        }
    }
}
