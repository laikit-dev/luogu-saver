<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NIcon, NModal, NSelect, NSpin, NSwitch, NTag } from 'naive-ui';
import { ArrowLeftRight, ArrowRight, GitCompareArrows } from 'lucide-vue-next';
import {
    collapseUnchangedLines,
    computeFieldDiffs,
    computeLineDiff,
    computeListDiff,
    type FieldDiffItem
} from '@/utils/version-diff';

export type CompareVersionOption = {
    value: number;
    label: string;
};

export interface CompareSnapshotContent {
    textLabel?: string;
    text: string;
    fields?: FieldDiffItem[];
    listLabel?: string;
    listItems?: string[];
}

const props = withDefaults(
    defineProps<{
        show: boolean;
        title?: string;
        options: CompareVersionOption[];
        leftVersion: number | null;
        rightVersion: number | null;
        leftContent: CompareSnapshotContent | null;
        rightContent: CompareSnapshotContent | null;
        loading?: boolean;
        error?: string | null;
    }>(),
    {
        title: '版本比对',
        loading: false,
        error: null
    }
);

const emit = defineEmits<{
    'update:show': [value: boolean];
    'update:leftVersion': [value: number];
    'update:rightVersion': [value: number];
    retry: [];
}>();

const changesOnly = ref(true);
const expandedHunks = ref<Set<number>>(new Set());

watch(
    () => [props.leftVersion, props.rightVersion, props.show],
    () => {
        expandedHunks.value = new Set();
    }
);

const sameVersionSelected = computed(
    () =>
        props.leftVersion !== null &&
        props.rightVersion !== null &&
        props.leftVersion === props.rightVersion
);

const fieldDiffs = computed(() => {
    const leftFields = props.leftContent?.fields ?? [];
    const rightFields = props.rightContent?.fields ?? [];
    if (leftFields.length === 0 && rightFields.length === 0) return [];

    const rightByLabel = new Map(rightFields.map(item => [item.label, item.after]));
    const pairs: FieldDiffItem[] = leftFields.map(item => ({
        label: item.label,
        before: item.before,
        after: rightByLabel.get(item.label) ?? item.after
    }));
    return computeFieldDiffs(pairs);
});

const listDiff = computed(() => {
    const leftItems = props.leftContent?.listItems;
    const rightItems = props.rightContent?.listItems;
    if (!leftItems && !rightItems) return { added: [], removed: [] };
    return computeListDiff(leftItems ?? [], rightItems ?? []);
});

const textDiff = computed(() => {
    if (!props.leftContent || !props.rightContent) {
        return { lines: [], added: 0, removed: 0, identical: true };
    }
    return computeLineDiff(props.leftContent.text, props.rightContent.text);
});

const displayItems = computed(() => {
    if (!changesOnly.value) {
        return textDiff.value.lines.map(line => ({ type: 'line' as const, line }));
    }
    return collapseUnchangedLines(textDiff.value.lines, 3);
});

const hasAnyDifference = computed(
    () =>
        fieldDiffs.value.length > 0 ||
        listDiff.value.added.length > 0 ||
        listDiff.value.removed.length > 0 ||
        !textDiff.value.identical
);

function expandHunk(id: number) {
    const next = new Set(expandedHunks.value);
    next.add(id);
    expandedHunks.value = next;
}

function handleSwap() {
    if (props.leftVersion === null || props.rightVersion === null) return;
    const prevLeft = props.leftVersion;
    const prevRight = props.rightVersion;
    emit('update:leftVersion', prevRight);
    emit('update:rightVersion', prevLeft);
}
</script>

