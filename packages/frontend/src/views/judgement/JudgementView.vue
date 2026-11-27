<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isCancel } from 'axios';
import {
    NAlert,
    NButton,
    NCheckbox,
    NCheckboxGroup,
    NDatePicker,
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NPagination,
    NPopover,
    NRadioButton,
    NRadioGroup,
    NSelect,
    NSpin,
    NTag
} from 'naive-ui';
import {
    Filter,
    Hammer,
    Hash,
    LayoutGrid,
    RefreshCw,
    RotateCcw,
    Search,
    SlidersHorizontal,
    User
} from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import JudgementCard from '@/components/JudgementCard.vue';
import JudgementTable from '@/components/JudgementTable.vue';
import LuoguSourceButton from '@/components/LuoguSourceButton.vue';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import type { JudgementQueryParams } from '@/api/judgement-query.ts';
import { JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY } from '@/utils/constants.ts';
import {
    groupJudgementsForCards,
    judgementPermissions,
    type JudgementDisplayOptions
} from '@/utils/judgement.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';

const pageSizeOptions = computed(() =>
    [20, 50, 100, 200, 500].map(value => ({
        label: `${value} ${displayLayout.value === 'card' ? '张/页' : '条/页'}`,
        value
    }))
);
const DEFAULT_PAGE_SIZE = 50;

type ExpandedPanel = 'permissions' | 'display' | null;
type JudgementFilters = Omit<JudgementQueryParams, 'page' | 'limit' | 'group'>;

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const judgements = ref<JudgementItem[]>([]);
const cardGroups = computed(() => groupJudgementsForCards(judgements.value));
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
const mobileViewport = ref(window.innerWidth < 768);
let latestRequestId = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const defaultDisplayOptions: JudgementDisplayOptions = {
    avatar: true,
    reason: true,
    time: true,
    badge: false,
    ccf: true,
    xcpc: true
};
const savedDisplayOptions = useLocalStorage(
    JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY,
    defaultDisplayOptions
);
const displayOptions = ref({ ...defaultDisplayOptions, ...(savedDisplayOptions.value ?? {}) });
const displayLayout = computed({
    get() {
        const layout = displayOptions.value.layout;
        if (layout === 'card' || layout === 'table') return layout;
        return mobileViewport.value ? 'card' : 'table';
    },
    set(layout: 'card' | 'table') {
        displayOptions.value.layout = layout;
    }
});

function updateViewport() {
    mobileViewport.value = window.innerWidth < 768;
}

watch(
    displayOptions,
    value => {
        savedDisplayOptions.value = { ...value };
    },
    { deep: true }
);

const permissionList = Object.entries(judgementPermissions)
    .filter(([, label]) => !label.startsWith('未知权限'))
    .map(([value, label]) => ({
        value: Number(value),
        label
    }));
const permissionLabelMap = new Map(permissionList.map(item => [item.value, item.label]));

function getPermissionLabel(perm: number): string {
    return permissionLabelMap.get(perm) ?? String(perm);
}

const dateRangeShortcuts = {
    '近 24 小时': () => {
        const end = Date.now();
        return [end - 24 * 60 * 60 * 1000, end] as [number, number];
    },
    '近 7 天': () => {
        const end = Date.now();
        return [end - 7 * 24 * 60 * 60 * 1000, end] as [number, number];
    },
    '近 30 天': () => {
        const end = Date.now();
        return [end - 30 * 24 * 60 * 60 * 1000, end] as [number, number];
    }
};

const permissionFilterCount = computed(
    () => filterRevPerm.value.length + filterAddPerm.value.length + (filterNoPerm.value ? 1 : 0)
);

const hasActiveFilters = computed(
    () =>
        filterUid.value !== null ||
        Boolean(filterName.value.trim()) ||
        Boolean(filterReason.value.trim()) ||
        filterTimeRange.value !== null ||
        permissionFilterCount.value > 0
);

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
    return {
        ...appliedFilters,
        page: page.value,
        limit: limit.value,
        group: displayLayout.value === 'card' ? 'card' : undefined
    };
}

watch(displayLayout, () => {
    page.value = 1;
    judgements.value = [];
    total.value = 0;
    void loadJudgements();
});

let activeController: AbortController | null = null;

