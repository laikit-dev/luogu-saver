<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router';
import {
    NAlert,
    NEmpty,
    NButton,
    NGi,
    NGrid,
    NIcon,
    NInput,
    NPagination,
    NSelect,
    NSpace,
    NSpin,
    NTag
} from 'naive-ui';
import { CalendarDays, Newspaper, User, Search } from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import Card from '@/components/Card.vue';
import { searchArticles, type ArticleSearchHit } from '@/api/search.ts';
import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants.ts';
import { formatDate, renderSafeMarkedHtml } from '@/utils/render.ts';
import { getCategoryTagStyle } from '@/utils/article.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const route = useRoute();
const router = useRouter();
const AUTHOR_UID_PATTERN = /(?:^|\s)(?:author|uid|作者)\s*[:：]\s*(\d+)(?=\s|$)/i;

function parseRouteNumber(value: unknown): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseAuthorId(value: unknown): number | null {
    const parsed = parseRouteNumber(value);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function parseSearchInput(value: string) {
    const match = value.match(AUTHOR_UID_PATTERN);
    if (!match) {
        return { q: value.trim(), authorId: null };
    }

    const authorId = Number(match[1]);

    return {
        q: value.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
        authorId: authorId > 0 ? authorId : null
    };
}

function getRouteSearchInput(qValue: unknown, authorIdValue: unknown) {
    const raw = Array.isArray(qValue) ? qValue[0] : qValue;
    const rawQuery = typeof raw === 'string' ? raw : '';
    const routeAuthorId = parseAuthorId(authorIdValue);

    if (routeAuthorId !== null && parseSearchInput(rawQuery).authorId === null) {
        return `${rawQuery} uid:${routeAuthorId}`.trim();
    }

    return rawQuery;
}

const query = ref(getRouteSearchInput(route.query.q, route.query.authorId));
const category = ref<number | null>(parseRouteNumber(route.query.category));
const page = ref(Number(route.query.page) || 1);
const limit = 12;
const loading = ref(false);
const error = ref<string | null>(null);
const hits = ref<ArticleSearchHit[]>([]);
const total = ref(0);
const processingTimeMs = ref(0);
let requestId = 0;

const categoryOptions = computed(() => [
    ...Object.entries(ARTICLE_CATEGORIES)
        .filter(([key]) => Number(key) !== 9)
        .map(([key, item]) => ({ label: item.label, value: Number(key) }))
]);

function getCategory(categoryId: number) {
    return ARTICLE_CATEGORIES[categoryId] || UNKNOWN_CATEGORY;
}

async function updateRoute() {
    const parsedInput = parseSearchInput(query.value);
    const failure = await router.replace({
        path: '/search',
        query: {
            q: query.value || undefined,
            category: category.value || undefined,
            authorId: parsedInput.authorId || undefined,
            page: page.value > 1 ? page.value : undefined
        }
    });
    // An unchanged route does not fire the query watcher, so load directly (e.g. re-search).
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
        void loadSearch();
    }
}

function clearResults() {
    hits.value = [];
    total.value = 0;
    processingTimeMs.value = 0;
}

async function loadSearch() {
    const id = ++requestId;
    loading.value = true;
    error.value = null;
    try {
        const parsedInput = parseSearchInput(query.value);
        const response = await searchArticles({
            q: parsedInput.q,
            category: category.value,
            authorId: parsedInput.authorId,
            page: page.value,
            limit
        });
        if (id !== requestId) return;

        if (response.code !== 200) {
            clearResults();
            error.value = '搜索失败，请稍后重试。';
            return;
        }

        hits.value = response.data.hits;
        total.value = response.data.total;
        processingTimeMs.value = response.data.processingTimeMs;
    } catch (failure) {
        if (id !== requestId) return;
        clearResults();
        error.value = requestErrorMessage(failure, '搜索失败，请稍后重试。');
    } finally {
        if (id === requestId) loading.value = false;
    }
}

function handleSearch() {
    page.value = 1;
    void updateRoute();
}

watch(
    () => route.query,
    value => {
        // The watcher can fire while navigating away (e.g. to an article) before unmount.
        if (route.name !== 'search') return;
        query.value = getRouteSearchInput(value.q, value.authorId);
        category.value = parseRouteNumber(value.category);
        page.value = Number(value.page) || 1;
        void loadSearch();
    }
);

onMounted(loadSearch);
onUnmounted(() => {
    requestId++;
});
</script>

