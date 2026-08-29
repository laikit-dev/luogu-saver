<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import {
    NAlert,
    NButton,
    NDataTable,
    NFormItem,
    NInputNumber,
    NSpace,
    NSpin,
    NTag,
    useMessage
} from 'naive-ui';
import Card from '@/components/Card.vue';
import {
    rebuildArticleEmbeddings,
    reindexSearch,
    stopDiscoveryRun,
    type DiscoveryRun
} from '@/api/admin.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';
import { useContentSaver } from '@/composables/useContentSaver.ts';
import websocket, { joinRoom, leaveRoom, refreshSocketAuth } from '@/utils/websocket.ts';

const DISCOVERY_RUNS_ROOM = 'discovery:runs';
const DISCOVERY_RUNS_EVENT = 'discovery:runs:update';
const SOCKET_JOIN_ERROR_EVENT = 'join:error';

const message = useMessage();
const socket = websocket.getInstance();
const { setupTaskUpdateListener } = useContentSaver();

const reindexing = ref(false);
const rebuildingEmbeddings = ref(false);
const loadingDiscoveryRuns = ref(false);
const batchSize = ref(100);
const embeddingBatchSize = ref(20);
const embeddingConcurrency = ref(5);
const discoveryRuns = ref<DiscoveryRun[]>([]);
let discoverySocketAttached = false;

const canManageSearch = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_SEARCH)
);
const canManageDiscovery = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_DISCOVERY)
);

function handleDiscoveryRunsUpdate(payload: { runs?: DiscoveryRun[] }) {
    if (!Array.isArray(payload.runs)) return;
    discoveryRuns.value = payload.runs;
    loadingDiscoveryRuns.value = false;
}

function handleSocketJoinError(payload: { room?: string; message?: string }) {
    if (payload.room !== DISCOVERY_RUNS_ROOM) return;
    loadingDiscoveryRuns.value = false;
    message.error(payload.message || '发现任务 WebSocket 订阅失败');
}

function attachDiscoverySocket() {
    if (discoverySocketAttached || !canManageDiscovery.value) return;
    refreshSocketAuth();
    loadingDiscoveryRuns.value = true;
    socket.on(DISCOVERY_RUNS_EVENT, handleDiscoveryRunsUpdate);
    socket.on(SOCKET_JOIN_ERROR_EVENT, handleSocketJoinError);
    joinRoom(DISCOVERY_RUNS_ROOM);
    discoverySocketAttached = true;
}

function detachDiscoverySocket() {
    if (!discoverySocketAttached) return;
    socket.off(DISCOVERY_RUNS_EVENT, handleDiscoveryRunsUpdate);
    socket.off(SOCKET_JOIN_ERROR_EVENT, handleSocketJoinError);
    leaveRoom(DISCOVERY_RUNS_ROOM);
    discoverySocketAttached = false;
}

async function handleReindex() {
    reindexing.value = true;
    const response = await reindexSearch(batchSize.value);
    if (response.code !== 200) {
        message.error(response.message);
        reindexing.value = false;
        return;
    }

    const taskId = response.data.reportTaskIds['reindex-search'];
    if (!taskId) {
        reindexing.value = false;
        message.error('搜索索引重建任务 ID 缺失');
        return;
    }
    setupTaskUpdateListener(
        taskId,
        () => {
            reindexing.value = false;
            message.success('搜索索引重建完成');
        },
        error => {
            reindexing.value = false;
            message.error(error || '搜索索引重建失败');
        }
    );
    message.success('搜索索引重建任务已提交');
}

async function handleEmbeddingRebuild() {
    rebuildingEmbeddings.value = true;
    const response = await rebuildArticleEmbeddings(
        embeddingBatchSize.value,
        embeddingConcurrency.value
    );
    if (response.code !== 200) {
        message.error(response.message);
        rebuildingEmbeddings.value = false;
        return;
    }

    const taskId = response.data.reportTaskIds['rebuild-embedding'];
    if (!taskId) {
        rebuildingEmbeddings.value = false;
        message.error('Embedding 重建任务 ID 缺失');
        return;
    }
    setupTaskUpdateListener(
        taskId,
        data => {
            rebuildingEmbeddings.value = false;
            const result = data?.result?.data;
            if (result) {
                message.success(
                    `Embedding 重建完成：更新 ${result.updated} 篇，失败 ${result.failed} 篇`
                );
                return;
            }
            message.success('Embedding 重建完成');
        },
        error => {
            rebuildingEmbeddings.value = false;
            message.error(error || 'Embedding 重建失败');
        }
    );
    message.success('Embedding 重建任务已提交');
}

