<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NEmpty, NSelect, NSpin, useMessage } from 'naive-ui';
import Card from '@/components/Card.vue';
import ArchiveTextDiff from '@/components/ArchiveTextDiff.vue';
import {
    getArticleVersions,
    getArticleVersionComparison,
    parsePositiveIntId,
    type ArticleVersionComparison,
    type ArticleVersionMetadata
} from '@/api/archive';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request';

const props = withDefaults(defineProps<{ articleId: string; refreshKey?: number }>(), {
    refreshKey: 0
});
const emit = defineEmits<{ close: []; unavailable: [code: number] }>();
const route = useRoute();
const router = useRouter();
const message = useMessage();
const versions = shallowRef<ArticleVersionMetadata[]>([]);
const versionsLoading = ref(true);
const versionsError = ref('');
const fromVersion = ref<number | null>(null);
const toVersion = ref<number | null>(null);
const comparison = shallowRef<ArticleVersionComparison | null>(null);
const comparisonLoading = ref(false);
const comparisonError = ref('');
let versionsRequest = 0;
let comparisonRequest = 0;
let disposed = false;
let hadComparisonQuery =
    route.query.compareFrom !== undefined || route.query.compareTo !== undefined;

const options = computed(() =>
    versions.value.map(version => ({
        value: version.version,
        label: `版本 ${version.version} · ${formatDate(version.createdAt)} · ${version.title}`
    }))
);
const fromOptions = computed(() =>
    options.value.map(option => ({
        ...option,
        disabled: option.value === toVersion.value
    }))
);
const toOptions = computed(() =>
    options.value.map(option => ({
        ...option,
        disabled: option.value === fromVersion.value
    }))
);
const permalinkLocation = computed(() => {
    if (!comparison.value) return null;
    return {
        path: `/article/${props.articleId}`,
        query: {
            compareFrom: String(comparison.value.from.version),
            compareTo: String(comparison.value.to.version)
        }
    };
});
const permalink = computed(() =>
    permalinkLocation.value ? router.resolve(permalinkLocation.value).href : ''
);

function versionLocation(version: number) {
    return { path: `/article/${props.articleId}`, query: { version: String(version) } };
}

async function replacePair(from: number, to: number) {
    if (disposed) return;
    comparisonRequest++;
    comparison.value = null;
    comparisonLoading.value = false;
    comparisonError.value = '';
    const query = { ...route.query };
    delete query.version;
    query.compareFrom = String(from);
    query.compareTo = String(to);
    await router.replace({ query });
    if (disposed) return;
    if (route.query.compareFrom === String(from) && route.query.compareTo === String(to)) {
        if (!comparison.value && !comparisonLoading.value) await syncSelection();
    }
}

async function selectVersion(side: 'from' | 'to', value: unknown) {
    if (disposed || typeof value !== 'number') return;
    if (side === 'from') fromVersion.value = value;
    else toVersion.value = value;
    comparisonRequest++;
    comparison.value = null;
    comparisonLoading.value = false;
    comparisonError.value = '';
    if (fromVersion.value === null || toVersion.value === null) return;
    if (fromVersion.value === toVersion.value) {
        comparisonError.value = '请选择两个不同的版本';
        return;
    }
    await replacePair(fromVersion.value, toVersion.value);
}
async function syncSelection() {
    if (disposed) return;
    const request = ++comparisonRequest;
    comparison.value = null;
    comparisonLoading.value = false;
    comparisonError.value = '';
    fromVersion.value = parsePositiveIntId(route.query.compareFrom);
    toVersion.value = parsePositiveIntId(route.query.compareTo);
    const hasComparisonQuery =
        route.query.compareFrom !== undefined || route.query.compareTo !== undefined;
    if (hasComparisonQuery) hadComparisonQuery = true;
    if (versionsLoading.value || versionsError.value) return;
    if (!hasComparisonQuery) {
        if (hadComparisonQuery) {
            emit('close');
            return;
        }
        if (versions.value.length < 2) return;
        const viewingVersion = parsePositiveIntId(route.query.version);
        const viewingIndex = versions.value.findIndex(
            version => version.version === viewingVersion
        );
        const index = Math.max(0, viewingIndex);
        const selected = versions.value[index]!;
        const adjacent = versions.value[index + 1] ?? versions.value[index - 1]!;
        await replacePair(
            Math.min(selected.version, adjacent.version),
            Math.max(selected.version, adjacent.version)
        );
        return;
    }
    const from = fromVersion.value;
    const to = toVersion.value;
    if (from === null || to === null || from === to) {
        comparisonError.value = '请选择两个不同的归档版本';
        return;
    }
    if (
        !versions.value.some(version => version.version === from) ||
        !versions.value.some(version => version.version === to)
    ) {
        comparisonError.value = '所选版本不存在';
        return;
    }
    const articleId = props.articleId;
    comparisonLoading.value = true;
    try {
        const response = await getArticleVersionComparison(articleId, from, to);
        if (disposed || request !== comparisonRequest || articleId !== props.articleId) return;
        if (response.code !== 200 || !response.data) {
            comparisonError.value =
                response.code === 403
                    ? response.message || '文章不可查看'
                    : response.code === 404
                      ? '文章或所选版本不存在'
                      : response.message || '版本对比加载失败';
            if (response.code === 403) emit('unavailable', response.code);
            return;
        }
        comparison.value = response.data;
    } catch (error) {
        if (!disposed && request === comparisonRequest) {
            comparisonError.value = requestErrorMessage(error, '版本对比加载失败');
        }
    } finally {
        if (!disposed && request === comparisonRequest) comparisonLoading.value = false;
    }
}

