<script setup lang="ts">
import { isAxiosError } from 'axios';
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
    NButton,
    NAlert,
    NCheckbox,
    NCheckboxGroup,
    NDataTable,
    NDatePicker,
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NPagination,
    NSelect,
    NSpin,
    useDialog,
    useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { Hammer, ExternalLink, RefreshCw, Search, Trash2 } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import UserBadge from '@/components/UserBadge.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { getJudgements, hideMyJudgementHistory, type JudgementItem } from '@/api/judgement.ts';
import { JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY } from '@/utils/constants.ts';
import { formatDate } from '@/utils/render.ts';
import { getJudgementPermissionNames, judgementPermissions } from '@/utils/judgement.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500].map(value => ({
    label: `${value} 条/页`,
    value
}));
const DEFAULT_PAGE_SIZE = 50;

type ExpandedPanel = 'permissions' | 'display' | null;

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const hidingHistory = ref(false);
const errorMessage = ref<string | null>(null);
const judgements = ref<JudgementItem[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(DEFAULT_PAGE_SIZE);
const expandedPanel = ref<ExpandedPanel>(null);
const filterUid = ref<number | null>(null);
const filterName = ref('');
const filterReason = ref('');
const filterTimeRange = ref<[number, number] | null>(null);
const filterRevPerm = ref<number[]>([]);
const filterAddPerm = ref<number[]>([]);
const filterNoPerm = ref(false);
const mobileViewport = ref(false);
let latestRequestId = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const defaultDisplayOptions = {
    uid: true,
    avatar: true,
    reason: true,
    time: true,
    color: true,
    badge: false,
    ccf: true,
    xcpc: true
};
const savedDisplayOptions = useLocalStorage(
    JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY,
    defaultDisplayOptions
);
const displayOptions = ref({ ...defaultDisplayOptions, ...(savedDisplayOptions.value ?? {}) });

watch(
    displayOptions,
    value => {
        savedDisplayOptions.value = { ...value };
    },
    { deep: true }
);

const permissionList = Object.entries(judgementPermissions).map(([value, label]) => ({
    value: Number(value),
    label
}));

const userColors: Record<string, string> = {
    red: '#FE4C61',
    orange: '#F39C11',
    green: '#52C41A',
    blue: '#3498DB',
    purple: '#9D3DCF',
    gray: '#BFBFBF',
    cheater: '#AD8B00'
};

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

function renderUser(row: JudgementItem) {
    const color = displayOptions.value.color
        ? userColors[row.user.color?.toLowerCase() ?? '']
        : undefined;
    const children = [
        h(
            RouterLink,
            {
                class: 'user-name',
                to: `/user/${row.uid}`,
                style: color ? { color } : undefined
            },
            { default: () => row.name }
        )
    ];
    if (displayOptions.value.badge && row.user.badge) {
        children.push(h(UserBadge, { content: row.user.badge, color }));
    }
    if (
        (displayOptions.value.ccf && row.user.ccfLevel) ||
        (displayOptions.value.xcpc && row.user.xcpcLevel)
    ) {
        children.push(
            h(UserPrizeBadge, {
                ccfLevel: displayOptions.value.ccf ? (row.user.ccfLevel ?? 0) : 0,
                xcpcLevel: displayOptions.value.xcpc ? (row.user.xcpcLevel ?? 0) : 0,
                size: 16
            })
        );
    }
    return h('div', { class: 'user-cell' }, children);
}

function renderMobileUser(row: JudgementItem) {
    return h('div', { class: 'mobile-user-cell' }, [
        h('img', {
            class: 'user-avatar',
            src: `https://cdn.luogu.com.cn/upload/usericon/${row.uid}.png`,
            alt: `${row.name} 的头像`,
            loading: 'lazy'
        }),
        h('div', { class: 'mobile-user-details' }, [
            renderUser(row),
            h('span', { class: 'mobile-user-uid' }, `UID ${row.uid}`)
        ])
    ]);
}

function updateMobileViewport() {
    mobileViewport.value = window.innerWidth <= 768;
}

function buildQueryParams() {
    return {
        page: page.value,
        limit: limit.value,
        uid: filterUid.value === null ? undefined : [filterUid.value],
        name: filterName.value.trim() || undefined,
        reason: filterReason.value.trim() || undefined,
        start_time: filterTimeRange.value ? Math.floor(filterTimeRange.value[0] / 1000) : undefined,
        end_time: filterTimeRange.value ? Math.floor(filterTimeRange.value[1] / 1000) : undefined,
        rev_perm: filterRevPerm.value.length > 0 ? filterRevPerm.value : undefined,
        add_perm: filterAddPerm.value.length > 0 ? filterAddPerm.value : undefined,
        no_perm: filterNoPerm.value ? 1 : undefined
    };
}

function getRequestErrorMessage(error: unknown): string {
    const apiMessage = isAxiosError(error) ? error.response?.data?.message : undefined;
    if (typeof apiMessage === 'string') return apiMessage;
    if (error instanceof Error) return error.message;
    return String(error);
}

async function loadJudgements() {
    const requestId = ++latestRequestId;
    loading.value = true;
    errorMessage.value = null;
    try {
        const response = await getJudgements(buildQueryParams());
        if (requestId !== latestRequestId) return;
        if (response.code !== 200) throw new Error(response.message || '接口返回失败状态');

        judgements.value = response.data.items;
        total.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestRequestId) return;
        console.error('[JudgementView] Failed to load judgements:', error);
        errorMessage.value = getRequestErrorMessage(error);
        judgements.value = [];
        total.value = 0;
        message.error(`获取陶片放逐记录失败：${errorMessage.value}`);
    } finally {
        if (requestId === latestRequestId) loading.value = false;
    }
}

