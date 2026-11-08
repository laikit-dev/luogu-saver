import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import JudgementCard from './JudgementCard.vue';
import type { JudgementItem } from '@/api/judgement.ts';
import { presets } from '@/styles/theme/presets.ts';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';

const item: JudgementItem = {
    id: 1,
    uid: 1234,
    name: 'ArchivedUser',
    reason: '学术不端处理',
    revoked_permission: 0,
    added_permission: 0,
    time: Date.parse('2026-11-07T20:36:00Z') / 1000,
    user: {},
    fetch_log_id: 1,
    log_fetched_at: null,
    created_at: '2026-11-07T20:37:00Z',
    hidden: false
};

async function renderItem(record: JudgementItem) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/user/:uid', component: { render: () => null } }]
    });
    const app = createSSRApp({
        render: () =>
            h(JudgementCard, {
                item: record,
                displayOptions: {
                    avatar: true,
                    reason: true,
                    time: true,
                    color: true,
                    badge: false,
                    ccf: true,
                    xcpc: true
                }
            })
    });
    app.use(router);
    app.provide(uiThemeKey, ref(presets.default.light));
    return renderToString(app);
}

beforeAll(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('JudgementCard permission visibility', () => {
    it('shows an unknown change instead of claiming a hidden record changed no permissions', async () => {
        const reason = '此记录已被账号所有者要求隐藏';
        const markup = await renderItem({ ...item, hidden: true, reason });

        expect(markup).toContain('—');
        expect(markup).not.toContain('无权限变更');
        expect(markup).not.toContain('取消权限');
        expect(markup).not.toContain('授予权限');
        expect(markup).toContain(reason);
        expect(markup).toContain(item.name);
    });

    it('identifies a public zero-mask event as having no permission changes', async () => {
        const markup = await renderItem(item);

        expect(markup).toContain('无权限变更');
        expect(markup).not.toContain('—');
    });
});
