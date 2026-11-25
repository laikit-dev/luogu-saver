<script setup lang="ts">
import { computed, h } from 'vue';
import { RouterLink } from 'vue-router';
import { NDataTable, type DataTableColumns } from 'naive-ui';
import Card from '@/components/Card.vue';
import UserBadge from '@/components/UserBadge.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import type { JudgementItem } from '@/api/judgement.ts';
import {
    getJudgementPermissionNames,
    judgementUserColors,
    type JudgementDisplayOptions
} from '@/utils/judgement.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { formatDate } from '@/utils/render.ts';

const props = defineProps<{
    items: JudgementItem[];
    displayOptions: JudgementDisplayOptions;
}>();
const { buildLuoguUrl } = useLuoguSource();

function renderUser(row: JudgementItem) {
    const color = judgementUserColors[row.user.color?.toLowerCase() ?? ''];
    const children = [
        h(
            RouterLink,
            { class: 'user-name', to: `/user/${row.uid}`, style: { color } },
            { default: () => row.name }
        )
    ];
    if (
        (props.displayOptions.ccf && row.user.ccfLevel) ||
        (props.displayOptions.xcpc && row.user.xcpcLevel)
    ) {
        children.push(
            h(UserPrizeBadge, {
                ccfLevel: props.displayOptions.ccf ? (row.user.ccfLevel ?? 0) : 0,
                xcpcLevel: props.displayOptions.xcpc ? (row.user.xcpcLevel ?? 0) : 0,
                size: 16
            })
        );
    }
    if (props.displayOptions.badge && row.user.badge) {
        children.push(h(UserBadge, { content: row.user.badge, color }));
    }
    return h('div', { class: 'user-cell' }, children);
}

function renderPermissionChanges(row: JudgementItem) {
    const changes = [
        ...getJudgementPermissionNames(row.revoked_permission).map(name =>
            h('span', { class: 'permission-removed' }, name)
        ),
        ...getJudgementPermissionNames(row.added_permission).map(name =>
            h('span', { class: 'permission-added' }, name)
        )
    ];
    return changes.length === 0 ? '—' : h('div', { class: 'permission-list' }, changes);
}

const columns = computed<DataTableColumns<JudgementItem>>(() => {
    const result: DataTableColumns<JudgementItem> = [{ title: 'UID', key: 'uid', width: 100 }];
    if (props.displayOptions.avatar) {
        result.push({
            title: '头像',
            key: 'avatar',
            width: 64,
            render: row =>
                h(
                    'a',
                    {
                        class: 'user-avatar-link',
                        href: buildLuoguUrl(`/user/${row.uid}`),
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        'aria-label': `在洛谷查看 ${row.name} 的主页`
                    },
                    [
                        h(
                            'span',
                            { class: 'user-avatar-fallback', 'aria-hidden': 'true' },
                            (row.name || String(row.uid)).trim().slice(0, 1).toUpperCase()
                        ),
                        h('img', {
                            class: 'user-avatar',
                            src: `https://cdn.luogu.com.cn/upload/usericon/${row.uid}.png`,
                            alt: `${row.name} 的头像`,
                            loading: 'lazy',
                            onError: (event: Event) => {
                                const img = event.target as HTMLImageElement | null;
                                if (img) img.style.display = 'none';
                            }
                        })
                    ]
                )
        });
    }
    result.push(
        { title: '用户', key: 'name', minWidth: 170, render: renderUser },
        {
            title: '权限变更',
            key: 'permissions',
            minWidth: 230,
            render: renderPermissionChanges
        }
    );
    if (props.displayOptions.reason) {
        result.push({
            title: '原因',
            key: 'reason',
            minWidth: 300,
            render: row => row.reason || '—'
        });
    }
    if (props.displayOptions.time) {
        result.push({
            title: '时间',
            key: 'time',
            width: 180,
            render: row => formatDate(row.time * 1000)
        });
    }
    return result;
});
</script>

<template>
    <Card class="judgement-table">
        <n-data-table
            :columns="columns"
            :data="items"
            :row-key="(row: JudgementItem) => row.id"
            :scroll-x="1044"
            :bordered="false"
        />
    </Card>
</template>

<style scoped>
.judgement-table {
    min-width: 0;
}
:deep(.user-cell),
:deep(.permission-list) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-1) var(--ui-space-2);
}
:deep(.user-name) {
    font-weight: 600;
    text-decoration: none;
    overflow-wrap: anywhere;
}
:deep(.user-avatar-link) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--ui-panel-color);
    color: var(--ui-secondary-text-color);
    text-decoration: none;
    flex-shrink: 0;
}
:deep(.user-avatar-fallback) {
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
}
:deep(.user-avatar-link:focus-visible) {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}
:deep(.user-avatar) {
    position: absolute;
    inset: 0;
    display: block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
}
:deep(.permission-added) {
    color: var(--ui-success-color);
}
:deep(.permission-removed) {
    color: var(--ui-error-color);
}
:deep(.n-data-table-td) {
    padding-top: var(--ui-space-2);
    padding-bottom: var(--ui-space-2);
    overflow-wrap: anywhere;
}
</style>
