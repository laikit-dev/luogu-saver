<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { NAlert, NButton, NSpin } from 'naive-ui';
import workerAssetUrl from '@/workers/archive-diff.worker.ts?worker&url';
import type {
    ArchiveDiffLine,
    ArchiveDiffRequest,
    ArchiveDiffResponse,
    ArchiveDiffResult
} from '@/workers/archive-diff.types';

const props = withDefaults(
    defineProps<{
        before: string;
        after: string;
        beforeLabel?: string;
        afterLabel?: string;
    }>(),
    { beforeLabel: '对比前', afterLabel: '对比后' }
);

const state = ref<'loading' | 'ready' | 'error' | 'cancelled'>('loading');
const result = shallowRef<ArchiveDiffResult | null>(null);
const visibleLimit = ref(200);
const expandedCounts = ref<Record<number, number>>({});
let worker: Worker | null = null;
let bootstrapUrl: string | null = null;
let requestId = 0;

type DisplayRow =
    | { key: string; line: ArchiveDiffLine }
    | { key: string; gapIndex: number; shown: number; count: number };

const displayRows = computed<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [];
    const source = result.value?.rows ?? [];
    for (let index = 0; index < Math.min(visibleLimit.value, source.length); index++) {
        const row = source[index]!;
        if (row.kind !== 'collapsed') {
            rows.push({ key: String(index), line: row });
            continue;
        }
        const shown = Math.min(expandedCounts.value[index] ?? 0, row.lines.length);
        for (let lineIndex = 0; lineIndex < shown; lineIndex++) {
            rows.push({ key: `${index}-${lineIndex}`, line: row.lines[lineIndex]! });
        }
        rows.push({ key: `gap-${index}`, gapIndex: index, shown, count: row.lines.length });
    }
    return rows;
});

function disposeWorker() {
    worker?.terminate();
    worker = null;
    if (bootstrapUrl) URL.revokeObjectURL(bootstrapUrl);
    bootstrapUrl = null;
}

function calculate() {
    const id = ++requestId;
    disposeWorker();
    result.value = null;
    visibleLimit.value = 200;
    expandedCounts.value = {};
    state.value = 'loading';
    try {
        const absoluteWorkerUrl = new URL(workerAssetUrl, document.baseURI).href;
        bootstrapUrl = URL.createObjectURL(
            new Blob([`import ${JSON.stringify(absoluteWorkerUrl)};`], {
                type: 'text/javascript'
            })
        );
        const activeWorker = new Worker(bootstrapUrl, {
            name: 'archive-source-diff',
            type: 'module'
        });
        worker = activeWorker;
        activeWorker.addEventListener('message', (event: MessageEvent<ArchiveDiffResponse>) => {
            if (worker !== activeWorker || id !== requestId || event.data.id !== id) return;
            if ('result' in event.data) {
                result.value = event.data.result;
                state.value = 'ready';
            } else {
                state.value = 'error';
            }
            disposeWorker();
        });
        const handleError = () => {
            if (worker !== activeWorker || id !== requestId) return;
            state.value = 'error';
            disposeWorker();
        };
        activeWorker.addEventListener('error', handleError);
        activeWorker.addEventListener('messageerror', handleError);
        const request: ArchiveDiffRequest = { id, before: props.before, after: props.after };
        activeWorker.postMessage(request);
    } catch {
        disposeWorker();
        state.value = 'error';
    }
}

function cancel() {
    requestId++;
    disposeWorker();
    state.value = 'cancelled';
}

watch(() => [props.before, props.after], calculate, { immediate: true, flush: 'sync' });
onUnmounted(() => {
    requestId++;
    disposeWorker();
});
</script>