<template>
    <div class="search-page">
        <CardTitle title="搜索" :icon="Search" class="search-header">
            按关键词、作者或分类检索本站已归档的洛谷文章。
        </CardTitle>

        <Card class="search-controls">
            <n-grid :x-gap="12" :y-gap="12" cols="1 m:4" responsive="screen">
                <n-gi span="1 m:2">
                    <n-input
                        v-model:value="query"
                        clearable
                        placeholder="输入关键词、作者名，或 uid:123456 搜索作者 UID"
                        @keydown.enter="handleSearch"
                    >
                        <template #prefix>
                            <n-icon :component="Search" />
                        </template>
                    </n-input>
                </n-gi>
                <n-gi>
                    <n-select
                        v-model:value="category"
                        :options="categoryOptions"
                        clearable
                        placeholder="全部分类"
                    />
                </n-gi>
                <n-gi>
                    <n-button type="primary" block @click="handleSearch">搜索</n-button>
                </n-gi>
            </n-grid>
        </Card>

        <n-alert v-if="error" type="error" class="search-error">
            {{ error }}
            <div class="search-error-actions">
                <n-button :disabled="loading" @click="loadSearch">重试</n-button>
            </div>
        </n-alert>

        <div v-else-if="hits.length || !loading" class="result-meta">
            <span>共 {{ total }} 条结果</span>
            <span>耗时 {{ processingTimeMs }} ms</span>
        </div>

        <n-spin
            :show="loading"
            class="result-spin"
            :class="{ 'is-initial-loading': loading && !hits.length }"
            aria-label="正在搜索"
        >
            <div v-if="hits.length" class="result-grid">
                <Card
                    v-for="item in hits"
                    :key="item.id"
                    :title-html="renderSafeMarkedHtml(item.formatted?.title, item.title)"
                    :icon="Newspaper"
                    :to="`/article/${item.id}`"
                    class="result-card"
                    hoverable
                >
                    <div class="result-body">
                        <p
                            class="summary"
                            v-html="
                                renderSafeMarkedHtml(
                                    item.formatted?.summary,
                                    item.summary || '暂无摘要'
                                )
                            "
                        ></p>
                    </div>
                    <n-space align="center" justify="space-between" class="result-footer">
                        <n-space size="small" align="center">
                            <span class="meta-item">
                                <n-icon :component="User" />
                                <span
                                    v-html="
                                        renderSafeMarkedHtml(
                                            item.formatted?.authorName,
                                            item.authorName || '-'
                                        )
                                    "
                                />
                            </span>
                            <n-tag
                                class="article-color-tag"
                                size="small"
                                :style="getCategoryTagStyle(item.category)"
                            >
                                <template #icon>
                                    <n-icon :component="getCategory(item.category).icon" />
                                </template>
                                {{ getCategory(item.category).label }}
                            </n-tag>
                        </n-space>
                        <span class="meta-item">
                            <n-icon :component="CalendarDays" />
                            {{ formatDate(item.updatedAt) }}
                        </span>
                    </n-space>
                </Card>
            </div>
            <n-empty v-else-if="!loading && !error" description="没有搜索结果" />
        </n-spin>

        <div v-if="!error && total > limit" class="pagination">
            <n-pagination
                v-model:page="page"
                :page-size="limit"
                :item-count="total"
                @update:page="updateRoute"
            />
        </div>
    </div>
</template>

<style scoped>
.search-page {
    max-width: 1220px;
    margin: 0 auto;
}

.search-header,
.search-controls,
.search-error {
    margin-bottom: var(--ui-section-gap);
}

.search-error-actions {
    margin-top: var(--ui-space-3);
}

.result-meta {
    display: flex;
    justify-content: space-between;
    margin: var(--ui-space-1) var(--ui-space-1) var(--ui-space-4);
    color: var(--ui-muted-text-color);
}

.result-spin.is-initial-loading {
    min-height: 160px;
}

.result-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

/* Stretch the title link over the card so the whole card stays clickable. */
.result-card {
    position: relative;
    cursor: pointer;
}

.result-card :deep(.card-title-link)::after {
    content: '';
    position: absolute;
    inset: 0;
}

.result-card :deep(.saver-card) {
    height: 100%;
}

.result-card :deep(.card-content) {
    display: flex;
    flex-direction: column;
}

.result-body {
    flex: 1;
}

.summary {
    min-height: 54px;
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    line-height: 1.65;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.result-footer {
    color: var(--ui-muted-text-color);
}

.meta-item {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
}

.pagination {
    display: flex;
    justify-content: center;
    margin-top: var(--ui-space-5);
}

@media (max-width: 900px) {
    .result-grid {
        grid-template-columns: 1fr;
    }
}
</style>
