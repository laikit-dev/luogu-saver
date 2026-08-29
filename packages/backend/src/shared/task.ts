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
        metadata: DiscoverUserArticlesMetadata;
    };
}

export interface DiscoverUserArticlesMetadata {
    runId: string;
    uid: number;
    page?: number;
    maxPages?: number;
    forceUpdate?: boolean;
}

export enum TaskStatus {
    PENDING = 0,
    PROCESSING = 1,
    COMPLETED = 2,
    FAILED = 3
}

export enum TaskType {
    SAVE = 'save',
    LLM = 'llm',
    UPDATE = 'update',
    SEARCH = 'search',
    READ = 'read',
    RAG = 'rag',
    DISCOVER = 'discover'
}

export type TaskDefinition = {
    [TaskType.SAVE]: SaveTask;
    [TaskType.LLM]: AiTask;
    [TaskType.UPDATE]: CommonTask;
    [TaskType.SEARCH]: SearchTask;
    [TaskType.READ]: ReadTask;
    [TaskType.RAG]: RagTask;
    [TaskType.DISCOVER]: DiscoverTask;
};

export enum UpdateTarget {
    ARTICLE_SUMMARY = 'article_summary',
    ARTICLE_SUMMARY_REBUILD = 'article_summary_rebuild',
    ARTICLE_EMBEDDING = 'article_embedding',
    ARTICLE_EMBEDDING_REBUILD = 'article_embedding_rebuild',
    CENSOR = 'censor',
    SEARCH_INDEX = 'search_index',
    SEARCH_REINDEX = 'search_reindex'
}

export enum SaveTarget {
    ARTICLE = 'article',
    PASTE = 'paste',
    BENBEN = 'benben',
    JUDGEMENT = 'judgement',
    PROFILE = 'profile',
    COMMENTS = 'comments'
}

export enum SearchTarget {
    ARTICLE = 'article',
    VECTOR = 'vector'
}

export enum ReadTarget {
    TEXT = 'text',
    PLANNED_QUERY = 'planned_query',
    ARTICLE = 'article',
    PASTE = 'paste'
}

export enum RagTarget {
    PLAN_QUERIES = 'plan_queries',
    CONTEXT = 'context',
    ANSWER = 'answer'
}

export enum DiscoverTarget {
    USER_ARTICLES = 'user_articles'
}

export enum CensorTarget {
    ARTICLE = 'article',
    PASTE = 'paste'
}
