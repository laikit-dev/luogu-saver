<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { NAlert, NButton, NEmpty, NSpin, NTag } from 'naive-ui';
import { CircleCheck, Clock3, Server, TriangleAlert } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import { getQueueStats, type QueueStatsItem, type QueueStatsResponse } from '@/api/statistic.ts';
import websocket, {
    joinRoom,
    leaveRoom,
    socketConnected,
    socketLastError,
    socketReconnectAttempt,
    socketReconnecting
} from '@/utils/websocket.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const QUEUE_STATS_ROOM = 'stats:queues';
const QUEUE_STATS_EVENT = 'stats:queues:update';

const loading = ref(false);
const error = ref<string | null>(null);
const stats = ref<QueueStatsResponse | null>(null);
const socket = websocket.getInstance();
let requestId = 0;

function pendingCount(queue: QueueStatsItem) {
    return (
        queue.counts.waiting +
        queue.counts.paused +
        queue.counts.prioritized +
        queue.counts.waitingChildren
    );
}

const totals = computed(() => {
    const initial = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    return (stats.value?.queues || []).reduce((acc, queue) => {
        acc.waiting += pendingCount(queue);
        acc.active += queue.counts.active;
        acc.delayed += queue.counts.delayed;
        acc.failed += queue.counts.failed;
        acc.completed += queue.counts.completed;
        return acc;
    }, initial);
});

function queueStatus(queue: QueueStatsItem) {
    if (queue.isPaused || queue.counts.paused > 0)
        return { label: '暂停', type: 'warning' as const };
    if (pendingCount(queue) > 0 || queue.counts.delayed > 0) {
        return { label: '有堆积', type: 'warning' as const };
    }
    if (queue.counts.active > 0) return { label: '运行中', type: 'info' as const };
    return { label: '正常', type: 'success' as const };
}

async function refresh() {
    const id = ++requestId;
    loading.value = true;
    error.value = null;
    try {
        const response = await getQueueStats();
        if (id !== requestId) return;
        if (response.code !== 200) {
            error.value = response.message || '队列状态加载失败';
            return;
        }
        stats.value = response.data;
    } catch (failure) {
        if (id !== requestId) return;
        error.value = requestErrorMessage(failure, '队列状态加载失败');
    } finally {
        if (id === requestId) loading.value = false;
    }
}

function handleQueueStatsUpdate(payload: QueueStatsResponse) {
    stats.value = payload;
    error.value = null;
}

onMounted(async () => {
    socket.on(QUEUE_STATS_EVENT, handleQueueStatsUpdate);
    joinRoom(QUEUE_STATS_ROOM);
    await refresh();
});

onUnmounted(() => {
    requestId++;
    socket.off(QUEUE_STATS_EVENT, handleQueueStatsUpdate);
    leaveRoom(QUEUE_STATS_ROOM);
});

defineExpose({
    loading,
    refresh
});
</script>

