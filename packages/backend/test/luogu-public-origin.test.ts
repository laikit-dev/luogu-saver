import { describe, expect, it, vi } from 'vitest';
import { ServerSchema } from '../src/config/schemas/server';
import { C3vkMode } from '../src/shared/c3vk';
import { ArticleHandler } from '../src/workers/handlers/task/save/article.handler';
import type { SaveTask } from '../src/workers/types';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    saveLuoguArticle: vi.fn(),
    upsertLuoguUser: vi.fn()
}));

vi.mock('@/config', () => ({
    config: { network: { luoguPublicOrigin: 'https://www.luogu.com.cn' } }
}));
vi.mock('@/utils/fetch', () => ({ fetch: mocks.fetch }));
vi.mock('@/lib/socket', () => ({ emitToRoom: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn() } }));
vi.mock('@/services/article.service', () => ({
    ArticleService: { saveLuoguArticle: mocks.saveLuoguArticle }
}));
vi.mock('@/services/user.service', () => ({
    UserService: { upsertLuoguUser: mocks.upsertLuoguUser }
}));

describe('Luogu public article and profile origin', () => {
    it('preserves the original default and allows the alternate official origin only', () => {
        expect(ServerSchema.parse({}).network.luoguPublicOrigin).toBe('https://www.luogu.com');
        expect(
            ServerSchema.parse({ network: { luoguPublicOrigin: 'https://www.luogu.com.cn' } })
                .network.luoguPublicOrigin
        ).toBe('https://www.luogu.com.cn');
        for (const luoguPublicOrigin of ['http://www.luogu.com', 'https://www.luogu.com/user']) {
            expect(ServerSchema.safeParse({ network: { luoguPublicOrigin } }).success).toBe(false);
        }
    });

    it('archives the article and passes its inline author badge to the user upsert', async () => {
        const author = {
            uid: 42,
            name: 'Author',
            color: 'Purple',
            ccfLevel: 6,
            xcpcLevel: 0,
            badge: 'Aya'
        };
        const article = { lid: 'article1', content: 'Body', author };
        mocks.fetch.mockResolvedValue({ data: { article } });
        mocks.saveLuoguArticle.mockResolvedValue({ skipped: false, content: article.content });
        const task = { payload: { targetId: article.lid } } as SaveTask;

        await expect(new ArticleHandler().handle(task)).resolves.toMatchObject({
            skipNextStep: false,
            data: { text: article.content }
        });
        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://www.luogu.com.cn/article/article1',
            C3vkMode.MODERN
        );
        expect(mocks.upsertLuoguUser).toHaveBeenCalledWith({
            id: 42,
            name: 'Author',
            color: 'Purple',
            ccfLevel: 6,
            xcpcLevel: 0,
            badge: 'Aya'
        });
        expect(mocks.saveLuoguArticle).toHaveBeenCalledWith(article, undefined);
    });
});
