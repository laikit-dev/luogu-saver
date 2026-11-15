import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../src/entities/article';
import type { UpdateTask } from '../src/workers/types';
import type { Job } from 'bullmq';

const state = vi.hoisted(() => ({
    enabled: false,
    article: null as Article | null
}));

vi.mock('@/config', () => ({
    config: {
        meilisearch: {
            get enable() {
                return state.enabled;
            },
            articleIndexName: 'articles'
        },
        network: { timeout: 1000 }
    }
}));

vi.mock('@/services/article.service', () => ({
    ArticleService: {
        getArticleByIdWithoutCache: async (id: string) =>
            state.article?.id === id ? structuredClone(state.article) : null
    }
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn() } }));

import { UnrecoverableError } from 'bullmq';
import { SearchService, type ArticleSearchDocument } from '../src/services/search.service';
import { UpdateSearchIndexHandler } from '../src/workers/handlers/task/update/update-search-index.handler';

const task = {
    type: 'update',
    payload: { target: 'search_index', targetId: 'article1' }
} as UpdateTask;
const job = { getChildrenValues: async () => ({}) } as Job<UpdateTask>;

function createArticle(): Article {
    return {
        id: 'article1',
        title: 'Title',
        content: 'Article content',
        summary: 'Summary',
        authorId: 42,
        author: { name: 'Author' },
        category: 1,
        tags: [],
        updatedAt: new Date('2026-09-24T12:00:00.000Z'),
        viewCount: 0,
        priority: 0,
        deleted: false
    } as Article;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('SearchService article indexing', () => {
    beforeEach(() => {
        state.enabled = false;
        state.article = null;
        Object.assign(SearchService, { client: null, articleIndexReady: null });
    });

    it('distinguishes a missing article from disabled indexing in the update handler', async () => {
        const handler = new UpdateSearchIndexHandler();

        const failure = await handler.handle(task, job).catch(error => error);
        expect(failure).toBeInstanceOf(UnrecoverableError);

        state.article = createArticle();
        await expect(handler.handle(task, job)).resolves.toEqual({
            skipNextStep: false,
            data: { indexed: false, articleId: 'article1' }
        });
    });

    it('repairs a deletion committed during a queued write and waits for the repair', async () => {
        state.enabled = true;
        state.article = createArticle();
        const firstStarted = deferred();
        const firstCompleted = deferred();
        const repairStarted = deferred();
        const repairCompleted = deferred();
        const documents = new Map<string, ArticleSearchDocument>();
        let writes = 0;
        const index = {
            addDocuments(batch: ArticleSearchDocument[]) {
                writes += 1;
                const repairing = writes > 1;
                return {
                    async waitTask() {
                        (repairing ? repairStarted : firstStarted).resolve();
                        await (repairing ? repairCompleted : firstCompleted).promise;
                        for (const document of batch) documents.set(document.id, document);
                    }
                };
            }
        };
        Object.assign(SearchService, {
            client: { index: () => index },
            articleIndexReady: Promise.resolve()
        });
        let completed = false;
        const operation = SearchService.upsertArticleById('article1').then(result => {
            completed = true;
            return result;
        });

        await firstStarted.promise;
        state.article.deleted = true;
        firstCompleted.resolve();
        await repairStarted.promise;
        expect(documents.get('article1')?.deleted).toBe(false);
        expect(completed).toBe(false);

        repairCompleted.resolve();
        await expect(operation).resolves.toEqual({ exists: true, indexed: true });
        expect(documents.get('article1')?.deleted).toBe(true);
    });

    it('propagates a failed Meilisearch task instead of reporting indexed success', async () => {
        state.enabled = true;
        state.article = createArticle();
        const failure = new Error('Meilisearch task failed');
        Object.assign(SearchService, {
            client: {
                index: () => ({
                    addDocuments: () => ({
                        waitTask: async () => {
                            throw failure;
                        }
                    })
                })
            },
            articleIndexReady: Promise.resolve()
        });

        await expect(SearchService.upsertArticleById('article1')).rejects.toBe(failure);
    });
});
