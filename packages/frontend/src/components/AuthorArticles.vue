<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { NAlert, NButton, NEmpty, NSelect, NSpin } from 'naive-ui';
import {
    getAuthorArticles,
    type ArchiveArticleSummary,
    type AuthorArticlesQuery
} from '@/api/archive.ts';
import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const props = defineProps<{ uid: number; refreshKey?: number }>();
const category = ref<number | null>(null);
const sort = ref<'archived' | 'published'>('archived');
const items = ref<ArchiveArticleSummary[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let requestId = 0;

const categoryOptions = Object.entries(ARTICLE_CATEGORIES).map(([value, item]) => ({
    value: Number(value),
    label: item.label
}));
const sortOptions = [
    { value: 'archived', label: '本站首次收录时间（最新在前）' },
    { value: 'published', label: '原文发布时间（最新在前）' }
];

async function loadPage(append = false) {
    if (loading.value || (append && !nextCursor.value)) return;
    const id = ++requestId;
    const requestedUid = props.uid;
    const query: AuthorArticlesQuery = {
        category: category.value ?? undefined,
        sort: sort.value,
        cursor: append ? (nextCursor.value ?? undefined) : undefined,
        limit: 20
    };
    loading.value = true;
    error.value = null;
    try {
        const response = await getAuthorArticles(requestedUid, query);
        if (id !== requestId) return;
        if (response.code !== 200) {
            error.value = '作者文章加载失败，请重试。';
            return;
        }
        if (append) {
            const existing = new Set(items.value.map(item => item.id));
            items.value.push(...response.data.items.filter(item => !existing.has(item.id)));
        } else {
            items.value = response.data.items;
        }
        nextCursor.value = response.data.nextCursor;
    } catch (failure) {
        if (id === requestId)
            error.value = requestErrorMessage(failure, '作者文章加载失败，请重试。');
    } finally {
        if (id === requestId) loading.value = false;
    }
}

watch(
    () => [props.uid, props.refreshKey, category.value, sort.value],
    () => {
        requestId++;
        items.value = [];
        nextCursor.value = null;
        error.value = null;
        loading.value = false;
        void loadPage();
    },
    { immediate: true, flush: 'sync' }
);
onUnmounted(() => {
    requestId++;
});
</script>

<template>
    <div class="archive-author-articles">
        <p class="archive-description">
            这里只列出本站已收录且当前可见的文章，不会为浏览列表抓取原站。发布时间未知的文章在发布排序中置于末尾。
        </p>
        <div class="archive-filters">
            <label class="archive-filter">
                <span>文章分类</span>
                <n-select
                    v-model:value="category"
                    :options="categoryOptions"
                    clearable
                    placeholder="全部分类"
                    :input-props="{ 'aria-label': '筛选作者文章分类' }"
                />
            </label>
            <label class="archive-filter">
                <span>排序依据</span>
                <n-select
                    v-model:value="sort"
                    :options="sortOptions"
                    :input-props="{ 'aria-label': '作者文章排序依据' }"
                />
            </label>
        </div>
        <n-alert v-if="error" type="error">
            {{ error }}
            <div class="archive-state-actions">
                <n-button :disabled="loading" @click="loadPage(items.length > 0)">重试</n-button>
            </div>
        </n-alert>
        <n-spin :show="loading" aria-label="正在加载作者文章">
            <n-empty
                v-if="!loading && !error && !items.length"
                description="暂无符合筛选条件的已收录文章"
            />
            <ul v-if="items.length" class="archive-articles">
                <li v-for="item in items" :key="item.id" class="archive-article">
                    <RouterLink class="archive-article-title" :to="`/article/${item.id}`">{{
                        item.title
                    }}</RouterLink>
                    <p v-if="item.summary" class="archive-summary">{{ item.summary }}</p>
                    <div class="archive-meta">
                        <span>{{
                            (ARTICLE_CATEGORIES[item.category] || UNKNOWN_CATEGORY).label
                        }}</span>
                        <span
                            >本站首次收录：<time :datetime="item.createdAt">{{
                                formatDate(item.createdAt)
                            }}</time></span
                        >
                        <span
                            >原文发布：<time v-if="item.publishedAt" :datetime="item.publishedAt">{{
                                formatDate(item.publishedAt)
                            }}</time
                            ><template v-else>未知</template></span
                        >
                    </div>
                </li>
            </ul>
            <p v-if="loading && !items.length" class="archive-description" role="status">
                正在读取已收录文章…
            </p>
        </n-spin>
        <div v-if="nextCursor" class="archive-load-more">
            <n-button :loading="loading" :disabled="loading" @click="loadPage(true)"
                >加载更多</n-button
            >
        </div>
        <p v-else-if="items.length && !loading && !error" class="archive-description archive-end">
            已显示全部匹配文章
        </p>
    </div>
</template>

<style scoped>
.archive-author-articles {
    min-width: 0;
}
.archive-description {
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}
.archive-filters {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
    gap: var(--ui-control-gap);
    margin-bottom: var(--ui-space-4);
}
.archive-filter {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    min-width: 0;
}
.archive-articles {
    list-style: none;
    margin: 0;
    padding: 0;
}
.archive-article {
    padding: var(--ui-space-4) 0;
    border-bottom: 1px solid var(--ui-border-color);
    min-width: 0;
    overflow-wrap: anywhere;
}
.archive-article-title {
    color: var(--ui-link-color);
    font-weight: 600;
}
.archive-summary {
    margin: var(--ui-space-2) 0;
    color: var(--ui-secondary-text-color);
    white-space: pre-wrap;
}
.archive-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap) var(--ui-space-4);
    margin-top: var(--ui-space-2);
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}
.archive-state-actions {
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
    .archive-meta {
        flex-direction: column;
        gap: var(--ui-space-1);
    }
}
</style>