async function handleStopDiscovery(row: DiscoveryRun) {
    const response = await stopDiscoveryRun(row.id);
    if (response.code === 200) {
        message.success('发现任务已停止');
        loadingDiscoveryRuns.value = true;
    } else {
        message.error(response.message);
    }
}

const discoveryColumns = [
    { title: 'Run ID', key: 'id', width: 260 },
    { title: '状态', key: 'status', width: 100 },
    { title: '页面', key: 'visitedPages', width: 80 },
    { title: '待扫页', key: 'pendingPages', width: 90 },
    { title: '文章', key: 'discoveredArticles', width: 80 },
    { title: 'Workflow', key: 'createdWorkflows', width: 100 },
    { title: '失败页', key: 'failedPages', width: 80 },
    {
        title: '操作',
        key: 'actions',
        width: 100,
        render(row: DiscoveryRun) {
            return h(
                NButton,
                {
                    size: 'small',
                    type: 'warning',
                    secondary: true,
                    disabled: row.status !== 'active',
                    onClick: () => handleStopDiscovery(row)
                },
                { default: () => '停止' }
            );
        }
    }
];

onMounted(() => {
    attachDiscoverySocket();
});

onBeforeUnmount(() => {
    detachDiscoverySocket();
});
</script>

<template>
    <div>
        <div class="ops-grid">
            <Card title="搜索索引">
                <n-space vertical>
                    <div class="muted">通过 workflow 重建 Meilisearch 文章索引。</div>
                    <n-space align="center">
                        <n-form-item
                            label="每批文章数"
                            label-placement="left"
                            :show-feedback="false"
                            class="batch-size-field"
                        >
                            <n-input-number
                                v-model:value="batchSize"
                                :min="1"
                                :max="500"
                                placeholder="默认 100，范围 1-500"
                            />
                        </n-form-item>
                        <n-button
                            type="primary"
                            :disabled="!canManageSearch"
                            :loading="reindexing"
                            @click="handleReindex"
                        >
                            重建索引
                        </n-button>
                    </n-space>
                    <n-tag v-if="!canManageSearch" type="warning">缺少 MANAGE_SEARCH</n-tag>
                </n-space>
            </Card>

            <Card title="文章 Embedding">
                <n-space vertical>
                    <div class="muted">通过 workflow 为所有未删除文章重新生成 Chroma 向量。</div>
                    <n-space align="center">
                        <n-form-item
                            label="每批文章数"
                            label-placement="left"
                            :show-feedback="false"
                            class="batch-size-field"
                        >
                            <n-input-number
                                v-model:value="embeddingBatchSize"
                                :min="1"
                                :max="100"
                                placeholder="默认 20，范围 1-100"
                            />
                        </n-form-item>
                        <n-form-item
                            label="并发数"
                            label-placement="left"
                            :show-feedback="false"
                            class="batch-size-field"
                        >
                            <n-input-number
                                v-model:value="embeddingConcurrency"
                                :min="1"
                                :max="50"
                                placeholder="默认 5，范围 1-50"
                            />
                        </n-form-item>
                        <n-button
                            type="primary"
                            :disabled="!canManageSearch"
                            :loading="rebuildingEmbeddings"
                            @click="handleEmbeddingRebuild"
                        >
                            重建 Embedding
                        </n-button>
                    </n-space>
                    <n-tag v-if="!canManageSearch" type="warning">缺少 MANAGE_SEARCH</n-tag>
                </n-space>
            </Card>
        </div>

        <Card title="发现任务" class="discovery-card">
            <n-spin :show="loadingDiscoveryRuns">
                <n-data-table
                    v-if="canManageDiscovery"
                    :columns="discoveryColumns"
                    :data="discoveryRuns"
                    :pagination="{ pageSize: 5 }"
                />
                <n-alert v-else type="warning" title="缺少 MANAGE_DISCOVERY">
                    你没有文章发现管理权限。
                </n-alert>
            </n-spin>
        </Card>
    </div>
</template>

<style scoped>
.ops-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
}

.discovery-card {
    margin-bottom: 16px;
}

.muted {
    color: var(--ui-muted-text-color);
}

.batch-size-field {
    margin-bottom: 0;
}

@media (max-width: 900px) {
    .ops-grid {
        grid-template-columns: 1fr;
    }
}
</style>
