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
const judgementEndpoint = `${publicApiBaseUrl}judgement`;
const judgementRequestFormat = `${judgementEndpoint}?page={page}&limit={limit}&uid={uid}&name={name}&rev_perm={rev_perm}&add_perm={add_perm}&no_perm=1`;
const judgementRequestExample = `${judgementEndpoint}?page=1&limit=50&uid=1336416&name=Qselian&rev_perm=32768`;
const judgementNoPermissionExample = `${judgementEndpoint}?page=1&limit=50&no_perm=1`;
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
            <p>
                Base URL: <code>{{ publicApiBaseUrl }}</code>
            </p>
            <ul class="endpoint-list">
                <li><code>GET /judgement</code>：权限变更记录与筛选</li>
                <li><code>GET /judgement/logs</code>：同步日志</li>
                <li><code>GET /judgement/stats</code>：记录与抓取统计</li>
            </ul>

            <section class="record-api-docs">
                <h3>记录接口</h3>
                <p><code>GET /judgement</code></p>

                <h4>调用格式</h4>
                <code class="request-url">{{ judgementRequestFormat }}</code>

                <h4>调用示例</h4>
                <p class="example-label">按 UID、名称和撤销权限筛选：</p>
                <code class="request-url">{{ judgementRequestExample }}</code>
                <p class="example-label">仅查询没有权限变更的记录：</p>
                <code class="request-url">{{ judgementNoPermissionExample }}</code>

                <h4>查询参数</h4>
                <div class="parameter-table-wrap">
                    <table class="parameter-table">
                        <thead>
                            <tr>
                                <th>参数</th>
                                <th>类型与格式</th>
                                <th>默认值</th>
                                <th>说明</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>page</code></td>
                                <td>正整数</td>
                                <td><code>1</code></td>
                                <td>页码，从 1 开始。</td>
                            </tr>
                            <tr>
                                <td><code>limit</code></td>
                                <td>1–500 的整数</td>
                                <td><code>50</code></td>
                                <td>每页返回的记录数量。</td>
                            </tr>
                            <tr>
                                <td><code>uid</code></td>
                                <td>正整数；多值用英文逗号分隔</td>
                                <td>不筛选</td>
                                <td>匹配任意一个 UID，例如 <code>123,456</code>。</td>
                            </tr>
                            <tr>
                                <td><code>name</code></td>
                                <td>字符串，最长 100 个字符</td>
                                <td>不筛选</td>
                                <td>按用户名进行字面子串匹配。</td>
                            </tr>
                            <tr>
                                <td><code>rev_perm</code></td>
                                <td>正整数权限位；多值用英文逗号分隔</td>
                                <td>不筛选</td>
                                <td>
                                    撤销权限必须包含所有指定权限位，例如 <code>64,32768</code>。
                                </td>
                            </tr>
                            <tr>
                                <td><code>add_perm</code></td>
                                <td>正整数权限位；多值用英文逗号分隔</td>
                                <td>不筛选</td>
                                <td>新增权限必须包含所有指定权限位。</td>
                            </tr>
                            <tr>
                                <td><code>no_perm</code></td>
                                <td>固定值 <code>1</code></td>
                                <td>不筛选</td>
                                <td>
                                    设为 <code>1</code> 时，仅返回撤销权限和新增权限都等于 0
                                    的记录。
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p class="parameter-note">
                    所有已提供的筛选条件按 AND 组合。权限值使用权限位数字，例如
                    <code>64</code> 表示秩序管理，<code>32768</code> 表示自由发言。
                </p>
            </section>
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
.endpoint-list {
    margin: 0;
    padding-left: 22px;
    line-height: 1.8;
}
.record-api-docs {
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px solid var(--ui-border-color);
}
.record-api-docs h3,
.record-api-docs h4 {
    margin: 0;
    font-size: 16px;
}
.record-api-docs h3 {
    margin-bottom: 8px;
    font-size: 18px;
}
.record-api-docs h4 {
    margin-top: 18px;
    margin-bottom: 8px;
}
.api-card code {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--ui-panel-color);
}
.request-url {
    display: block;
    padding: 10px 12px !important;
    overflow-wrap: anywhere;
    line-height: 1.6;
}
.example-label {
    margin: 10px 0 6px !important;
    color: var(--ui-secondary-text-color);
}
.parameter-table-wrap {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--ui-border-color);
    border-radius: 6px;
}
.parameter-table {
    width: 100%;
    min-width: 780px;
    border-collapse: collapse;
    line-height: 1.55;
}
.parameter-table th,
.parameter-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--ui-border-color);
    text-align: left;
    vertical-align: top;
}
.parameter-table th {
    background: var(--ui-panel-color);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
}
.parameter-table tbody tr {
    transition: background-color 0.2s ease;
}
.parameter-table tbody tr:hover {
    background: var(--ui-panel-color);
}
.parameter-table tbody tr:last-child td {
    border-bottom: 0;
}
.parameter-table td:first-child {
    width: 110px;
}
.parameter-table td:nth-child(2) {
    width: 230px;
}
.parameter-table td:nth-child(3) {
    width: 100px;
    white-space: nowrap;
}
.parameter-note {
    margin-top: 12px !important;
    margin-bottom: 0 !important;
    color: var(--ui-secondary-text-color);
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