<template>
    <n-modal
        :show="show"
        preset="card"
        :title="title"
        class="version-compare-modal"
        :style="{ width: 'min(980px, calc(100vw - 24px))' }"
        :mask-closable="true"
        @update:show="value => emit('update:show', value)"
    >
        <template #header>
            <div class="modal-title">
                <n-icon :component="GitCompareArrows" size="18" />
                <span>{{ title }}</span>
            </div>
        </template>

        <div class="compare-shell">
            <div class="compare-toolbar">
                <div class="compare-selectors">
                    <n-select
                        :value="leftVersion"
                        :options="options"
                        size="small"
                        class="version-select"
                        placeholder="选择基准版本"
                        aria-label="基准版本"
                        @update:value="val => emit('update:leftVersion', val)"
                    />
                    <n-button
                        size="small"
                        quaternary
                        aria-label="对调两个版本"
                        :disabled="leftVersion === null || rightVersion === null"
                        @click="handleSwap"
                    >
                        <template #icon>
                            <n-icon :component="ArrowLeftRight" />
                        </template>
                    </n-button>
                    <n-select
                        :value="rightVersion"
                        :options="options"
                        size="small"
                        class="version-select"
                        placeholder="选择对比版本"
                        aria-label="对比版本"
                        @update:value="val => emit('update:rightVersion', val)"
                    />
                </div>

                <div class="compare-meta">
                    <template v-if="leftContent && rightContent && !loading && !error">
                        <n-tag v-if="textDiff.added > 0" size="small" type="success">
                            +{{ textDiff.added }}
                        </n-tag>
                        <n-tag v-if="textDiff.removed > 0" size="small" type="error">
                            -{{ textDiff.removed }}
                        </n-tag>
                    </template>
                    <label class="context-toggle">
                        <span>仅看变更</span>
                        <n-switch v-model:value="changesOnly" size="small" />
                    </label>
                </div>
            </div>

            <n-alert v-if="error" type="error">
                {{ error }}
                <div class="compare-error-actions">
                    <n-button size="small" :disabled="loading" @click="emit('retry')"
                        >重试</n-button
                    >
                </div>
            </n-alert>

            <n-spin v-else :show="loading" aria-label="正在加载版本比对内容">
                <div v-if="sameVersionSelected" class="compare-empty">
                    <n-empty description="请选择两个不同的版本进行比对" />
                </div>

                <div
                    v-else-if="leftContent && rightContent && !hasAnyDifference && !loading"
                    class="compare-empty"
                >
                    <n-empty description="两个版本内容完全一致" />
                </div>

                <div v-else-if="leftContent && rightContent" class="compare-content">
                    <section v-if="fieldDiffs.length > 0" class="structured-section">
                        <div class="section-label">属性变更</div>
                        <div class="field-diff-list">
                            <div
                                v-for="field in fieldDiffs"
                                :key="field.label"
                                class="field-diff-row"
                            >
                                <span class="field-name">{{ field.label }}</span>
                                <span class="field-old">{{ field.before || '（空）' }}</span>
                                <n-icon :component="ArrowRight" size="14" class="field-arrow" />
                                <span class="field-new">{{ field.after || '（空）' }}</span>
                            </div>
                        </div>
                    </section>

                    <section
                        v-if="listDiff.added.length > 0 || listDiff.removed.length > 0"
                        class="structured-section"
                    >
                        <div class="section-label">
                            {{ leftContent.listLabel || rightContent.listLabel || '列表变更' }}
                        </div>
                        <div class="list-diff-tags">
                            <n-tag
                                v-for="(item, idx) in listDiff.removed"
                                :key="`rm-${idx}-${item}`"
                                size="small"
                                type="error"
                            >
                                − {{ item }}
                            </n-tag>
                            <n-tag
                                v-for="(item, idx) in listDiff.added"
                                :key="`add-${idx}-${item}`"
                                size="small"
                                type="success"
                            >
                                + {{ item }}
                            </n-tag>
                        </div>
                    </section>

                    <section v-if="!textDiff.identical" class="text-diff-section">
                        <div
                            v-if="leftContent.textLabel || rightContent.textLabel"
                            class="section-label"
                        >
                            {{ leftContent.textLabel || rightContent.textLabel }}
                        </div>
                        <div class="diff-viewport" role="region" aria-label="逐行文本差异">
                            <table class="diff-table">
                                <tbody>
                                    <template
                                        v-for="(item, idx) in displayItems"
                                        :key="
                                            item.type === 'collapsed' ? `c-${item.id}` : `l-${idx}`
                                        "
                                    >
                                        <tr
                                            v-if="
                                                item.type === 'collapsed' &&
                                                !expandedHunks.has(item.id)
                                            "
                                            class="diff-row is-collapsed"
                                        >
                                            <td colspan="4" class="diff-collapsed-cell">
                                                <button
                                                    type="button"
                                                    class="expand-hunk-btn"
                                                    @click="expandHunk(item.id)"
                                                >
                                                    展开 {{ item.lines.length }} 行未变更内容
                                                </button>
                                            </td>
                                        </tr>
                                        <template
                                            v-else-if="
                                                item.type === 'collapsed' &&
                                                expandedHunks.has(item.id)
                                            "
                                        >
                                            <tr
                                                v-for="(line, subIdx) in item.lines"
                                                :key="`e-${item.id}-${subIdx}`"
                                                class="diff-row is-equal"
                                            >
                                                <td class="diff-ln">{{ line.oldLine ?? '' }}</td>
                                                <td class="diff-ln">{{ line.newLine ?? '' }}</td>
                                                <td class="diff-sign"></td>
                                                <td class="diff-code">{{ line.text }}</td>
                                            </tr>
                                        </template>
                                        <tr
                                            v-else-if="item.type === 'line'"
                                            class="diff-row"
                                            :class="`is-${item.line.kind}`"
                                        >
                                            <td class="diff-ln">{{ item.line.oldLine ?? '' }}</td>
                                            <td class="diff-ln">{{ item.line.newLine ?? '' }}</td>
                                            <td class="diff-sign">
                                                {{
                                                    item.line.kind === 'add'
                                                        ? '+'
                                                        : item.line.kind === 'remove'
                                                          ? '−'
                                                          : ''
                                                }}
                                            </td>
                                            <td class="diff-code">{{ item.line.text }}</td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            </n-spin>
        </div>
    </n-modal>
