import { TaskDefinition, WorkflowDefinition } from '@/utils/flow-validator';
import { Permission } from '@/shared/permission';
import { clampInt } from '@/utils/number';
import { config } from '@/config';

export type WorkflowTemplateBuilder = (params: any) => WorkflowDefinition;

const normalizeReindexBatchSize = (value: any) => {
    return clampInt(value, 100, 1, 500);
};

const normalizeSummaryRebuildBatchSize = (value: any) => {
    return clampInt(value, 20, 1, 100);
};

const normalizeSummaryRebuildConcurrency = (value: any) => {
    return clampInt(value, 5, 1, 20);
};

const normalizeEmbeddingRebuildBatchSize = (value: any) => {
    return clampInt(value, 20, 1, 100);
};

const normalizeEmbeddingRebuildConcurrency = (value: any) => {
    return clampInt(value, 5, 1, 50);
};

const normalizeRagArticleIds = (value: any) => {
    if (!Array.isArray(value)) return [];

    const articleIds: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const articleId = String(item || '').trim();
        if (!articleId || seen.has(articleId)) continue;
        articleIds.push(articleId);
        seen.add(articleId);
        if (articleIds.length >= 10) break;
    }
    return articleIds;
};

export const WORKFLOW_TEMPLATES_PERMISSION: { [key: string]: Permission | null } = {
    'article-save-pipeline': null,
    'paste-save-pipeline': null,
    'article-censor-pipeline': Permission.CREATE_WORKFLOW,
    'search-reindex-pipeline': Permission.MANAGE_SEARCH,
    'article-summary-rebuild-pipeline': Permission.MANAGE_SEARCH,
    'article-embedding-rebuild-pipeline': Permission.MANAGE_SEARCH,
    'rag-search-pipeline': Permission.CREATE_WORKFLOW
};

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplateBuilder> = {
    'article-save-pipeline': (params: any) => {
        const { targetId } = params;
        if (!targetId) {
            throw new Error('targetId is required for article-save-pipeline');
        }
        const forceUpdate = params?.forceUpdate === true;

        const tasks: TaskDefinition[] = [
            {
                name: 'save',
                track: true,
                report: true,
                data: {
                    type: 'save',
                    payload: {
                        target: 'article',
                        targetId: targetId,
                        metadata: { forceUpdate }
                    }
                }
            },
            {
                name: 'save-comment',
                fathers: ['save'],
                data: {
                    type: 'save',
                    payload: {
                        target: 'comments',
                        targetId: targetId,
                        metadata: { forceUpdate }
                    }
                }
            },
            {
                name: 'summary',
                fathers: ['save'],
                track: true,
                data: {
                    type: 'llm',
                    payload: {
                        target: 'summary',
                        metadata: {}
                    }
                }
            },
            {
                name: 'censor',
                fathers: ['save'],
                track: true,
                data: {
                    type: 'llm',
                    payload: {
                        target: 'censor',
                        metadata: {}
                    }
                }
            },
            {
                name: 'embedding',
                fathers: ['save', 'summary'],
                data: {
                    type: 'llm',
                    payload: {
                        target: 'embedding',
                        metadata: { mode: 'article_index' }
                    }
                }
            },
            {
                name: 'update-embedding',
                fathers: ['embedding'],
                data: {
                    type: 'update',
                    payload: {
                        target: 'article_embedding',
                        targetId: targetId,
                        metadata: {}
                    }
                }
            },
            {
                name: 'update-summary',
                fathers: ['summary'],
                data: {
                    type: 'update',
                    payload: {
                        target: 'article_summary',
                        targetId: targetId,
                        metadata: {}
                    }
                }
            },
            {
                name: 'update-censor',
                fathers: ['censor'],
                data: {
                    type: 'update',
                    payload: {
                        target: 'censor',
                        targetId: targetId,
                        metadata: {
                            censorTarget: 'article'
                        }
                    }
                }
            },
            {
                name: 'update-search-index',
                fathers: ['update-summary'],
                track: true,
                report: true,
                data: {
                    type: 'update',
                    payload: {
                        target: 'search_index',
                        targetId: targetId,
                        metadata: {}
                    }
                }
            }
        ];

        return { tasks };
    },
    'paste-save-pipeline': (params: any) => {
        const { targetId } = params;
        if (!targetId) {
            throw new Error('targetId is required for paste-save-pipeline');
        }

        const forceUpdate = params?.forceUpdate === true;

        const tasks: TaskDefinition[] = [
            {
                name: 'save',
                track: true,
                report: true,
                data: {
                    type: 'save',
                    payload: {
                        target: 'paste',
                        targetId: targetId,
                        metadata: { forceUpdate }
                    }
                }
            },
            {
                name: 'censor',
                fathers: ['save'],
                track: true,
                data: {
                    type: 'llm',
                    payload: {
                        target: 'censor',
                        metadata: {}
                    }
                }
            },
            {
                name: 'update-censor',
                fathers: ['censor'],
                data: {
                    type: 'update',
                    payload: {
                        target: 'censor',
                        targetId: targetId,
                        metadata: {
                            censorTarget: 'paste'
                        }
                    }
                }
            }
        ];

        return { tasks };
    },
    'article-censor-pipeline': (params: any) => {
        const { targetId } = params;
        if (!targetId) {
            throw new Error('targetId is required for article-censor-pipeline');
        }

        const tasks: TaskDefinition[] = [
            {
                name: 'censor',
                fathers: ['read-article'],
                track: true,
                report: true,
                data: {
                    type: 'llm',
                    payload: {
                        target: 'censor',
                        metadata: {}
                    }
                }
            },
            {
                name: 'read-article',
                track: true,
                data: {
                    type: 'read',
                    payload: {
                        target: 'article',
                        targetId: targetId,
                        metadata: {}
                    }
                }
            },
            {
                name: 'update-censor',
                fathers: ['censor'],
                data: {
                    type: 'update',
                    payload: {
                        target: 'censor',
                        targetId: targetId,
                        metadata: {
                            censorTarget: 'article'
                        }
                    }
                }
            }
        ];

        return { tasks };
    },
    'rag-search-pipeline': (params: any) => {
        const query = String(params?.query || '').trim();
        if (!query) throw new Error('query is required for rag-search-pipeline');

        const limit = clampInt(params?.limit, 100, 1, 100);
        const maxQueries = 5;
        const maxArticles = clampInt(params?.maxArticles, 10, 1, 10);
        const maxChars = clampInt(params?.maxChars, 20000, 1000, 20000);
        const articleIds = normalizeRagArticleIds(params?.articleIds);

        const tasks: TaskDefinition[] = [
            {
                name: 'read-query',
                data: {
                    type: 'read',
                    payload: {
                        target: 'text',
                        metadata: { text: query }
                    }
                }
            },
            {
                name: 'plan-queries',
                fathers: ['read-query'],
                track: true,
                report: true,
                data: {
                    type: 'rag',
                    payload: {
                        target: 'plan_queries',
                        metadata: {}
                    }
                }
            }
        ];

        const contextFathers = ['read-query'];
        for (let index = 0; index < maxQueries; index += 1) {
            tasks.push(
                {
                    name: `read-planned-query-${index}`,
                    fathers: ['plan-queries'],
                    data: {
                        type: 'read',
                        payload: {
                            target: 'planned_query',
                            metadata: { queryIndex: index }
                        }
                    }
                },
                {
                    name: `keyword-search-${index}`,
                    fathers: [`read-planned-query-${index}`],
                    track: true,
                    report: true,
                    data: {
                        type: 'search',
                        payload: {
                            target: 'article',
                            metadata: { limit }
                        }
                    }
                },
                {
                    name: `query-embedding-${index}`,
                    fathers: [`read-planned-query-${index}`],
                    track: true,
                    report: true,
                    data: {
                        type: 'llm',
                        payload: {
                            target: 'embedding',
                            metadata: {}
                        }
                    }
                },
                {
                    name: `vector-search-${index}`,
                    fathers: [`query-embedding-${index}`],
                    track: true,
                    report: true,
                    data: {
                        type: 'search',
                        payload: {
                            target: 'vector',
                            metadata: { limit, rawLimit: config.rag.rawVectorResultLimit }
                        }
                    }
                }
            );
            contextFathers.push(`keyword-search-${index}`, `vector-search-${index}`);
        }

        tasks.push(
            {
                name: 'build-context',
                fathers: contextFathers,
                track: true,
                report: true,
                data: {
                    type: 'rag',
                    payload: {
                        target: 'context',
                        metadata: { maxArticles, maxChars, articleIds }
                    }
                }
            },
            {
                name: 'answer',
                fathers: ['build-context'],
                track: true,
                report: true,
                data: {
                    type: 'rag',
                    payload: {
                        target: 'answer',
                        metadata: {}
                    }
                }
            }
        );

        return { tasks };
    },
    'article-summary-rebuild-pipeline': (params: any) => {
        const batchSize = normalizeSummaryRebuildBatchSize(params?.batchSize);
        const concurrency = normalizeSummaryRebuildConcurrency(params?.concurrency);
        const tasks: TaskDefinition[] = [
            {
                name: 'rebuild-summary',
                track: true,
                report: true,
                data: {
                    type: 'update',
                    payload: {
                        target: 'article_summary_rebuild',
                        targetId: 'articles',
                        metadata: { batchSize, concurrency }
                    }
                }
            }
        ];

        return { tasks };
    },
    'article-embedding-rebuild-pipeline': (params: any) => {
        const batchSize = normalizeEmbeddingRebuildBatchSize(params?.batchSize);
        const concurrency = normalizeEmbeddingRebuildConcurrency(params?.concurrency);
        const tasks: TaskDefinition[] = [
            {
                name: 'rebuild-embedding',
                track: true,
                report: true,
                data: {
                    type: 'update',
                    payload: {
                        target: 'article_embedding_rebuild',
                        targetId: 'articles',
                        metadata: { batchSize, concurrency }
                    }
                }
            }
        ];

        return { tasks };
    },
    'search-reindex-pipeline': (params: any) => {
        const batchSize = normalizeReindexBatchSize(params?.batchSize);
        const tasks: TaskDefinition[] = [
            {
                name: 'reindex-search',
                track: true,
                report: true,
                data: {
                    type: 'update',
                    payload: {
                        target: 'search_reindex',
                        targetId: 'articles',
                        metadata: { batchSize }
                    }
                }
            }
        ];

        return { tasks };
    }
};
