import type { ReadTask, TaskHandler, TaskTextResult, WorkflowResult } from '@/workers/types';

export class ReadTextHandler implements TaskHandler<ReadTask> {
    public taskType = 'read:text';

    public async handle(task: ReadTask): Promise<WorkflowResult<TaskTextResult>> {
        return {
            skipNextStep: false,
            data: {
                text: task.payload.metadata?.text || ''
            }
        };
    }
}
