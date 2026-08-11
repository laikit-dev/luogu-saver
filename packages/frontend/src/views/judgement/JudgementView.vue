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
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NPagination,
    NSelect,
    NSpin,
    useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { Hammer, ExternalLink, RefreshCw, Search } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import UserBadge from '@/components/UserBadge.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import { JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY } from '@/utils/constants.ts';
import { formatDate } from '@/utils/render.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500].map(value => ({
    label: `${value} 条/页`,
    value
}));
const DEFAULT_PAGE_SIZE = 50;

type ExpandedPanel = 'permissions' | 'display' | null;

const message = useMessage();
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const judgements = ref<JudgementItem[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(DEFAULT_PAGE_SIZE);
const expandedPanel = ref<ExpandedPanel>(null);
const filterUid = ref<number | null>(null);
const filterName = ref('');
const filterRevPerm = ref<number[]>([]);
const filterAddPerm = ref<number[]>([]);
const filterNoPerm = ref(false);
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

const permissions: Record<number, string> = {
    1: '登录鉴权',
    2: '进入主站',
    4: '进入后台',
    8: '题目管理',
    16: '团队管理',
    32: '比赛管理',
    64: '秩序管理',
    128: '未知权限 #128',
    256: '用户管理',
    512: '专栏管理',
    32768: '自由发言',
    65536: '发送私信',
    131072: '使用专栏',
    262144: '未知权限 #262144',
    524288: '使用图床',
    2097152: '题库志愿者',
    4194304: '专栏志愿者',
    1073741824: '超级用户'
};

function permissionNames(value: number): string[] {
    if (!value) return [];
    const names = Object.entries(permissions)
        .map(([permission, name]) => ({ permission: Number(permission), name }))
        .filter(({ permission }) => (value & permission) === permission)
        .map(({ name }) => name);
    return names.length > 0 ? names : [`未知权限 (${value})`];
}

const permissionList = Object.entries(permissions).map(([value, label]) => ({
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
        ...permissionNames(row.revoked_permission).map(name =>
            h('span', { class: 'permission-removed' }, name)
        ),
        ...permissionNames(row.added_permission).map(name =>
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

function buildQueryParams() {
    return {
        page: page.value,
        limit: limit.value,
        uid: filterUid.value === null ? undefined : [filterUid.value],
        name: filterName.value.trim() || undefined,
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

const columns = computed<DataTableColumns<JudgementItem>>(() => {
    const result: DataTableColumns<JudgementItem> = [];
    if (displayOptions.value.uid) result.push({ title: 'UID', key: 'uid', width: 100 });
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
    void loadJudgements();
    refreshTimer = setInterval(() => void loadJudgements(), 60_000);
});

onUnmounted(() => {
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
                <n-button secondary :loading="loading" @click="loadJudgements">
                    <template #icon><n-icon :component="RefreshCw" /></template>
                    刷新
                </n-button>
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
                    :scroll-x="1200"
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
    grid-template-columns: minmax(220px, 380px) minmax(220px, 380px);
    gap: 10px 12px;
}
.filter-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    margin-top: 10px;
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
    grid-template-columns: repeat(3, minmax(180px, 1fr));
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
    display: flex !important;
    flex-direction: column;
    gap: 6px;
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
        width: 100%;
    }
    .limit-select {
        grid-column: 1 / -1;
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
    .pagination-wrap {
        justify-content: flex-start;
        overflow-x: auto;
        padding-bottom: 2px;
    }
    :deep(.n-data-table-wrapper) {
        overflow-x: auto;
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
