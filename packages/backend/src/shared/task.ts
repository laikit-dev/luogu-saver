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