async function loadJudgements() {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const requestId = ++latestRequestId;
    loading.value = true;
    errorMessage.value = null;
    try {
        const response = await getJudgements(buildQueryParams(), controller.signal);
        if (requestId !== latestRequestId) return;
        if (response.code !== 200) {
            errorMessage.value = response.message || '陶片放逐记录加载失败';
            judgements.value = [];
            total.value = 0;
            return;
        }

        judgements.value = response.data.items;
        total.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestRequestId || isCancel(error)) return;
        console.error('[JudgementView] Failed to load judgements:', error);
        errorMessage.value = requestErrorMessage(error, '陶片放逐记录加载失败');
        judgements.value = [];
        total.value = 0;
    } finally {
        if (requestId === latestRequestId) loading.value = false;
    }
}

function setPanelOpen(panel: Exclude<ExpandedPanel, null>, open: boolean) {
    if (open) {
        expandedPanel.value = panel;
    } else if (expandedPanel.value === panel) {
        expandedPanel.value = null;
    }
}

function applyPermissionFilters() {
    expandedPanel.value = null;
    handleSearch();
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

function removeRevPermission(perm: number) {
    filterRevPerm.value = filterRevPerm.value.filter(item => item !== perm);
    handleSearch();
}

function removeAddPermission(perm: number) {
    filterAddPerm.value = filterAddPerm.value.filter(item => item !== perm);
    handleSearch();
}

function clearNoPermission() {
    filterNoPerm.value = false;
    handleSearch();
}

function clearPermissionFilters() {
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

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') void loadJudgements();
}

onMounted(() => {
    window.addEventListener('resize', updateViewport);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void loadJudgements();
    refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void loadJudgements();
    }, 60_000);
});