<template>
    <section aria-label="队列状态">
        <div class="queue-summary-grid">
            <Card
                title="WebSocket"
                :icon="Server"
                class="ui-stagger-item"
                :style="{ '--stagger-index': 0 }"
            >
                <div class="summary-card-body">
                    <n-tag
                        :type="
                            socketConnected ? 'success' : socketReconnecting ? 'warning' : 'error'
                        "
                    >
                        {{ socketConnected ? '已连接' : socketReconnecting ? '重连中' : '已断开' }}
                    </n-tag>
                    <div class="summary-value">
                        {{
                            socketReconnectAttempt
                                ? `第 ${socketReconnectAttempt} 次重连`
                                : '实时更新中'
                        }}
                    </div>
                    <div class="summary-hint">
                        {{ socketLastError || '断线后会自动重新连接' }}
                    </div>
                </div>
            </Card>
            <Card
                title="等待任务"
                :icon="Clock3"
                class="ui-stagger-item"
                :style="{ '--stagger-index': 1 }"
            >
                <div class="summary-card-body">
                    <div class="summary-number" :class="{ muted: stats && totals.waiting === 0 }">
                        {{ stats ? totals.waiting : '—' }}
                    </div>
                </div>
            </Card>
            <Card
                title="运行任务"
                :icon="CircleCheck"
                class="ui-stagger-item"
                :style="{ '--stagger-index': 2 }"
            >
                <div class="summary-card-body">
                    <div class="summary-number" :class="{ muted: stats && totals.active === 0 }">
                        {{ stats ? totals.active : '—' }}
                    </div>
                </div>
            </Card>
            <Card
                title="失败任务"
                :icon="TriangleAlert"
                class="ui-stagger-item"
                :style="{ '--stagger-index': 3 }"
            >
                <div class="summary-card-body">
                    <div
                        class="summary-number"
                        :class="{
                            danger: stats && totals.failed > 0,
                            muted: stats && totals.failed === 0
                        }"
                    >
                        {{ stats ? totals.failed : '—' }}
                    </div>
                </div>
            </Card>
        </div>

        <n-alert v-if="error" type="error" class="queue-error">
            {{ error }}
            <div class="queue-error-actions">
                <n-button :disabled="loading" @click="refresh">重试</n-button>
            </div>
        </n-alert>

        <div v-if="loading && !stats" class="loading-block" role="status">
            <n-spin size="small" />
            <span>正在加载队列状态...</span>
        </div>

        <n-empty
            v-else-if="stats && !stats.queues.length"
            class="queue-empty"
            description="暂无任务队列"
        />

        <div v-else-if="stats" class="queue-grid">
            <Card
                v-for="(queue, index) in stats.queues"
                :key="queue.name"
                :title="queue.label"
                class="ui-stagger-item"
                :style="{ '--stagger-index': Math.min(index, 7) }"
            >
                <template #header-extra>
                    <n-tag :type="queueStatus(queue).type" size="small">
                        {{ queueStatus(queue).label }}
                    </n-tag>
                </template>
                <div class="queue-card-body">
                    <div class="queue-metrics">
                        <div class="metric">
                            <span>并发</span>
                            <strong :class="{ 'is-zero': queue.concurrency === 0 }">{{
                                queue.concurrency
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>等待</span>
                            <strong :class="{ 'is-zero': pendingCount(queue) === 0 }">{{
                                pendingCount(queue)
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>运行</span>
                            <strong
                                :class="{
                                    'is-zero': queue.counts.active === 0,
                                    'is-active': queue.counts.active > 0
                                }"
                            >
                                {{ queue.counts.active }}
                            </strong>
                        </div>
                        <div class="metric">
                            <span>延迟</span>
                            <strong :class="{ 'is-zero': queue.counts.delayed === 0 }">{{
                                queue.counts.delayed
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>等待依赖</span>
                            <strong :class="{ 'is-zero': queue.counts.waitingChildren === 0 }">{{
                                queue.counts.waitingChildren
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>优先等待</span>
                            <strong :class="{ 'is-zero': queue.counts.prioritized === 0 }">{{
                                queue.counts.prioritized
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>已挂起</span>
                            <strong :class="{ 'is-zero': queue.counts.paused === 0 }">{{
                                queue.counts.paused
                            }}</strong>
                        </div>
                        <div class="metric">
                            <span>失败</span>
                            <strong
                                :class="{
                                    'is-zero': queue.counts.failed === 0,
                                    'is-danger': queue.counts.failed > 0
                                }"
                            >
                                {{ queue.counts.failed }}
                            </strong>
                        </div>
                        <div class="metric">
                            <span>完成</span>
                            <strong :class="{ 'is-zero': queue.counts.completed === 0 }">{{
                                queue.counts.completed
                            }}</strong>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    </section>
</template>

<style scoped>
.queue-summary-grid,
.queue-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.queue-summary-grid {
    margin-bottom: var(--ui-section-gap);
}

.queue-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.summary-card-body,
.queue-card-body {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.summary-number {
    color: var(--ui-card-title-color);
    font-size: 32px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.summary-number.muted {
    color: var(--ui-muted-text-color);
}

.summary-value {
    color: var(--ui-secondary-text-color);
    font-weight: 600;
}

.summary-number.danger {
    color: var(--ui-error-color);
}

.summary-hint {
    color: var(--ui-muted-text-color);
    line-height: 1.6;
}

.queue-error {
    margin-bottom: var(--ui-space-4);
}

.queue-error-actions {
    margin-top: var(--ui-space-2);
}

.loading-block,
.queue-empty {
    padding: var(--ui-space-8) 0;
}

.loading-block {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ui-space-2);
    color: var(--ui-secondary-text-color);
}

.queue-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--ui-space-1) var(--ui-space-4);
}

.metric {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-2);
    padding: 7px 2px;
    border-bottom: 1px solid var(--ui-border-color);
    color: var(--ui-muted-text-color);
    font-size: 13px;
}

.metric:nth-last-child(-n + 3) {
    border-bottom: 0;
}

.metric strong {
    color: var(--ui-card-title-color);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.metric strong.is-zero {
    color: var(--ui-muted-text-color);
    font-weight: 500;
}

.metric strong.is-active {
    color: var(--ui-primary-color);
}

.metric strong.is-danger {
    color: var(--ui-error-color);
}

@media (max-width: 1100px) {
    .queue-summary-grid,
    .queue-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 768px) {
    .queue-summary-grid,
    .queue-grid,
    .queue-metrics {
        grid-template-columns: minmax(0, 1fr);
    }

    .queue-summary-grid,
    .queue-grid {
        gap: var(--ui-space-3);
    }

    .metric:nth-last-child(-n + 3) {
        border-bottom: 1px solid var(--ui-border-color);
    }

    .metric:last-child {
        border-bottom: 0;
    }
}
</style>
