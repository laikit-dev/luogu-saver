<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { isAxiosError } from 'axios';
import { NAlert, NButton, NDatePicker, NEmpty, NSelect, NSpin } from 'naive-ui';
import {
    getLibraryFeed,
    getUserArchiveTimeline,
    type ArchiveEvent,
    type ArchiveKind,
    type TimelineQuery,
    type TimelineScope
} from '@/api/archive.ts';
import { authToken, currentAuth, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const props = defineProps<{ scope: TimelineScope; refreshKey?: number }>();
const route = useRoute();
const kinds = ref<ArchiveKind[]>(['article', 'version', 'profile']);
const from = ref<number | null>(null);
const to = ref<number | null>(null);
const items = ref<ArchiveEvent[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const accessIssue = ref<'expired' | 'forbidden' | null>(null);
let requestId = 0;

const kindLabels: Record<ArchiveKind, string> = {
    article: '本站首次收录',
    version: '文章归档版本',
    profile: '资料快照'
};
const kindOptions = Object.entries(kindLabels).map(([value, label]) => ({ value, label }));
const loginRequired = computed(() => props.scope.type === 'library' && !isAuthenticated.value);
const filterError = computed(() => {
    if (!kinds.value.length) return '请至少选择一种记录类型。';
    if (from.value !== null && to.value !== null && from.value >= to.value) {
        return '开始时间必须早于截止时间。';
    }
    return null;
});
const months = computed(() => {
    const groups: { key: string; label: string; items: ArchiveEvent[] }[] = [];
    for (const item of items.value) {
        const date = new Date(item.observedAt);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        let group = groups[groups.length - 1];
        if (!group || group.key !== key) {
            group = {
                key,
                label: date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }),
                items: []
            };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
});

function eventLocation(item: ArchiveEvent) {
    if (item.kind === 'profile') {
        return { path: `/user/${item.uid}`, query: { version: String(item.version) } };
    }
    return {
        path: `/article/${item.articleId}`,
        query: item.kind === 'version' ? { version: String(item.version) } : {}
    };
}

async function loadPage(append = false) {
    if (loading.value || loginRequired.value || filterError.value || (append && !nextCursor.value))
        return;
    const id = ++requestId;
    const scope = props.scope;
    const query: TimelineQuery = {
        kinds: [...kinds.value],
        from: from.value === null ? undefined : new Date(from.value).toISOString(),
        to: to.value === null ? undefined : new Date(to.value).toISOString(),
        cursor: append ? (nextCursor.value ?? undefined) : undefined,
        limit: 20
    };
    loading.value = true;
    error.value = null;
    accessIssue.value = null;
    try {
        const response =
            scope.type === 'user'
                ? await getUserArchiveTimeline(scope.uid, query)
                : await getLibraryFeed(query);
        if (id !== requestId) return;
        if (response.code !== 200) {
            setFailure(scope, response.code, '归档时间线加载失败，请重试。');
            return;
        }
        if (append) {
            const existing = new Set(items.value.map(item => item.eventId));
            items.value.push(...response.data.items.filter(item => !existing.has(item.eventId)));
        } else {
            items.value = response.data.items;
        }
        nextCursor.value = response.data.nextCursor;
    } catch (failure) {
        if (id !== requestId) return;
        setFailure(
            scope,
            isAxiosError(failure) ? failure.response?.status : undefined,
            requestErrorMessage(failure, '归档时间线加载失败，请重试。')
        );
    } finally {
        if (id === requestId) loading.value = false;
    }
}

function setFailure(scope: TimelineScope, code: number | undefined, fallback: string) {
    accessIssue.value =
        scope.type !== 'library'
            ? null
            : code === 401
              ? 'expired'
              : code === 403
                ? 'forbidden'
                : null;
    if (accessIssue.value) {
        items.value = [];
        nextCursor.value = null;
    }
    error.value =
        accessIssue.value === 'expired'
            ? '登录已失效，请使用 CP OAuth 重新登录后查看关注动态。'
            : accessIssue.value === 'forbidden'
              ? '当前账号无权查看关注动态，账号可能已被封禁。'
              : fallback;
}

function resetTimeline() {
    requestId++;
    items.value = [];
    nextCursor.value = null;
    error.value = null;
    loading.value = false;
    accessIssue.value = null;
    void loadPage();
}

watch(
    () => [
        props.scope.type,
        props.scope.type === 'user' ? props.scope.uid : null,
        props.refreshKey,
        kinds.value.join(','),
        from.value,
        to.value,
        props.scope.type === 'library' ? authToken.value : null,
        props.scope.type === 'library' ? currentAuth.value?.uid : null,
        props.scope.type === 'library' ? currentAuth.value?.registeredUser?.id : null
    ],
    resetTimeline,
    { immediate: true, flush: 'sync' }
);
onUnmounted(() => {
    requestId++;
});
</script>

<template>
    <div class="archive-timeline">
        <p class="archive-description">
            时间线只展示本站记录的归档信息，不代表作者在原站的编辑时间。日期按本地时区显示，截止时间不包含在结果内。
        </p>
        <div class="archive-filters">
            <label class="archive-filter">
                <span>记录类型</span>
                <n-select
                    v-model:value="kinds"
                    :options="kindOptions"
                    multiple
                    :max-tag-count="2"
                    aria-label="筛选归档记录类型"
                    :input-props="{ 'aria-label': '筛选归档记录类型' }"
                />
            </label>
            <label class="archive-filter">
                <span>开始时间</span>
                <n-date-picker
                    v-model:value="from"
                    type="datetime"
                    clearable
                    :actions="['confirm']"
                    aria-label="归档记录开始时间"
                    placeholder="不限开始时间"
                />
            </label>
            <label class="archive-filter">
                <span>截止时间（不含）</span>
                <n-date-picker
                    v-model:value="to"
                    type="datetime"
                    clearable
                    :actions="['confirm']"
                    aria-label="归档记录截止时间，不含此时间"
                    placeholder="不限截止时间"
                />
            </label>
        </div>

        <n-alert v-if="filterError" type="warning">{{ filterError }}</n-alert>
        <n-alert v-else-if="loginRequired" type="info">
            关注动态属于当前登录账号，不公开展示。
            <div class="archive-state-actions">
                <n-button type="primary" @click="startCpOAuthLogin(route.fullPath)"
                    >使用 CP OAuth 登录</n-button
                >
            </div>
        </n-alert>
        <template v-else>
            <n-alert v-if="error" type="error">
                {{ error }}
                <div v-if="accessIssue !== 'forbidden'" class="archive-state-actions">
                    <n-button
                        v-if="accessIssue === 'expired'"
                        type="primary"
                        @click="startCpOAuthLogin(route.fullPath)"
                        >使用 CP OAuth 重新登录</n-button
                    >
                    <n-button v-else :disabled="loading" @click="loadPage(items.length > 0)"
                        >重试</n-button
                    >
                </div>
            </n-alert>
            <n-spin :show="loading" aria-label="正在加载归档时间线">
                <n-empty
                    v-if="!loading && !error && !items.length"
                    :description="
                        scope.type === 'library'
                            ? '暂无匹配的关注或稍后阅读动态'
                            : '暂无符合筛选条件的归档记录'
                    "
                />
                <section v-for="month in months" :key="month.key" class="archive-month">
                    <h3>{{ month.label }}</h3>
                    <ol class="archive-events">
                        <li v-for="item in month.items" :key="item.eventId" class="archive-event">
                            <div class="archive-event-kind">
                                {{ kindLabels[item.kind]
                                }}<template v-if="item.version !== null">
                                    · v{{ item.version }}</template
                                >
                            </div>
                            <RouterLink class="archive-event-title" :to="eventLocation(item)">{{
                                item.title
                            }}</RouterLink>
                            <div class="archive-event-meta">
                                <span
                                    >本站记录：<time :datetime="item.observedAt">{{
                                        formatDate(item.observedAt)
                                    }}</time></span
                                >
                                <span v-if="item.kind !== 'profile'">
                                    原文发布：<time
                                        v-if="item.publishedAt"
                                        :datetime="item.publishedAt"
                                        >{{ formatDate(item.publishedAt) }}</time
                                    ><template v-else>未知</template>
                                </span>
                                <RouterLink
                                    v-if="scope.type === 'library'"
                                    :to="`/user/${item.uid}`"
                                    >洛谷 UID {{ item.uid }}</RouterLink
                                >
                            </div>
                        </li>
                    </ol>
                </section>
                <p v-if="loading && !items.length" class="archive-description" role="status">
                    正在读取归档记录…
                </p>
            </n-spin>
            <div v-if="nextCursor" class="archive-load-more">
                <n-button :loading="loading" :disabled="loading" @click="loadPage(true)"
                    >加载更多</n-button
                >
            </div>
            <p
                v-else-if="items.length && !loading && !error"
                class="archive-description archive-end"
            >
                已显示全部匹配记录
            </p>
        </template>
    </div>
</template>

<style scoped>
.archive-timeline {
    min-width: 0;
}
.archive-description {
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}
.archive-filters {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 1fr));
    gap: var(--ui-control-gap);
    margin-bottom: var(--ui-space-4);
}
.archive-filter {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    min-width: 0;
}
.archive-filter :deep(.n-date-picker) {
    width: 100%;
    min-width: 0;
}
.archive-month {
    margin-top: var(--ui-space-5);
    min-width: 0;
}
.archive-month h3 {
    margin: 0 0 var(--ui-space-3);
    font-size: 16px;
    font-weight: 600;
}
.archive-events {
    margin: 0;
    padding: 0;
    list-style: none;
}
.archive-event {
    margin-left: var(--ui-space-2);
    padding: var(--ui-space-3) var(--ui-space-4);
    border-left: 2px solid var(--ui-border-color);
    border-bottom: 1px solid var(--ui-border-color);
    min-width: 0;
    overflow-wrap: anywhere;
}
.archive-event-kind {
    color: var(--ui-secondary-text-color);
    margin-bottom: var(--ui-space-1);
}
.archive-event-title {
    color: var(--ui-link-color);
    font-weight: 600;
}
.archive-event-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap) var(--ui-space-4);
    margin-top: var(--ui-space-2);
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}
.archive-event-meta a {
    color: var(--ui-link-color);
}
.archive-state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}
.archive-load-more {
    display: flex;
    justify-content: center;
    margin-top: var(--ui-space-4);
}
.archive-end {
    text-align: center;
    margin-top: var(--ui-space-4);
    margin-bottom: 0;
}
a:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 3px;
}
@media (max-width: 768px) {
    .archive-filters {
        grid-template-columns: minmax(0, 1fr);
    }
    .archive-event-meta {
        flex-direction: column;
        gap: var(--ui-space-1);
    }
}
</style>