async function loadVersions() {
    const request = ++versionsRequest;
    comparisonRequest++;
    versions.value = [];
    comparison.value = null;
    versionsError.value = '';
    comparisonError.value = '';
    comparisonLoading.value = false;
    versionsLoading.value = true;
    const articleId = props.articleId;
    try {
        const response = await getArticleVersions(articleId);
        if (disposed || request !== versionsRequest || articleId !== props.articleId) return;
        if (response.code !== 200 || !response.data) {
            versionsError.value =
                response.code === 403
                    ? response.message || '文章不可查看'
                    : response.code === 404
                      ? '文章不存在'
                      : response.message || '版本列表加载失败';
            if (response.code === 403 || response.code === 404) emit('unavailable', response.code);
            return;
        }
        versions.value = [...response.data.versions].sort((a, b) => b.version - a.version);
    } catch (error) {
        if (!disposed && request === versionsRequest)
            versionsError.value = requestErrorMessage(error, '版本列表加载失败');
    } finally {
        if (!disposed && request === versionsRequest) versionsLoading.value = false;
    }
    if (!disposed && request === versionsRequest && !versionsError.value) await syncSelection();
}

async function closeComparison() {
    comparisonRequest++;
    comparison.value = null;
    comparisonLoading.value = false;
    const query = { ...route.query };
    delete query.compareFrom;
    delete query.compareTo;
    await router.replace({ query });
    if (!disposed) emit('close');
}

async function copyPermalink() {
    if (!permalink.value) return;
    try {
        await navigator.clipboard.writeText(new URL(permalink.value, window.location.href).href);
        if (!disposed) message.success('对比链接已复制');
    } catch {
        if (!disposed) message.error('复制失败');
    }
}

watch(() => [props.articleId, props.refreshKey], loadVersions, { immediate: true, flush: 'sync' });
watch(() => [route.query.compareFrom, route.query.compareTo], syncSelection, { flush: 'sync' });
onUnmounted(() => {
    disposed = true;
    versionsRequest++;
    comparisonRequest++;
});
</script>

