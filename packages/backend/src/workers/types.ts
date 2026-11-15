import type {
    DiscoverTarget,
    RagTarget,
    ReadTarget,
    SaveTarget,
    SearchTarget,
    TaskType,
    UpdateTarget
} from '@/shared/task';
import type { Job } from 'bullmq';

export interface CommonTask {
    id: string;
    type: TaskType;
    workflowId?: string;
    taskName?: string;
    track?: boolean;
    report?: boolean;
    fathers?: string[];
    fatherIds?: Record<string, string>;
    payload: {
        target: string;
        metadata: Record<string, any>;
        [key: string]: any;
    };
}

export interface SaveTask extends CommonTask {
    type: TaskType.SAVE;
    payload: {
        target: SaveTarget;
        targetId: string;
        metadata: {
            forceUpdate?: boolean;
        };
    };
}

export interface AiTask extends CommonTask {
    type: TaskType.LLM;
    payload: {
        target: 'summary' | 'embedding' | 'chat' | 'censor';
        metadata: {
            query?: string;
            mode?: 'article_index';
        };
    };
}

export interface UpdateTask extends CommonTask {
    type: TaskType.UPDATE;
    payload: {
        target: UpdateTarget;
        targetId: string;
        metadata: Record<string, any>;
    };
}

export interface SearchTask extends CommonTask {
    type: TaskType.SEARCH;
    payload: {
        target: SearchTarget;
        query?: string;
        metadata: {
            limit?: number;
            rawLimit?: number;
            category?: number;
            authorId?: number;
        };
    };
}

export interface ReadTask extends CommonTask {
    type: TaskType.READ;
    payload: {
        target: ReadTarget;
        targetId?: string;
        metadata: {
            text?: string;
            queryIndex?: number;
        };
    };
}

export interface RagTask extends CommonTask {
    type: TaskType.RAG;
    payload: {
        target: RagTarget;
        query?: string;
        metadata: {
            maxArticles?: number;
            maxChars?: number;
            articleIds?: string[];
        };
    };
}

export interface DiscoverTask extends CommonTask {
    type: TaskType.DISCOVER;
    payload: {
        target: DiscoverTarget;
        targetId: string;
        metadata: {
            runId: string;
            uid: number;
            page?: number;
            maxPages?: number;
            forceUpdate?: boolean;
        };
    };
}

export interface TaskHandler<T extends CommonTask> {
    handle(task: T, job: Job<T>): Promise<WorkflowResult<any>>;
    taskType: string;
}

export interface WorkflowResult<T> {
    skipNextStep: boolean;
    data: T;
}

export type ChildrenValues = { [p: string]: WorkflowResult<any> };

export interface TaskCommonResult {
    [key: string]: any;
}

export interface TaskTextResult extends TaskCommonResult {
    text: string;
}

export interface TaskEmbeddingResult extends TaskCommonResult {
    embedding: number[];
    text?: string;
    embeddingLength?: number;
    embeddingRecords?: TaskEmbeddingRecord[];
}

export interface TaskEmbeddingRecord {
    kind: 'summary' | 'chunk';
    document: string;
    embedding: number[];
    chunkIndex?: number;
    start?: number;
    end?: number;
}

export interface TaskCensorResult extends TaskCommonResult {
    rating: number;
    category: string;
    reason: string;
    userDisplayMessage: string;
}
