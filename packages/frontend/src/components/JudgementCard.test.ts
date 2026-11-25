import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import { setup as setupCssSsr } from '@css-render/vue3-ssr';
import JudgementCard from './JudgementCard.vue';
import JudgementTable from './JudgementTable.vue';
import type { JudgementItem } from '@/api/judgement.ts';
import { presets } from '@/styles/theme/presets.ts';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';
import { groupJudgementsForCards, type JudgementDisplayOptions } from '@/utils/judgement.ts';

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
    created_at: '2026-11-07T20:37:00Z'
};

async function renderItem(
    record: JudgementItem,
    groupItems?: JudgementItem[],
    options?: Partial<JudgementDisplayOptions>
) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/user/:uid', component: { render: () => null } }]
    });
    const displayOptions: JudgementDisplayOptions = {
        avatar: true,
        reason: true,
        time: true,
        badge: false,
        ccf: true,
        xcpc: true,
        ...options
    };
    const app = createSSRApp({
        render: () =>
            displayOptions.layout === 'table'
                ? h(JudgementTable, { items: [record], displayOptions })
                : h(JudgementCard, { item: record, groupItems, displayOptions })
    });
    app.use(router);
    app.provide(uiThemeKey, ref(presets.light.vars));
    setupCssSsr(app);
    return renderToString(app);
}

beforeAll(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('JudgementCard permission changes', () => {
    it('groups matching changes while preserving separate reasons and masks', () => {
        const records = [
            item,
            { ...item, id: 2, reason: 'Other reason' },
            { ...item, id: 3, uid: 5678 },
            { ...item, id: 4, revoked_permission: 65536 },
            { ...item, id: 5, added_permission: 65536 }
        ];

        expect(
            groupJudgementsForCards(records).map(group => group.map(record => record.id))
        ).toEqual([[1, 3], [2], [4], [5]]);
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

    it.each(['card', 'table'] as const)(
        'renders the badge after the icons in %s layout',
        async layout => {
            const record = {
                ...item,
                user: { color: 'purple', ccfLevel: 6, xcpcLevel: 8, badge: 'Aya' }
            };
            const markup = await renderItem(record, undefined, { layout, badge: true });

            expect(markup).toMatch(
                /ArchivedUser[\s\S]*aria-label="OI 等级 6"[\s\S]*aria-label="ICPC\/CCPC 等级 8"[\s\S]*>Aya</
            );

            const hidden = await renderItem(record, undefined, { layout, ccf: false });
            expect(hidden).not.toContain('OI 等级 6');
            expect(hidden).toContain('ICPC/CCPC 等级 8');
            expect(hidden).not.toContain('Aya');
        }
    );

    it('identifies a zero-mask event as having no permission changes', async () => {
        const markup = await renderItem(item);

        expect(markup).toContain('无权限变更');
        expect(markup).not.toContain('—');
    });
});