</template>

<style scoped>
.modal-title {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-2);
    color: var(--ui-card-title-color);
    font-weight: 600;
}

.compare-shell {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.compare-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    flex-wrap: wrap;
}

.compare-selectors {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex: 1 1 380px;
    min-width: 0;
}

.version-select {
    flex: 1 1 180px;
    min-width: 0;
}

.compare-meta {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-shrink: 0;
}

.context-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ui-secondary-text-color);
    cursor: pointer;
    user-select: none;
}

.compare-error-actions {
    margin-top: var(--ui-space-2);
}

.compare-empty {
    padding: var(--ui-space-8) 0;
}

.compare-content {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.structured-section,
.text-diff-section {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.section-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-secondary-text-color);
}

.field-diff-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.field-diff-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
    font-size: 13px;
}

.field-name {
    min-width: 84px;
    font-weight: 600;
    color: var(--ui-text-color);
}

.field-old {
    padding: 1px 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-alert-error-background-color);
    color: var(--ui-error-color);
    text-decoration: line-through;
    overflow-wrap: anywhere;
}

.field-new {
    padding: 1px 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-alert-success-background-color);
    color: var(--ui-success-color);
    overflow-wrap: anywhere;
}

.field-arrow {
    color: var(--ui-muted-text-color);
    flex-shrink: 0;
}

.list-diff-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.diff-viewport {
    max-height: 58vh;
    overflow: auto;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
}

.diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--ui-font-family-mono);
    font-size: 12.5px;
    line-height: 1.55;
}

.diff-row.is-add {
    background: var(--ui-alert-success-background-color);
}

.diff-row.is-remove {
    background: var(--ui-alert-error-background-color);
}

.diff-ln {
    width: 42px;
    min-width: 42px;
    padding: 1px 6px;
    text-align: right;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    user-select: none;
    vertical-align: top;
    border-right: 1px solid var(--ui-border-color);
}

.diff-sign {
    width: 22px;
    min-width: 22px;
    padding: 1px 4px;
    text-align: center;
    font-weight: 700;
    user-select: none;
    vertical-align: top;
}

.diff-row.is-add .diff-sign {
    color: var(--ui-success-color);
}

.diff-row.is-remove .diff-sign {
    color: var(--ui-error-color);
}

.diff-code {
    padding: 1px var(--ui-space-3) 1px 4px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ui-text-color);
}

.diff-collapsed-cell {
    padding: 0;
    background: var(--ui-panel-color);
    border-top: 1px solid var(--ui-border-color);
    border-bottom: 1px solid var(--ui-border-color);
}

.expand-hunk-btn {
    width: 100%;
    padding: 4px var(--ui-space-3);
    border: 0;
    background: transparent;
    color: var(--ui-link-color);
    font-family: var(--ui-font-family-sans);
    font-size: 12px;
    cursor: pointer;
    text-align: center;
}

.expand-hunk-btn:hover {
    background: var(--ui-control-tag-color);
}

@media (max-width: 640px) {
    .compare-selectors {
        flex-wrap: wrap;
    }

    .diff-ln {
        width: 32px;
        min-width: 32px;
        padding: 1px 4px;
    }
}
</style>
