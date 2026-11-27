import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Koa from 'koa';
import { once } from 'node:events';
import type { Server } from 'node:http';

const fixtures = vi.hoisted(() => ({
    getArticleByIdWithoutCache: vi.fn(),
    incrementViewCount: vi.fn(),
    getPasteById: vi.fn(),
    isCommentsStale: vi.fn(),
    getCommentsPageByArticle: vi.fn(),
    parseCommentsQuery: vi.fn(),
    createTask: vi.fn(),
    dispatchTask: vi.fn()
}));

vi.mock('@/services/article.service', () => ({
    ArticleService: {
        getArticleByIdWithoutCache: fixtures.getArticleByIdWithoutCache,
        incrementViewCount: fixtures.incrementViewCount
    }
}));
vi.mock('@/services/paste.service', () => ({
    PasteService: {
        getPasteById: fixtures.getPasteById
    }
}));
vi.mock('@/services/recommendation.service', () => ({ RecommendationService: {} }));
vi.mock('@/services/article-history.service', () => ({ ArticleHistoryService: {} }));
vi.mock('@/services/comment.service', () => ({
    CommentService: {
        isCommentsStale: fixtures.isCommentsStale,
        getCommentsPageByArticle: fixtures.getCommentsPageByArticle
    },
    parseCommentsQuery: fixtures.parseCommentsQuery
}));
vi.mock('@/services/task.service', () => ({
    TaskService: {
        createTask: fixtures.createTask,
        dispatchTask: fixtures.dispatchTask
    }
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import articleRouter from '../src/routers/article.router';
import pasteRouter from '../src/routers/paste.router';
import { responseHelper } from '../src/middlewares/response';
import { SaveTarget, TaskType } from '../src/shared/task';

let server: Server;
let origin: string;

beforeAll(async () => {
    const app = new Koa();
    app.use(responseHelper);
    app.use(articleRouter.routes());
    app.use(pasteRouter.routes());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback port');
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
});

beforeEach(() => {
    vi.resetAllMocks();
    fixtures.getArticleByIdWithoutCache.mockResolvedValue({
        id: 'abc12345',
        title: 'Stored article',
        content: 'Hello world',
        deleted: false,
        commentsFetchedAt: new Date('2020-01-01T00:00:00Z')
    });
    fixtures.getPasteById.mockResolvedValue({
        id: 'pst12345',
        content: 'Paste body',
        deleted: false
    });
    fixtures.isCommentsStale.mockReturnValue(true);
    fixtures.parseCommentsQuery.mockReturnValue({ limit: 20 });
    fixtures.getCommentsPageByArticle.mockResolvedValue({
        comments: [
            {
                id: 101,
                content: 'Stored comment',
                time: 1700000000,
                authorId: 42,
                author: {
                    id: 42,
                    name: 'Commenter',
                    color: 'Blue',
                    ccfLevel: 5,
                    xcpcLevel: 0,
                    badge: null
                }
            }
        ],
        nextCursor: null
    });
    fixtures.incrementViewCount.mockResolvedValue(undefined);
    fixtures.createTask.mockResolvedValue({ id: 'task-comments-1' });
    fixtures.dispatchTask.mockResolvedValue(undefined);
});

describe('article and paste visit endpoints do not auto-update', () => {
    it('GET /article/query/:id returns stored article, increments view count, and dispatches no tasks', async () => {
        const response = await fetch(`${origin}/article/query/abc12345`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { code: number; data: { id: string } };
        expect(body.code).toBe(200);
        expect(body.data.id).toBe('abc12345');
        expect(fixtures.incrementViewCount).toHaveBeenCalledWith('abc12345');
        expect(fixtures.createTask).not.toHaveBeenCalled();
        expect(fixtures.dispatchTask).not.toHaveBeenCalled();
    });

    it('GET /article/comments/:id returns stored comments without auto-refreshing even when stale', async () => {
        const response = await fetch(`${origin}/article/comments/abc12345`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            code: number;
            data: {
                comments: Array<{ id: string; content: string }>;
                nextCursor: string | null;
                commentsStale: boolean;
                commentsFetchedAt: string | null;
            };
        };
        expect(body.code).toBe(200);
        expect(body.data.comments).toHaveLength(1);
        expect(body.data.comments[0]).toMatchObject({ id: '101', content: 'Stored comment' });
        expect(body.data.nextCursor).toBeNull();
        expect(body.data.commentsStale).toBe(true);
        expect(body.data.commentsFetchedAt).toBe('2020-01-01T00:00:00.000Z');
        expect(fixtures.createTask).not.toHaveBeenCalled();
        expect(fixtures.dispatchTask).not.toHaveBeenCalled();
    });

    it('POST /article/comments/:id/refresh still explicitly dispatches a comments refresh task', async () => {
        const response = await fetch(`${origin}/article/comments/abc12345/refresh`, {
            method: 'POST'
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { code: number; data: { taskId: string } };
        expect(body.code).toBe(200);
        expect(body.data.taskId).toBe('task-comments-1');
        expect(fixtures.createTask).toHaveBeenCalledWith(TaskType.SAVE, {
            target: SaveTarget.COMMENTS,
            targetId: 'abc12345',
            metadata: {}
        });
        expect(fixtures.dispatchTask).toHaveBeenCalledWith('task-comments-1');
    });

    it('GET /paste/query/:id returns stored paste without creating or dispatching tasks', async () => {
        const response = await fetch(`${origin}/paste/query/pst12345`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { code: number; data: { id: string } };
        expect(body.code).toBe(200);
        expect(body.data.id).toBe('pst12345');
        expect(fixtures.createTask).not.toHaveBeenCalled();
        expect(fixtures.dispatchTask).not.toHaveBeenCalled();
    });
});
