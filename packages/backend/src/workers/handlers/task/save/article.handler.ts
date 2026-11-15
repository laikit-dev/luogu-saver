import { fetch } from '@/utils/fetch';
import { C3vkMode } from '@/shared/c3vk';
import type { ArticleData, LentilleDataResponse } from '@/types/luogu-api';
import { ArticleService } from '@/services/article.service';
import { UserService } from '@/services/user.service';
import { logger } from '@/lib/logger';
import { buildUser } from '@/utils/luogu-api';
import { emitToRoom } from '@/lib/socket';
import type { SaveTask, TaskHandler, TaskTextResult, WorkflowResult } from '@/workers/types';
import { UnrecoverableError } from 'bullmq';

export class ArticleHandler implements TaskHandler<SaveTask> {
    public taskType = 'save:article';

    public async handle(task: SaveTask): Promise<WorkflowResult<TaskTextResult>> {
        const url = `https://www.luogu.com/article/${task.payload.targetId}`;
        const resp: LentilleDataResponse<ArticleData> = await fetch(url, C3vkMode.MODERN);
        const data = resp.data?.article;

        if (!data) {
            throw new UnrecoverableError('文章不存在');
        }

        const incomingUser = buildUser(data.author);
        await UserService.upsertLuoguUser(incomingUser);

        const saveResult = await ArticleService.saveLuoguArticle(
            data,
            task.payload.metadata?.forceUpdate
        );

        if (saveResult.skipped) {
            logger.info({ articleId: data.lid }, 'Article content unchanged, skipping update');
            return {
                skipNextStep: true,
                data: {
                    text: ''
                }
            };
        }

        if (saveResult.content) {
            emitToRoom(`article_${data.lid}`, `article:${data.lid}:updated`);
            return {
                skipNextStep: false,
                data: {
                    text: saveResult.content
                }
            };
        }
        throw new Error('Failed to save article');
    }
}
