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
    READ = 'read'
}

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
    ARTICLE = 'article',
    PASTE = 'paste'
}

export enum CensorTarget {
    ARTICLE = 'article',
    PASTE = 'paste'
}
