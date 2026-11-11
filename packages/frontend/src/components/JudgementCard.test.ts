import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import JudgementCard from './JudgementCard.vue';
import type { JudgementItem } from '@/api/judgement.ts';
import { presets } from '@/styles/theme/presets.ts';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';
import { groupJudgementsForCards } from '@/utils/judgement.ts';

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

async function renderItem(record: JudgementItem, groupItems?: JudgementItem[]) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/user/:uid', component: { render: () => null } }]
    });
    const app = createSSRApp({
        render: () =>
            h(JudgementCard, {
                item: record,
                groupItems,
                displayOptions: {
                    avatar: true,
                    reason: true,
                    time: true,
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
    it('groups matching changes while preserving separate reasons, masks and hidden records', () => {
        const records = [
            item,
            { ...item, id: 2, reason: 'Other reason' },
            { ...item, id: 3, uid: 5678 },
            { ...item, id: 4, revoked_permission: 65536 },
            { ...item, id: 5, added_permission: 65536 },
            { ...item, id: 6, hidden: true },
            { ...item, id: 7, hidden: true }
        ];

        expect(
            groupJudgementsForCards(records).map(group => group.map(record => record.id))
        ).toEqual([[1, 3], [2], [4], [5], [6], [7]]);
        expect(groupJudgementsForCards([])).toEqual([]);
    });

    it('renders grouped users with their own colors and a shared reason and time range', async () => {
        const second = {
            ...item,
            id: 2,
            uid: 5678,
            name: 'SecondUser',
            time: item.time + 60,
            user: { color: 'blue' }
        };
        const markup = await renderItem(item, [item, second]);

        expect(markup).toContain('/user/1234');
        expect(markup).toContain('/user/5678');
        expect(markup).toContain('SecondUser');
        expect(markup).toContain('color:#3498DB');
        expect(markup.split(item.reason!).length - 1).toBe(1);
        expect(markup).toContain('～');
    });

    it('always displays the Luogu name color', async () => {
        const markup = await renderItem({ ...item, user: { color: 'RED' } });

        expect(markup).toContain('color:#FE4C61');
    });

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