function togglePanel(panel: Exclude<ExpandedPanel, null>) {
    expandedPanel.value = expandedPanel.value === panel ? null : panel;
}

function handleSearch() {
    page.value = 1;
    void loadJudgements();
}

function handleReset() {
    filterUid.value = null;
    filterName.value = '';
    filterReason.value = '';
    filterTimeRange.value = null;
    filterRevPerm.value = [];
    filterAddPerm.value = [];
    filterNoPerm.value = false;
    handleSearch();
}

function handlePageChange(nextPage: number) {
    page.value = nextPage;
    void loadJudgements();
}

function handleLimitChange(nextLimit: number) {
    limit.value = nextLimit;
    handleSearch();
}

function handleHideHistory() {
    if (!isAuthenticated.value) {
        dialog.warning({
            title: '需要登录',
            content: '申请删除陶片放逐记录需要登录，是否前往登录？',
            positiveText: '去登录',
            negativeText: '取消',
            onPositiveClick: () => startCpOAuthLogin('/judgement')
        });
        return;
    }

    dialog.warning({
        title: '申请删除陶片放逐记录',
        content: () =>
            h('div', { class: 'hide-history-dialog' }, [
                h('p', '注意：'),
                h('ul', [
                    h('li', '仅影响当前登录账号绑定的洛谷 UID。'),
                    h('li', '将一次性隐藏申请时刻之前的全部历史记录，不能选择部分记录。'),
                    h('li', '原始数据仍保留在数据库中，以满足审计、安全与合规的合理需求。'),
                    h(
                        'li',
                        '为避免时间线混乱，记录本身仍会显示；但授予或撤销的具体权限及原始原因将被隐藏。公开列表、个人主页和 API 均会显示“此记录已被账号所有者要求隐藏”。申请后新产生的记录不会被隐藏。'
                    ),
                    h('li', '点击确认后将立即生效，且无法撤销。')
                ]),
                h('p', '确认申请吗？')
            ]),
        positiveText: '确认',
        negativeText: '取消',
        onPositiveClick: async () => {
            hidingHistory.value = true;
            try {
                const response = await hideMyJudgementHistory();
                if (response.code !== 200) throw new Error(response.message || '申请删除失败');
                message.success('操作成功');
                await loadJudgements();
            } catch (error) {
                message.error(getRequestErrorMessage(error) || '申请删除失败');
            } finally {
                hidingHistory.value = false;
            }
        }
    });
}

