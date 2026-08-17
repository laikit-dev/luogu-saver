<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { NAlert, NButton, NDataTable, NEmpty, NIcon, NPagination, NSpin, NTag } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { ArrowLeft, CircleCheck, Hammer, RefreshCw, Clock3 } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import {
    getJudgementLogs,
    getJudgementStats,
    type JudgementFetchLogItem,
    type JudgementStats
} from '@/api/judgement.ts';
import { getPublicApiBaseUrl } from '@/utils/api-base-url.ts';
import { formatDate } from '@/utils/render.ts';

const publicApiBaseUrl = getPublicApiBaseUrl();
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const logs = ref<JudgementFetchLogItem[]>([]);
const stats = ref<JudgementStats | null>(null);
const page = ref(1);
const limit = 20;
const total = ref(0);

const lastFetchLabel = computed(() =>
    stats.value?.lastFetchAt ? formatDate(stats.value.lastFetchAt) : '尚无记录'
);

const columns: DataTableColumns<JudgementFetchLogItem> = [
    { title: 'ID', key: 'id', width: 80 },
    {
        title: '状态',
        key: 'status',
        width: 100,
        render: row =>
            h(
                NTag,
                { type: row.status === 'success' ? 'success' : 'error', size: 'small' },
                { default: () => (row.status === 'success' ? '成功' : '失败') }
            )
    },
    { title: '抓取数', key: 'record_count', width: 100 },
    { title: '新增', key: 'new_record_count', width: 90 },
    { title: '跳过', key: 'skipped_count', width: 90 },
    {
        title: '完成时间',
        key: 'fetched_at',
        width: 190,
        render: row => formatDate(row.fetched_at)
    },
    {
        title: '错误信息',
        key: 'error_message',
        minWidth: 260,
        render: row => row.error_message || '—'
    }
];

async function loadData() {
    loading.value = true;
    errorMessage.value = null;
    try {
        const [logsResponse, statsResponse] = await Promise.all([
            getJudgementLogs({ page: page.value, limit }),
            getJudgementStats()
        ]);
        if (logsResponse.code !== 200) throw new Error(logsResponse.message);
        if (statsResponse.code !== 200) throw new Error(statsResponse.message);
        logs.value = logsResponse.data.items;
        total.value = logsResponse.data.pagination.total;
        stats.value = statsResponse.data;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
        logs.value = [];
        total.value = 0;
    } finally {
        loading.value = false;
    }
}

function handlePageChange(nextPage: number) {
    page.value = nextPage;
    void loadData();
}

onMounted(() => void loadData());
</script>

<template>
    <div class="judgement-logs-page">
        <CardTitle title="陶片放逐同步日志" :icon="Hammer">
            抓取状态、数据量与公开 API
            <RouterLink class="back-link" to="/judgement">
                <n-icon :component="ArrowLeft" />
                返回记录页
            </RouterLink>
        </CardTitle>

        <div class="summary-grid">
            <Card title="权限记录" :icon="CircleCheck">
                <strong class="summary-number">{{ stats?.totalJudgements ?? '—' }}</strong>
            </Card>
            <Card title="抓取次数" :icon="RefreshCw">
                <strong class="summary-number">{{ stats?.totalFetchLogs ?? '—' }}</strong>
            </Card>
            <Card title="最近抓取" :icon="Clock3">
                <strong class="summary-text">{{ lastFetchLabel }}</strong>
                <n-tag
                    v-if="stats?.lastFetchStatus"
                    :type="stats.lastFetchStatus === 'success' ? 'success' : 'error'"
                    size="small"
                >
                    {{ stats.lastFetchStatus === 'success' ? '成功' : '失败' }}
                </n-tag>
            </Card>
        </div>

        <Card class="logs-card" title="同步日志">
            <template #header-extra>
                <n-button secondary :loading="loading" @click="loadData">
                    <template #icon><n-icon :component="RefreshCw" /></template>
                    刷新
                </n-button>
            </template>
            <n-alert v-if="errorMessage" class="load-error" type="error" :show-icon="true">
                获取同步日志失败：{{ errorMessage }}
            </n-alert>
            <n-spin :show="loading">
                <n-data-table
                    :columns="columns"
                    :data="logs"
                    :bordered="false"
                    :single-line="false"
                    :scroll-x="920"
                    size="small"
                    :row-key="row => row.id"
                >
                    <template #empty><n-empty description="暂无同步日志" /></template>
                </n-data-table>
            </n-spin>
            <div v-if="total > limit" class="pagination-wrap">
                <n-pagination
                    :page="page"
                    :page-size="limit"
                    :item-count="total"
                    @update:page="handlePageChange"
                />
            </div>
        </Card>

        <Card class="api-card" title="公开 API">
            <p>Base URL: {{ publicApiBaseUrl }}</p>
            <ul>
                <li><code>GET /judgement</code>：权限变更记录与筛选</li>
                <li><code>GET /judgement/logs</code>：同步日志</li>
                <li><code>GET /judgement/stats</code>：记录与抓取统计</li>
            </ul>
            <p>
                记录接口支持
                <code>page</code>、<code>limit</code>、<code>uid</code>、<code>name</code>、
                <code>rev_perm</code>、<code>add_perm</code> 和 <code>no_perm=1</code>。
            </p>
        </Card>
    </div>
</template>

<style scoped>
.judgement-logs-page {
    max-width: 1220px;
    margin: 0 auto;
}
.back-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    color: var(--ui-primary-color);
    font-weight: 500;
    text-decoration: none;
}
.back-link:hover {
    text-decoration: underline;
}
.summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 16px;
}
.summary-number {
    font-size: 28px;
}
.summary-text {
    display: block;
    margin-bottom: 8px;
    font-size: 16px;
}
.logs-card,
.api-card {
    margin-top: 16px;
}
.load-error {
    margin-bottom: 12px;
}
.pagination-wrap {
    display: flex;
    justify-content: center;
    margin-top: 16px;
}
.api-card p {
    margin: 0 0 10px;
    line-height: 1.7;
}
.api-card p:last-child {
    margin-bottom: 0;
}
.api-card ul {
    margin: 0 0 10px;
    padding-left: 22px;
    line-height: 1.8;
}
.api-card code {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--ui-panel-color);
}
@media (max-width: 768px) {
    .summary-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        margin-top: 12px;
    }
    .logs-card,
    .api-card {
        margin-top: 12px;
    }
    .pagination-wrap {
        justify-content: flex-start;
        overflow-x: auto;
    }
}
@media (max-width: 480px) {
    .back-link {
        display: flex;
        width: fit-content;
        margin: 4px 0 0;
    }
}
</style>