<template>
    <Card title="归档版本对比" class="archive-version-compare">
        <template #header-extra>
            <n-button size="small" secondary @click="closeComparison">退出对比</n-button>
        </template>
        <div class="archive-compare-content">
            <div v-if="versionsLoading" class="archive-compare-loading" role="status">
                <n-spin size="small" />
                <span>正在加载归档版本…</span>
            </div>
            <n-alert v-else-if="versionsError" type="error" title="版本列表加载失败">
                <p>{{ versionsError }}</p>
                <n-button @click="loadVersions">重试</n-button>
            </n-alert>
            <template v-else>
                <div v-if="versions.length" class="archive-compare-selectors">
                    <label class="archive-compare-field">
                        <span>旧版本</span>
                        <n-select
                            :value="fromVersion"
                            :options="fromOptions"
                            filterable
                            placeholder="选择版本"
                            aria-label="旧版本"
                            @update:value="value => selectVersion('from', value)"
                        />
                    </label>
                    <label class="archive-compare-field">
                        <span>新版本</span>
                        <n-select
                            :value="toVersion"
                            :options="toOptions"
                            filterable
                            placeholder="选择版本"
                            aria-label="新版本"
                            @update:value="value => selectVersion('to', value)"
                        />
                    </label>
                </div>
                <div v-if="versions.length > 1" class="archive-compare-actions">
                    <n-button
                        size="small"
                        secondary
                        :disabled="
                            fromVersion === null || toVersion === null || fromVersion === toVersion
                        "
                        @click="
                            fromVersion !== null &&
                            toVersion !== null &&
                            replacePair(toVersion, fromVersion)
                        "
                        >交换版本</n-button
                    >
                </div>
                <n-alert v-if="comparisonError" type="error" title="版本对比失败">
                    <p>{{ comparisonError }}</p>
                    <n-button @click="syncSelection">重试</n-button>
                </n-alert>
                <div v-else-if="comparisonLoading" class="archive-compare-loading" role="status">
                    <n-spin size="small" />
                    <span>正在读取所选版本…</span>
                </div>
                <template v-else-if="comparison">
                    <div class="archive-compare-actions">
                        <RouterLink
                            v-if="permalinkLocation"
                            v-slot="{ href, navigate }"
                            :to="permalinkLocation"
                            custom
                        >
                            <n-button size="small" secondary tag="a" :href="href" @click="navigate"
                                >对比永久链接</n-button
                            >
                        </RouterLink>
                        <n-button size="small" secondary @click="copyPermalink"
                            >复制对比链接</n-button
                        >
                    </div>
                    <n-alert v-if="comparison.from.title !== comparison.to.title" type="warning">
                        标题已变化
                    </n-alert>
                    <div class="archive-compare-snapshots">
                        <section class="archive-compare-snapshot">
                            <h3>版本 {{ comparison.from.version }}</h3>
                            <p class="archive-compare-title">{{ comparison.from.title }}</p>
                            <p class="archive-compare-time">
                                记录于 {{ formatDate(comparison.from.createdAt) }}
                            </p>
                            <RouterLink
                                class="archive-compare-link"
                                :to="versionLocation(comparison.from.version)"
                                >查看该版本</RouterLink
                            >
                        </section>
                        <section class="archive-compare-snapshot">
                            <h3>版本 {{ comparison.to.version }}</h3>
                            <p class="archive-compare-title">{{ comparison.to.title }}</p>
                            <p class="archive-compare-time">
                                记录于 {{ formatDate(comparison.to.createdAt) }}
                            </p>
                            <RouterLink
                                class="archive-compare-link"
                                :to="versionLocation(comparison.to.version)"
                                >查看该版本</RouterLink
                            >
                        </section>
                    </div>
                    <ArchiveTextDiff
                        :before="comparison.from.content"
                        :after="comparison.to.content"
                        :before-label="`归档版本 ${comparison.from.version}`"
                        :after-label="`归档版本 ${comparison.to.version}`"
                    />
                </template>
                <n-empty
                    v-else-if="versions.length < 2"
                    description="至少需要两个归档版本才能对比"
                />
            </template>
        </div>
    </Card>
</template>

<style scoped>
.archive-version-compare,
.archive-compare-content,
.archive-compare-field,
.archive-compare-snapshot {
    min-width: 0;
}

.archive-compare-content {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.archive-compare-note {
    margin: 0;
    color: var(--ui-secondary-text-color);
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.archive-compare-selectors,
.archive-compare-snapshots {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.archive-compare-field {
    display: flex;
    flex-direction: column;
    gap: var(--ui-inline-gap);
}

.archive-compare-loading,
.archive-compare-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-control-gap);
}

.archive-compare-snapshot {
    padding: var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
    overflow-wrap: anywhere;
}

.archive-compare-snapshot h3,
.archive-compare-title,
.archive-compare-time {
    margin: 0 0 var(--ui-space-2);
    font-size: 14px;
    line-height: 1.6;
}

.archive-compare-title {
    color: var(--ui-text-color);
}

.archive-compare-time {
    color: var(--ui-secondary-text-color);
    font-variant-numeric: tabular-nums;
}

.archive-compare-link {
    color: var(--ui-link-color);
}

.archive-compare-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

@media (max-width: 768px) {
    .archive-compare-selectors,
    .archive-compare-snapshots {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