<template>
    <section
        class="archive-text-diff"
        aria-label="Markdown 源码差异"
        :aria-busy="state === 'loading'"
    >
        <div v-if="state === 'loading'" class="archive-diff-status" role="status">
            <n-spin size="small" />
            <span>正在计算源码差异…</span>
            <n-button size="small" secondary @click="cancel">取消计算</n-button>
        </div>
        <n-alert v-else-if="state === 'error'" type="error" title="差异计算失败">
            <p>无法计算这两份内容的差异，请重新计算。</p>
            <n-button @click="calculate">重新计算</n-button>
        </n-alert>
        <n-alert v-else-if="state === 'cancelled'" type="info" title="已取消差异计算">
            <n-button @click="calculate">重新计算</n-button>
        </n-alert>
        <n-alert v-else-if="result?.identical" type="info" title="无内容差异">
            这两份 Markdown 源码完全相同。
        </n-alert>
        <template v-else-if="result">
            <div class="archive-diff-legend">
                <span>− 删除（{{ beforeLabel }}）：{{ result.removed }} 行</span>
                <span>+ 新增（{{ afterLabel }}）：{{ result.added }} 行</span>
                <span>按原始源码比较，保留空白和行尾差异。</span>
            </div>
            <div class="archive-diff-scroll" role="region" aria-label="源码差异列表" tabindex="0">
                <table class="archive-diff-table">
                    <thead>
                        <tr>
                            <th scope="col">原行</th>
                            <th scope="col">新行</th>
                            <th scope="col"><span class="archive-diff-sr-only">变化</span></th>
                            <th scope="col">Markdown 源码</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in displayRows"
                            :key="row.key"
                            :class="
                                'line' in row ? `archive-diff-${row.line.kind}` : 'archive-diff-gap'
                            "
                        >
                            <template v-if="'line' in row">
                                <td class="archive-diff-number">{{ row.line.beforeLine ?? '' }}</td>
                                <td class="archive-diff-number">{{ row.line.afterLine ?? '' }}</td>
                                <td class="archive-diff-marker">
                                    <span class="archive-diff-sr-only">
                                        {{
                                            row.line.kind === 'added'
                                                ? '新增'
                                                : row.line.kind === 'removed'
                                                  ? '删除'
                                                  : '未变化'
                                        }}
                                    </span>
                                    {{
                                        row.line.kind === 'added'
                                            ? '+'
                                            : row.line.kind === 'removed'
                                              ? '−'
                                              : ' '
                                    }}
                                </td>
                                <td class="archive-diff-source">
                                    <code>{{ row.line.text }}</code>
                                    <span
                                        v-if="row.line.kind !== 'context'"
                                        class="archive-diff-ending"
                                    >
                                        {{
                                            row.line.ending === 'none'
                                                ? '末行无换行'
                                                : row.line.ending
                                        }}
                                    </span>
                                </td>
                            </template>
                            <td v-else colspan="4">
                                <div class="archive-diff-gap-actions">
                                    <n-button
                                        v-if="row.shown < row.count"
                                        size="small"
                                        secondary
                                        @click="
                                            expandedCounts[row.gapIndex] = Math.min(
                                                row.shown + 100,
                                                row.count
                                            )
                                        "
                                    >
                                        展开 {{ Math.min(100, row.count - row.shown) }} 行相同内容
                                        （还有 {{ row.count - row.shown }} 行）
                                    </n-button>
                                    <n-button
                                        v-if="row.shown > 0"
                                        size="small"
                                        secondary
                                        @click="expandedCounts[row.gapIndex] = 0"
                                        >收起相同内容</n-button
                                    >
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <n-button
                v-if="visibleLimit < result.rows.length"
                secondary
                @click="visibleLimit += 200"
                >显示更多差异</n-button
            >
        </template>
    </section>
</template>

<style scoped>
.archive-text-diff {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    color: var(--ui-text-color);
}

.archive-diff-status,
.archive-diff-legend,
.archive-diff-gap-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
}

.archive-diff-legend,
.archive-diff-ending {
    color: var(--ui-secondary-text-color);
    font-size: 14px;
}

.archive-diff-scroll {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
}

.archive-diff-scroll:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.archive-diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: monospace;
    font-size: 14px;
    line-height: 1.6;
}

.archive-diff-table th,
.archive-diff-table td {
    padding: var(--ui-space-1) var(--ui-space-2);
    vertical-align: top;
    text-align: left;
}

.archive-diff-table thead,
.archive-diff-gap {
    background: var(--ui-panel-color);
}

.archive-diff-table th:first-child,
.archive-diff-table th:nth-child(2),
.archive-diff-table .archive-diff-number {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.archive-diff-number {
    color: var(--ui-secondary-text-color);
    width: 1%;
}

.archive-diff-marker {
    width: 1%;
    font-weight: 700;
}

.archive-diff-source {
    white-space: pre;
}

.archive-diff-source code {
    font: inherit;
}

.archive-diff-ending {
    margin-left: var(--ui-space-4);
    font-family: inherit;
}

.archive-diff-added {
    background: var(--ui-alert-success-background-color);
}

.archive-diff-removed {
    background: var(--ui-alert-error-background-color);
}

.archive-diff-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
</style>