const columns = computed<DataTableColumns<JudgementItem>>(() => {
    const result: DataTableColumns<JudgementItem> = [];
    if (mobileViewport.value) {
        result.push({ title: '用户', key: 'name', width: 180, render: renderMobileUser });
        result.push({
            title: '权限变更',
            key: 'permissions',
            width: 150,
            render: renderPermissionChanges
        });
        if (displayOptions.value.reason) {
            result.push({
                title: '原因',
                key: 'reason',
                width: 240,
                render: row => row.reason || '-'
            });
        }
        if (displayOptions.value.time) {
            result.push({
                title: '时间',
                key: 'time',
                width: 160,
                render: row => formatDate(row.time * 1000)
            });
        }
        return result;
    }
    if (displayOptions.value.uid) {
        result.push({
            title: 'UID',
            key: 'uid',
            width: 100,
            render: row => row.uid
        });
    }
    if (displayOptions.value.avatar) {
        result.push({
            title: '头像',
            key: 'avatar',
            width: 58,
            render: row =>
                h(
                    'a',
                    {
                        class: 'user-avatar-link',
                        href: `https://www.luogu.com.cn/user/${row.uid}`,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        'aria-label': `在洛谷查看 ${row.name} 的主页`
                    },
                    h('img', {
                        class: 'user-avatar',
                        src: `https://cdn.luogu.com.cn/upload/usericon/${row.uid}.png`,
                        alt: `${row.name} 的头像`,
                        loading: 'lazy'
                    })
                )
        });
    }
    result.push({ title: '用户', key: 'name', minWidth: 170, render: renderUser });
    result.push({
        title: '权限变更',
        key: 'permissions',
        minWidth: 230,
        render: renderPermissionChanges
    });
    if (displayOptions.value.reason) {
        result.push({
            title: '原因',
            key: 'reason',
            minWidth: 460,
            render: row => row.reason || '-'
        });
    }
    if (displayOptions.value.time) {
        result.push({
            title: '时间',
            key: 'time',
            width: 180,
            render: row => formatDate(row.time * 1000)
        });
    }
    return result;
});

const paginationVisible = computed(() => total.value > limit.value);

onMounted(() => {
    updateMobileViewport();
    window.addEventListener('resize', updateMobileViewport);
    void loadJudgements();
    refreshTimer = setInterval(() => void loadJudgements(), 60_000);
});

