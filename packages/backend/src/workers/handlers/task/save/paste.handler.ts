import type { SaveTask, TaskHandler, TaskTextResult, WorkflowResult } from '@/workers/types';
import { fetch } from '@/utils/fetch';
import { C3vkMode } from '@/shared/c3vk';
import type { Paste as LuoguPaste, LentilleDataResponse } from '@/types/luogu-api';
import { PasteService } from '@/services/paste.service';
import { buildUser } from '@/utils/luogu-api';
import { UserService } from '@/services/user.service';
import { logger } from '@/lib/logger';
import { emitToRoom } from '@/lib/socket';
import { UnrecoverableError } from 'bullmq';

export class PasteHandler implements TaskHandler<SaveTask> {
    public taskType = 'save:paste';

    public async handle(task: SaveTask): Promise<WorkflowResult<TaskTextResult>> {
        const url = `https://www.luogu.com/paste/${task.payload.targetId}`;
        const resp: LentilleDataResponse<{ paste: LuoguPaste }> = await fetch(url, C3vkMode.MODERN);
        const data = resp.data?.paste;

        if (!data) {
            throw new UnrecoverableError('剪贴板不存在');
        }

        const incomingUser = buildUser(data.user);
        await UserService.upsertLuoguUser(incomingUser);

        const saveResult = await PasteService.saveLuoguPaste(
            data,
            task.payload.metadata?.forceUpdate
        );

        if (saveResult.skipped) {
            logger.info({ pasteId: data.id }, 'Paste content unchanged, skipping update');
            return {
                skipNextStep: true,
                data: {
                    text: ''
                }
            };
        }

        emitToRoom(`paste_${data.id}`, `paste:${data.id}:updated`);

        if (!saveResult.content) {
            return {
                skipNextStep: true,
                data: {
                    text: ''
                }
            };
        }

        return {
            skipNextStep: false,
            data: {
                text: saveResult.content
            }
        };
    }
}
