<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
    NButton,
    NAlert,
    NCheckbox,
    NCheckboxGroup,
    NDatePicker,
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NPagination,
    NSelect,
    NSpin
} from 'naive-ui';
import { Hammer, ExternalLink, RefreshCw, Search } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import JudgementCard from '@/components/JudgementCard.vue';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import type { JudgementQueryParams } from '@/api/judgement-query.ts';
import { JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY } from '@/utils/constants.ts';
import { judgementPermissions } from '@/utils/judgement.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500].map(value => ({
    label: `${value} 条/页`,
    value
}));
const DEFAULT_PAGE_SIZE = 50;

type ExpandedPanel = 'permissions' | 'display' | null;
type JudgementFilters = Omit<JudgementQueryParams, 'page' | 'limit'>;

const { buildLuoguUrl } = useLuoguSource();
const loading = ref(false);
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
let latestRequestId = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const defaultDisplayOptions = {
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

function readFilterControls(): JudgementFilters {
    return {
        uid: filterUid.value === null ? undefined : [filterUid.value],
        name: filterName.value.trim() || undefined,
        reason: filterReason.value.trim() || undefined,
        start_time: filterTimeRange.value ? Math.floor(filterTimeRange.value[0] / 1000) : undefined,
        end_time: filterTimeRange.value ? Math.floor(filterTimeRange.value[1] / 1000) : undefined,
        rev_perm: filterRevPerm.value.length > 0 ? [...filterRevPerm.value] : undefined,
        add_perm: filterAddPerm.value.length > 0 ? [...filterAddPerm.value] : undefined,
        no_perm: filterNoPerm.value ? 1 : undefined
    };
}

// Filters applied by the last explicit search; pagination and auto-refresh reuse them so that
// unsubmitted edits in the filter controls never take effect implicitly.
let appliedFilters: JudgementFilters = readFilterControls();

function buildQueryParams(): JudgementQueryParams {
    return { ...appliedFilters, page: page.value, limit: limit.value };
}

async function loadJudgements() {
    const requestId = ++latestRequestId;
    loading.value = true;
    errorMessage.value = null;
    try {
        const response = await getJudgements(buildQueryParams());
        if (requestId !== latestRequestId) return;
        if (response.code !== 200) {
            errorMessage.value = '陶片放逐记录加载失败，请重试。';
            judgements.value = [];
            total.value = 0;
            return;
        }

        judgements.value = response.data.items;
        total.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestRequestId) return;
        console.error('[JudgementView] Failed to load judgements:', error);
        errorMessage.value = requestErrorMessage(error, '陶片放逐记录加载失败，请重试。');
        judgements.value = [];
        total.value = 0;
    } finally {
        if (requestId === latestRequestId) loading.value = false;
    }
}

function togglePanel(panel: Exclude<ExpandedPanel, null>) {
    expandedPanel.value = expandedPanel.value === panel ? null : panel;
}

function handleSearch() {
    appliedFilters = readFilterControls();
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
    page.value = 1;
    void loadJudgements();
}

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
                    :href="buildLuoguUrl('/judgement')"
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
                    <strong>内容</strong>
                    <n-checkbox v-model:checked="displayOptions.avatar" label="头像" />
                    <n-checkbox v-model:checked="displayOptions.reason" label="原因" />
                    <n-checkbox v-model:checked="displayOptions.time" label="时间" />
                </div>
            </div>
        </Card>

        <section class="judgement-results" aria-label="陶片放逐记录">
            <div class="results-toolbar">
                <span>共 {{ total }} 条记录</span>
                <n-button secondary :loading="loading" @click="loadJudgements">
                    <template #icon><n-icon :component="RefreshCw" /></template>
                    刷新
                </n-button>
            </div>
            <n-alert v-if="errorMessage" class="load-error" type="error" :show-icon="true">
                {{ errorMessage }}
                <div class="load-error-actions">
                    <n-button :disabled="loading" @click="loadJudgements">重试</n-button>
                </div>
            </n-alert>
            <n-spin :show="loading">
                <div v-if="judgements.length" class="judgement-list" role="list">
                    <JudgementCard
                        v-for="item in judgements"
                        :key="item.id"
                        :item="item"
                        :display-options="displayOptions"
                        role="listitem"
                    />
                </div>
                <Card v-else class="results-state">
                    <n-empty v-if="!loading && !errorMessage" description="没有符合条件的记录" />
                    <div v-else class="results-placeholder" aria-hidden="true"></div>
                </Card>
            </n-spin>
            <div v-if="paginationVisible" class="pagination-wrap">
                <n-pagination
                    :page="page"
                    :page-size="limit"
                    :item-count="total"
                    @update:page="handlePageChange"
                />
            </div>
        </section>
    </div>
</template>

<style scoped>
.judgement-page {
    max-width: 1220px;
    min-width: 0;
    margin: 0 auto;
}
.filter-card,
.judgement-results {
    margin-top: var(--ui-section-gap);
}
.detail-link {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
    margin-left: var(--ui-space-2);
    color: var(--ui-primary-color);
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
    gap: var(--ui-space-2) 10px;
}
.filter-item {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
}
.filter-item label,
.results-toolbar {
    color: var(--ui-secondary-text-color);
    font-weight: 500;
}
.load-error {
    margin-bottom: var(--ui-space-3);
}
.load-error-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}
.results-placeholder {
    min-height: var(--ui-space-12);
}
.filter-actions,
.results-toolbar,
.pagination-wrap {
    display: flex;
    align-items: center;
}
.filter-actions {
    display: flex;
    gap: var(--ui-space-2);
    margin-left: auto;
}
.quick-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-2);
}
.limit-select {
    width: 120px;
}
.filter-expand-panel {
    display: grid;
    gap: var(--ui-space-5);
    margin-top: var(--ui-space-3);
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: 8px;
    background: var(--ui-card-color);
}
.permission-expand-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px var(--ui-space-6);
}
.display-expand-panel {
    grid-template-columns: repeat(2, minmax(180px, max-content));
}
.display-option-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2) 14px;
}
.display-option-group strong {
    width: 100%;
}
.results-toolbar {
    justify-content: space-between;
    gap: var(--ui-space-3);
    margin-bottom: var(--ui-space-3);
}
.pagination-wrap {
    justify-content: center;
    margin-top: var(--ui-space-4);
}
.judgement-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ui-space-3);
}
:deep(.filter-expand-panel .permission-filter-column) {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-content: start;
    gap: 5px var(--ui-space-3);
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
.permission-added {
    color: var(--ui-success-color);
}
.permission-removed {
    color: var(--ui-error-color);
}
@media (max-width: 768px) {
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
        padding-right: var(--ui-space-2);
        padding-left: var(--ui-space-2);
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
        padding: var(--ui-space-3);
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
        margin: var(--ui-space-1) 0 0;
    }
}
</style>