onUnmounted(() => {
    window.removeEventListener('resize', updateMobileViewport);
    if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
    <div class="judgement-page">
        <CardTitle title="陶片放逐" :icon="Hammer">
            洛谷社区用户权限变更记录
            <RouterLink class="detail-link" to="/judgement/logs">
                同步日志与 API
                <n-icon :component="ExternalLink" />
            </RouterLink>
        </CardTitle>

        <Card class="filter-card">
            <div class="filter-grid">
                <div class="filter-item">
                    <label for="filter-uid">UID</label>
                    <n-input-number id="filter-uid" v-model:value="filterUid" :min="1" clearable />
                </div>
                <div class="filter-item">
                    <label for="filter-name">用户名</label>
                    <n-input
                        id="filter-name"
                        v-model:value="filterName"
                        placeholder="模糊匹配"
                        clearable
                        @keyup.enter="handleSearch"
                    />
                </div>
                <div class="filter-item">
                    <label for="filter-reason">原因</label>
                    <n-input
                        id="filter-reason"
                        v-model:value="filterReason"
                        placeholder="模糊匹配"
                        clearable
                        @keyup.enter="handleSearch"
                    />
                </div>
                <div class="filter-item">
                    <label>时间段</label>
                    <n-date-picker
                        v-model:value="filterTimeRange"
                        type="datetimerange"
                        clearable
                        :actions="['confirm']"
                    />
                </div>
            </div>
            <div class="quick-actions">
                <n-button secondary @click="togglePanel('permissions')">权限筛选</n-button>
                <n-button secondary @click="togglePanel('display')">显示选项</n-button>
                <n-select
                    class="limit-select"
                    :value="limit"
                    :options="PAGE_SIZE_OPTIONS"
                    @update:value="handleLimitChange"
                />
                <n-button
                    tag="a"
                    href="https://www.luogu.com.cn/judgement"
                    target="_blank"
                    rel="noopener noreferrer"
                    secondary
                >
                    <template #icon><n-icon :component="ExternalLink" /></template>
                    查看原始页面
                </n-button>
                <div class="filter-actions">
                    <n-button type="primary" @click="handleSearch">
                        <template #icon><n-icon :component="Search" /></template>
                        查询
                    </n-button>
                    <n-button secondary @click="handleReset">
                        <template #icon><n-icon :component="RefreshCw" /></template>
                        重置
                    </n-button>
                </div>
            </div>
            <div
                v-if="expandedPanel === 'permissions'"
                class="filter-expand-panel permission-expand-panel"
            >
                <n-checkbox-group v-model:value="filterRevPerm" class="permission-filter-column">
                    <strong class="permission-removed">移除</strong>
                    <n-checkbox
                        v-for="permission in permissionList"
                        :key="`expanded-rev-${permission.value}`"
                        :value="permission.value"
                        :label="permission.label"
                    />
                </n-checkbox-group>
                <n-checkbox-group v-model:value="filterAddPerm" class="permission-filter-column">
                    <strong class="permission-added">添加</strong>
                    <n-checkbox
                        v-for="permission in permissionList"
                        :key="`expanded-add-${permission.value}`"
                        :value="permission.value"
                        :label="permission.label"
                    />
                </n-checkbox-group>
                <div class="permission-filter-column">
                    <strong>特殊</strong>
                    <n-checkbox v-model:checked="filterNoPerm" label="无权限变更（学术不端棕名）" />
                </div>
            </div>
            <div
                v-if="expandedPanel === 'display'"
                class="filter-expand-panel display-expand-panel"
            >
                <div class="display-option-group">
                    <strong>标记</strong>
                    <n-checkbox v-model:checked="displayOptions.color" label="名字颜色" />
                    <n-checkbox v-model:checked="displayOptions.badge" label="Badge" />
                    <n-checkbox v-model:checked="displayOptions.ccf" label="OI 认证" />
                    <n-checkbox v-model:checked="displayOptions.xcpc" label="XCPC 认证" />
                </div>
                <div class="display-option-group">
                    <strong>列</strong>
                    <n-checkbox v-model:checked="displayOptions.uid" label="UID" />
                    <n-checkbox v-model:checked="displayOptions.avatar" label="头像" />
                    <n-checkbox v-model:checked="displayOptions.reason" label="原因" />
                    <n-checkbox v-model:checked="displayOptions.time" label="时间" />
                </div>
            </div>
        </Card>

        <Card class="table-card">
            <div class="table-toolbar">
                <span>共 {{ total }} 条记录</span>
                <div class="table-toolbar-actions">
                    <n-button secondary :loading="loading" @click="loadJudgements">
                        <template #icon><n-icon :component="RefreshCw" /></template>
                        刷新
                    </n-button>
                    <n-button
                        type="error"
                        secondary
                        :loading="hidingHistory"
                        @click="handleHideHistory"
                    >
                        <template #icon><n-icon :component="Trash2" /></template>
                        申请删除
                    </n-button>
                </div>
            </div>
            <n-alert v-if="errorMessage" class="load-error" type="error" :show-icon="true">
                获取记录失败：{{ errorMessage }}
            </n-alert>
            <n-spin :show="loading">
                <n-data-table
                    :columns="columns"
                    :data="judgements"
                    :bordered="false"
                    :single-line="false"
                    :scroll-x="
                        mobileViewport
                            ? 330 +
                              (displayOptions.reason ? 240 : 0) +
                              (displayOptions.time ? 160 : 0)
                            : 1200
                    "
                    size="small"
                    :row-key="row => row.id"
                >
                    <template #empty>
                        <n-empty :description="loading ? '正在加载' : '没有符合条件的记录'" />
                    </template>
                </n-data-table>
            </n-spin>
            <div v-if="paginationVisible" class="pagination-wrap">
                <n-pagination
                    :page="page"
                    :page-size="limit"
                    :item-count="total"
                    @update:page="handlePageChange"
                />
            </div>
        </Card>
    </div>
</template>

<style scoped>
.judgement-page {
    max-width: 1220px;
    margin: 0 auto;
}
.filter-card,
.table-card {
    margin-top: 16px;
}
.filter-card {
    padding: 14px 16px;
}
.detail-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    color: var(--ui-primary-color);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
}
.detail-link:hover {
    text-decoration: underline;
}
.filter-grid {
    display: grid;
    grid-template-columns: minmax(120px, 0.7fr) minmax(150px, 0.75fr) minmax(240px, 1.2fr) minmax(
            280px,
            1.35fr
        );
    gap: 8px 10px;
}
.filter-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.filter-item label,
.table-toolbar {
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    font-weight: 500;
}
.load-error {
    margin-bottom: 12px;
}
.hide-history-dialog p {
    margin: 0;
}
.hide-history-dialog ul {
    margin: 10px 0;
    padding-left: 22px;
}
.hide-history-dialog li + li {
    margin-top: 6px;
}
.filter-actions,
.table-toolbar,
.pagination-wrap {
    display: flex;
    align-items: center;
}
.filter-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
}
.quick-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.limit-select {
    width: 120px;
}
.filter-expand-panel {
    display: grid;
    gap: 20px;
    margin-top: 12px;
    padding: 16px;
    border: 1px solid var(--ui-border-color);
    border-radius: 8px;
    background: var(--ui-card-color);
}
.permission-expand-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 24px;
}
.display-expand-panel {
    grid-template-columns: repeat(2, minmax(180px, max-content));
}
.display-option-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
}
.display-option-group strong {
    width: 100%;
}
.table-toolbar {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}
.table-toolbar-actions {
    display: flex;
    gap: 8px;
}
.pagination-wrap {
    justify-content: center;
    margin-top: 16px;
}
:deep(.permission-list) {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
}
:deep(.filter-expand-panel .permission-filter-column) {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-content: start;
    gap: 5px 12px;
}
:deep(.permission-filter-column > strong) {
    grid-column: 1 / -1;
}
:deep(.permission-expand-panel > .permission-filter-column:last-child) {
    grid-column: 1 / -1;
    grid-template-columns: max-content 1fr;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid var(--ui-border-color);
}
:deep(.permission-expand-panel > .permission-filter-column:last-child > strong) {
    grid-column: auto;
}
:deep(.permission-added) {
    color: #52c41a;
}
:deep(.permission-removed) {
    color: #fe4c61;
}
:deep(.user-cell) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
:deep(.user-name) {
    font-weight: 600;
    text-decoration: none;
}
:deep(.user-avatar-link) {
    display: inline-flex;
    border-radius: 50%;
}
:deep(.user-avatar-link:focus-visible) {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}
:deep(.user-avatar) {
    display: block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
}
:deep(.n-data-table-td) {
    padding-top: 7px !important;
    padding-bottom: 7px !important;
}
@media (max-width: 768px) {
    .judgement-page {
        min-width: 0;
    }
    .filter-card,
    .table-card {
        margin-top: 12px;
        padding: 12px;
    }
    .filter-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    .quick-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .quick-actions > .n-button,
    .limit-select {
        min-width: 0;
        max-width: 100%;
        width: 100%;
    }
    .quick-actions > .n-button {
        padding-right: 8px;
        padding-left: 8px;
    }
    .quick-actions > :deep(.n-button .n-button__content) {
        min-width: 0;
        white-space: nowrap;
    }
    .filter-actions {
        grid-column: 1 / -1;
        margin-left: 0;
    }
    .filter-actions > .n-button {
        flex: 1;
    }
    .filter-expand-panel {
        padding: 12px;
    }
    .permission-expand-panel,
    .display-expand-panel {
        grid-template-columns: minmax(0, 1fr);
    }
    :deep(.filter-expand-panel .permission-filter-column) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :deep(.permission-expand-panel > .permission-filter-column:last-child) {
        grid-column: auto;
        grid-template-columns: minmax(0, 1fr);
    }
    .pagination-wrap {
        justify-content: flex-start;
        overflow-x: auto;
        padding-bottom: 2px;
    }
    :deep(.n-data-table-wrapper) {
        overflow-x: auto;
    }
    :deep(.n-data-table-th),
    :deep(.n-data-table-td) {
        padding-right: 8px !important;
        padding-left: 8px !important;
    }
    :deep(.mobile-user-cell) {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    :deep(.mobile-user-details) {
        min-width: 0;
    }
    :deep(.mobile-user-uid) {
        display: block;
        margin-top: 2px;
        color: var(--ui-secondary-text-color);
        font-size: 11px;
    }
}
@media (min-width: 769px) and (max-width: 1080px) {
    .filter-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (max-width: 480px) {
    .detail-link {
        display: flex;
        width: fit-content;
        margin: 4px 0 0;
    }
    .table-toolbar {
        align-items: center;
    }
}
</style>
