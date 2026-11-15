import { CensorTarget } from '@/shared/task';
import type {
    ChildrenValues,
    TaskCensorResult,
    TaskCommonResult,
    TaskHandler,
    UpdateTask,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { Job, UnrecoverableError } from 'bullmq';
import { ArticleService } from '@/services/article.service';
import { CensorshipService } from '@/services/censorship.service';
import { PasteService } from '@/services/paste.service';

export class UpdateCensorResultHandler implements TaskHandler<UpdateTask> {
    public taskType = 'update:censor';

    public async handle(
        task: UpdateTask,
        job: Job<UpdateTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        let result: TaskCensorResult | null = null;

        if (!task.payload.metadata.censorTarget) {
            throw new UnrecoverableError(
                `Censor target not specified for update article summary task in job ${job.id}`
            );
        }

        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {}
            };
        }

        result = extractUpsteamData(childrenValues, data => typeof data.rating === 'number');
        if (!result) {
            throw new UnrecoverableError(
                `No upstream text data found for update article summary task in job ${job.id}`
            );
        }

        switch (task.payload.metadata.censorTarget as CensorTarget) {
            case CensorTarget.ARTICLE: {
                const article = await ArticleService.getArticleByIdWithoutCache(
                    task.payload.targetId
                );
                if (!article) {
                    throw new UnrecoverableError(
                        `Article with ID ${task.payload.targetId} not found for job ${job.id}`
                    );
                }
                const censorship = await CensorshipService.createCensorship({
                    type: CensorTarget.ARTICLE,
                    targetId: task.payload.targetId,
                    rating: result.rating,
                    category: result.category,
                    reason: result.reason,
                    userDisplayMessage: result.userDisplayMessage
                });
                await CensorshipService.saveCensorship(censorship);
                break;
            }
            case CensorTarget.PASTE: {
                const paste = await PasteService.getPasteById(task.payload.targetId);
                if (!paste) {
                    throw new UnrecoverableError(
                        `Paste with ID ${task.payload.targetId} not found for job ${job.id}`
                    );
                }
                const censorship = await CensorshipService.createCensorship({
                    type: CensorTarget.PASTE,
                    targetId: task.payload.targetId,
                    rating: result.rating,
                    category: result.category,
                    reason: result.reason,
                    userDisplayMessage: result.userDisplayMessage
                });
                await CensorshipService.saveCensorship(censorship);
                break;
            }
            default:
                throw new UnrecoverableError(
                    `Unsupported censor target for update article summary task in job ${job.id}`
                );
        }

        return {
            skipNextStep: false,
            data: {}
        };
    }
}