onUnmounted(() => {
    activeController?.abort();
    window.removeEventListener('resize', updateViewport);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
    <div class="judgement-page">
        <CardTitle title="陶片放逐" :icon="Hammer">
            <template #extra>
                <LuoguSourceButton path="/judgement" size="small" />
                <n-button size="small" secondary :loading="loading" @click="loadJudgements">
                    <template #icon><n-icon :component="RefreshCw" /></template>
                    刷新
                </n-button>
            </template>
        </CardTitle>

        <Card class="filter-card">
            <div class="filter-main-row">
                <n-input
                    v-model:value="filterReason"
                    class="filter-reason-input"
                    clearable
                    aria-label="按处理原因筛选"
                    placeholder="搜索处理原因…"
                    @keydown.enter="handleSearch"
                    @clear="handleSearch"
                >
                    <template #prefix>
                        <n-icon :component="Search" />
                    </template>
                </n-input>
                <n-input
                    v-model:value="filterName"
                    class="filter-name-input"
                    clearable
                    aria-label="按用户名筛选"
                    placeholder="用户名"
                    @keydown.enter="handleSearch"
                    @clear="handleSearch"
                >
                    <template #prefix>
                        <n-icon :component="User" />
                    </template>
                </n-input>
                <n-input-number
                    v-model:value="filterUid"
                    class="filter-uid-input"
                    :min="1"
                    :precision="0"
                    :show-button="false"
                    clearable
                    placeholder="UID"
                    :input-props="{ 'aria-label': '按 UID 筛选' }"
                    @keydown.enter="handleSearch"
                    @clear="handleSearch"
                >
                    <template #prefix>
                        <n-icon :component="Hash" />
                    </template>
                </n-input-number>
                <n-button type="primary" class="filter-submit-btn" @click="handleSearch">
                    <template #icon><n-icon :component="Search" /></template>
                    查询
                </n-button>
            </div>

            <div class="filter-toolbar" role="region" aria-label="快捷筛选与显示设置">
                <n-date-picker
                    v-model:value="filterTimeRange"
                    class="filter-date-picker"
                    type="datetimerange"
                    clearable
                    :shortcuts="dateRangeShortcuts"
                    :actions="['confirm']"
                    start-placeholder="开始时间"
                    end-placeholder="结束时间"
                    @update:value="handleSearch"
                />
                <n-popover
                    :show="expandedPanel === 'permissions'"
                    trigger="click"
                    placement="bottom-start"
                    :show-arrow="false"
                    style="padding: 0"
                    @update:show="open => setPanelOpen('permissions', open)"
                >
                    <template #trigger>
                        <n-button
                            class="filter-toolbar-btn"
                            secondary
                            :type="
                                expandedPanel === 'permissions' || permissionFilterCount > 0
                                    ? 'primary'
                                    : 'default'
                            "
                            :aria-expanded="expandedPanel === 'permissions'"
                        >
                            <template #icon><n-icon :component="SlidersHorizontal" /></template>
                            权限筛选{{
                                permissionFilterCount > 0 ? ` (${permissionFilterCount})` : ''
                            }}
                        </n-button>
                    </template>
                    <div class="popover-panel permission-popover-panel">
                        <div class="permission-popover-grid">
                            <n-checkbox-group
                                v-model:value="filterRevPerm"
                                class="permission-filter-column"
                            >
                                <strong class="permission-removed">移除</strong>
                                <n-checkbox
                                    v-for="permission in permissionList"
                                    :key="`expanded-rev-${permission.value}`"
                                    :value="permission.value"
                                    :label="permission.label"
                                />
                            </n-checkbox-group>
                            <n-checkbox-group
                                v-model:value="filterAddPerm"
                                class="permission-filter-column"
                            >
                                <strong class="permission-added">添加</strong>
                                <n-checkbox
                                    v-for="permission in permissionList"
                                    :key="`expanded-add-${permission.value}`"
                                    :value="permission.value"
                                    :label="permission.label"
                                />
                            </n-checkbox-group>
                            <div class="permission-filter-column permission-special-row">
                                <strong>特殊</strong>
                                <n-checkbox
                                    v-model:checked="filterNoPerm"
                                    label="无权限变更（学术不端棕名）"
                                />
                            </div>
                        </div>
                        <div class="popover-footer">
                            <n-button
                                text
                                size="small"
                                :disabled="permissionFilterCount === 0"
                                @click="clearPermissionFilters"
                            >
                                清空
                            </n-button>
                            <n-button type="primary" size="small" @click="applyPermissionFilters">
                                应用筛选
                            </n-button>
                        </div>
                    </div>
                </n-popover>

                <n-popover
                    :show="expandedPanel === 'display'"
                    trigger="click"
                    placement="bottom-start"
                    :show-arrow="false"
                    style="padding: 0"
                    @update:show="open => setPanelOpen('display', open)"
                >
                    <template #trigger>
                        <n-button
                            class="filter-toolbar-btn"
                            secondary
                            :type="expandedPanel === 'display' ? 'primary' : 'default'"
                            :aria-expanded="expandedPanel === 'display'"
                        >
                            <template #icon><n-icon :component="LayoutGrid" /></template>
                            显示选项
                        </n-button>
                    </template>
                    <div class="popover-panel display-popover-panel">
                        <div class="display-option-group">
                            <strong>显示方式</strong>
                            <n-radio-group v-model:value="displayLayout" aria-label="显示方式">
                                <n-radio-button value="card">卡片</n-radio-button>
                                <n-radio-button value="table">表格</n-radio-button>
                            </n-radio-group>
                        </div>
                        <div class="display-option-group">
                            <strong>标记</strong>
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
                </n-popover>

                <div class="filter-toolbar-tail">
                    <n-select
                        class="limit-select"
                        :value="limit"
                        :options="pageSizeOptions"
                        :input-props="{ 'aria-label': '每页显示数量' }"
                        @update:value="handleLimitChange"
                    />
                    <n-button
                        v-if="hasActiveFilters"
                        secondary
                        aria-label="重置全部筛选条件"
                        @click="handleReset"
                    >
                        <template #icon><n-icon :component="RotateCcw" /></template>
                        重置
                    </n-button>
                </div>
            </div>

            <Transition name="ui-fade">
                <TransitionGroup
                    v-if="permissionFilterCount > 0"
                    name="ui-pop"
                    tag="div"
                    class="active-filter-tags"
                    aria-label="已生效权限筛选"
                >
                    <span key="perm-label" class="active-filters-label">
                        <n-icon :component="Filter" :size="14" />
                        <span>权限筛选 ({{ permissionFilterCount }})</span>
                    </span>
                    <n-tag
                        v-for="perm in filterRevPerm"
                        :key="`rev-${perm}`"
                        closable
                        size="small"
                        type="error"
                        @close="removeRevPermission(perm)"
                    >
                        移除：{{ getPermissionLabel(perm) }}
                    </n-tag>
                    <n-tag
                        v-for="perm in filterAddPerm"
                        :key="`add-${perm}`"
                        closable
                        size="small"
                        type="success"
                        @close="removeAddPermission(perm)"
                    >
                        添加：{{ getPermissionLabel(perm) }}
                    </n-tag>
                    <n-tag
                        v-if="filterNoPerm"
                        key="no-perm"
                        closable
                        size="small"
                        type="warning"
                        @close="clearNoPermission"
                    >
                        无权限变更
                    </n-tag>
                    <n-button
                        key="perm-clear"
                        text
                        size="tiny"
                        class="clear-filters-btn"
                        @click="clearPermissionFilters"
                    >
                        清空权限
                    </n-button>
                </TransitionGroup>
            </Transition>
        </Card>

        <section class="judgement-results" aria-label="陶片放逐记录">
            <n-alert v-if="errorMessage" class="load-error" type="error" :show-icon="true">
                {{ errorMessage }}
                <div class="load-error-actions">
                    <n-button :disabled="loading" @click="loadJudgements">重试</n-button>
                </div>
            </n-alert>
            <n-spin :show="loading">
                <JudgementTable
                    v-if="judgements.length && displayLayout === 'table'"
                    :items="judgements"
                    :display-options="displayOptions"
                />
                <div v-else-if="judgements.length" class="judgement-list" role="list">
                    <JudgementCard
                        v-for="group in cardGroups"
                        :key="group[0]!.id"
                        :item="group[0]!"
                        :group-items="group"
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
.filter-main-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2);
}
.filter-reason-input {
    flex: 1 1 260px;
    min-width: 0;
}
.filter-name-input {
    flex: 0 1 180px;
    min-width: 136px;
}
.filter-uid-input {
    flex: 0 1 150px;
    min-width: 116px;
}
.filter-submit-btn {
    flex-shrink: 0;
    min-width: 88px;
}
.filter-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-3);
}
.filter-date-picker {
    flex: 0 1 320px;
    min-width: 240px;
}
.filter-toolbar-tail {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    margin-left: auto;
}
.limit-select {
    width: 118px;
}
.active-filter-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-3);
    padding-top: var(--ui-space-3);
    border-top: 1px solid var(--ui-border-color);
}
.active-filters-label {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
    color: var(--ui-muted-text-color);
    font-size: 12px;
    font-weight: 500;
}
.clear-filters-btn {
    margin-left: var(--ui-space-1);
    color: var(--ui-muted-text-color);
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
.pagination-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: var(--ui-space-4);
}
.popover-panel {
    box-sizing: border-box;
    padding: var(--ui-space-4);
}
.permission-popover-panel {
    width: min(640px, calc(100vw - 32px));
    max-height: min(70vh, 520px);
    overflow-y: auto;
}
.permission-popover-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px var(--ui-space-6);
}
.display-popover-panel {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    width: min(360px, calc(100vw - 32px));
}
.popover-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--ui-space-3);
    margin-top: var(--ui-space-3);
    padding-top: var(--ui-space-3);
    border-top: 1px solid var(--ui-border-color);
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
.judgement-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ui-space-3);
}
.judgement-list > * {
    content-visibility: auto;
    contain-intrinsic-size: auto 140px;
}
:deep(.permission-popover-grid .permission-filter-column) {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-content: start;
    gap: 5px var(--ui-space-3);
}
:deep(.permission-filter-column > strong) {
    grid-column: 1 / -1;
}
:deep(.permission-popover-grid > .permission-special-row) {
    grid-column: 1 / -1;
    grid-template-columns: max-content 1fr;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid var(--ui-border-color);
}
:deep(.permission-popover-grid > .permission-special-row > strong) {
    grid-column: auto;
}
.permission-added {
    color: var(--ui-success-color);
}
.permission-removed {
    color: var(--ui-error-color);
}
@media (min-width: 769px) and (max-width: 1080px) {
    .filter-reason-input {
        flex-basis: 100%;
    }
    .filter-name-input,
    .filter-uid-input {
        flex: 1 1 0;
    }
    .filter-date-picker {
        flex: 1 1 100%;
        min-width: 0;
    }
}
@media (max-width: 768px) {
    .filter-main-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .filter-reason-input,
    .filter-submit-btn {
        grid-column: 1 / -1;
        width: 100%;
    }
    .filter-name-input,
    .filter-uid-input {
        width: 100%;
        min-width: 0;
    }
    .filter-toolbar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .filter-date-picker,
    .filter-toolbar-tail {
        grid-column: 1 / -1;
        width: 100%;
        min-width: 0;
        margin-left: 0;
    }
    .filter-toolbar-tail > .limit-select {
        flex: 1;
        min-width: 0;
    }
    .filter-toolbar > .filter-toolbar-btn {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
    }
    .popover-panel {
        padding: var(--ui-space-3);
    }
    .permission-popover-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    :deep(.permission-popover-grid .permission-filter-column) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :deep(.permission-popover-grid > .permission-special-row) {
        grid-column: auto;
        grid-template-columns: minmax(0, 1fr);
    }
    .pagination-wrap {
        justify-content: flex-start;
        overflow-x: auto;
        padding-bottom: 2px;
    }
}
</style>
