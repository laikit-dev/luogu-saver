import { UnrecoverableError } from 'bullmq';
import type { ReadTask, TaskCommonResult, TaskHandler, WorkflowResult } from '@/workers/types';
import { PasteService } from '@/services/paste.service';

export class ReadPasteHandler implements TaskHandler<ReadTask> {
    public taskType = 'read:paste';

    public async handle(task: ReadTask): Promise<WorkflowResult<TaskCommonResult>> {
        const pasteId = task.payload.targetId;
        if (!pasteId) throw new UnrecoverableError('Paste read task requires targetId');

        const paste = await PasteService.getPasteByIdWithoutCache(pasteId);
        if (!paste) throw new UnrecoverableError(`Paste ${pasteId} not found`);
        if (paste.deleted) throw new UnrecoverableError(`Paste ${pasteId} has been deleted`);
        return {
            skipNextStep: false,
            data: {
                id: paste.id,
                content: paste.content,
                text: paste.content,
                authorId: paste.authorId,
                authorName: paste.author?.name || ''
            }
        };
    }
}
