import { TaskType } from './task';

export const QUEUE_NAMES = {
    [TaskType.SAVE]: 'queue-save',
    [TaskType.LLM]: 'queue-ai',
    [TaskType.UPDATE]: 'queue-update',
    [TaskType.SEARCH]: 'queue-search',
    [TaskType.READ]: 'queue-read',
    [TaskType.RAG]: 'queue-rag',
    [TaskType.DISCOVER]: 'queue-discover'
};

export const WORKFLOW_PRIORITY = {
    AUTHENTICATED: 1,
    ANONYMOUS: 5,
    LOW: 10
} as const;
