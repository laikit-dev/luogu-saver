import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { C3vkMode } from '../src/shared/c3vk';
import { fetch, LuoguHttpError } from '../src/utils/fetch';
import { formatLuoguHttpError, formatMissingLuoguResourceError } from '../src/utils/luogu-api';
import { ArticleHandler } from '../src/workers/handlers/task/save/article.handler';
import { PasteHandler } from '../src/workers/handlers/task/save/paste.handler';
import type { SaveTask } from '../src/workers/types';

const mocks = vi.hoisted(() => ({
    axiosGet: vi.fn(),
    isNative429TorOnly: vi.fn(async () => false)
}));

vi.mock('axios', () => ({
    default: { get: mocks.axiosGet }
}));

vi.mock('@/config', () => ({
    config: {
        network: {
            timeout: 5000,
            luoguPublicOrigin: 'https://www.luogu.com',
            tor: { enabled: false }
        }
    }
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('@/utils/tor', () => ({
    getTorAxiosConfig: vi.fn(() => ({})),
    isNative429TorOnly: mocks.isNative429TorOnly,
    markNative429TorOnly: vi.fn(),
    rotateTorExitIp: vi.fn()
}));

vi.mock('@/services/article.service', () => ({
    ArticleService: { saveLuoguArticle: vi.fn() }
}));

vi.mock('@/services/paste.service', () => ({
    PasteService: { saveLuoguPaste: vi.fn() }
}));

vi.mock('@/services/user.service', () => ({
    UserService: { upsertLuoguUser: vi.fn() }
}));

vi.mock('@/lib/socket', () => ({
    emitToRoom: vi.fn()
}));

describe('Luogu upstream error reporting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isNative429TorOnly.mockResolvedValue(false);
    });

    it('throws LuoguHttpError (UnrecoverableError) with Lentille metadata on HTTP 401', async () => {
        mocks.axiosGet.mockResolvedValue({
            status: 401,
            headers: {},
            data: JSON.stringify({
                instance: 'main',
                template: 'error',
                status: 401,
                data: {
                    errorCode: 401,
                    errorType: 'Symfony\\Component\\HttpKernel\\Exception\\HttpException',
                    errorMessage: '没有权限请求此资源。'
                }
            })
        });

        let caught: unknown;
        try {
            await fetch('https://www.luogu.com/article/eq0ctcuu', C3vkMode.MODERN);
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(LuoguHttpError);
        expect(caught).toBeInstanceOf(UnrecoverableError);
        expect(caught).toMatchObject({
            status: 401,
            errorCode: 401,
            errorMessage: '没有权限请求此资源。'
        });
    });

    it('reports non-existent article 404 in ArticleHandler without exposing upstream details', async () => {
        mocks.axiosGet.mockResolvedValue({
            status: 404,
            headers: {},
            data: {
                instance: 'main',
                template: 'error',
                status: 404,
                data: {
                    errorCode: 404,
                    errorType: 'Symfony\\Component\\HttpKernel\\Exception\\NotFoundHttpException',
                    errorMessage: '找不到文章'
                }
            }
        });

        const task = { payload: { targetId: 'aaaaaaaa' } } as SaveTask;
        await expect(new ArticleHandler().handle(task)).rejects.toSatisfy(
            (err: unknown) => err instanceof UnrecoverableError && err.message === '文章不存在'
        );
    });

    it('reports non-public article 401 in ArticleHandler without exposing upstream details', async () => {
        mocks.axiosGet.mockResolvedValue({
            status: 401,
            headers: {},
            data: {
                instance: 'main',
                template: 'error',
                status: 401,
                data: {
                    errorCode: 401,
                    errorType: 'Symfony\\Component\\HttpKernel\\Exception\\HttpException',
                    errorMessage: '没有权限请求此资源。'
                }
            }
        });

        const task = { payload: { targetId: 'eq0ctcuu' } } as SaveTask;
        await expect(new ArticleHandler().handle(task)).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof UnrecoverableError && err.message === '文章未公开或无权访问'
        );
    });

    it('reports 403/429 LuoguHttpError and empty payload cleanly', async () => {
        mocks.axiosGet.mockResolvedValueOnce({
            status: 403,
            headers: {},
            data: ''
        });
        await expect(
            new ArticleHandler().handle({ payload: { targetId: 'forbidden' } } as SaveTask)
        ).rejects.toMatchObject({
            message: '访问被拒绝'
        });

        mocks.axiosGet.mockResolvedValueOnce({
            status: 429,
            headers: {},
            data: ''
        });
        await expect(
            new ArticleHandler().handle({ payload: { targetId: 'ratelimited' } } as SaveTask)
        ).rejects.toMatchObject({
            message: '请求过于频繁，请稍后重试'
        });

        mocks.axiosGet.mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: { data: {} }
        });
        await expect(
            new ArticleHandler().handle({ payload: { targetId: 'empty' } } as SaveTask)
        ).rejects.toMatchObject({
            message: '文章不存在'
        });
    });

    it('reports missing 404 and unauthorized 401 paste errors in PasteHandler', async () => {
        mocks.axiosGet.mockResolvedValueOnce({
            status: 404,
            headers: {},
            data: {
                status: 404,
                data: {
                    errorCode: 404,
                    errorMessage: '找不到剪贴板'
                }
            }
        });
        await expect(
            new PasteHandler().handle({ payload: { targetId: 'aaaaaaaa' } } as SaveTask)
        ).rejects.toSatisfy(
            (err: unknown) => err instanceof UnrecoverableError && err.message === '剪贴板不存在'
        );

        mocks.axiosGet.mockResolvedValueOnce({
            status: 401,
            headers: {},
            data: {
                status: 401,
                data: {
                    errorCode: 401,
                    errorMessage: '没有权限请求此资源。'
                }
            }
        });
        await expect(
            new PasteHandler().handle({ payload: { targetId: 'private0' } } as SaveTask)
        ).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof UnrecoverableError && err.message === '剪贴板未公开或无权访问'
        );
    });

    it('formats generic 5xx and helper messages cleanly without upstream details', () => {
        const serverErr = new LuoguHttpError(502, 'Access blocked with code 502', {
            errorMessage: 'Bad Gateway'
        });
        expect(formatLuoguHttpError('文章', serverErr)).toBe('获取文章失败');
        expect(
            formatMissingLuoguResourceError('文章', {
                status: 500,
                data: { errorCode: 500, errorMessage: '' }
            })
        ).toBe('获取文章失败');
    });
});
