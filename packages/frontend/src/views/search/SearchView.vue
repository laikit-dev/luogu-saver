<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router';
import { isCancel } from 'axios';
import {
    NAlert,
    NButton,
    NDatePicker,
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NPagination,
    NSelect,
    NSpace,
    NSpin,
    NTag,
    NTooltip
} from 'naive-ui';
import {
    ArrowUpDown,
    CalendarDays,
    Eye,
    Filter,
    Hash,
    Newspaper,
    Plus,
    Quote,
    RotateCcw,
    Search,
    SlidersHorizontal,
    User
} from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import Card from '@/components/Card.vue';
import MarkedText from '@/components/MarkedText.vue';
import SearchResultAuthor from './SearchResultAuthor.vue';
import { searchArticles, type ArticleSearchHit, type ArticleSearchSort } from '@/api/search.ts';
import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants.ts';
import { formatDate } from '@/utils/render.ts';
import { getCategoryTagStyle } from '@/utils/article.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import {
    composeSearchQuery,
    DEFAULT_SEARCH_LIMIT,
    extractInlineAuthorUid,
    normalizeSearchLimit,
    parseCategoryListQuery,
    parseExactPhrasesQuery,
    parseNonNegativeInt,
    parsePositiveInt,
    parseSearchSort,
    parseTagsQuery,
    sanitizeExactPhrase,
    SEARCH_PAGE_SIZE_OPTIONS,
    SEARCH_SORT_OPTIONS
} from './searchFilters.ts';

const route = useRoute();
const router = useRouter();

const query = ref('');
const categories = ref<number[]>([]);
const authorId = ref<number | null>(null);
const tags = ref<string[]>([]);
const tagDraft = ref('');
const exactPhrases = ref<string[]>([]);
const exactPhraseDraft = ref('');
const updatedRange = ref<[number, number] | null>(null);
const minViews = ref<number | null>(null);
const sort = ref<ArticleSearchSort>('relevance');
const limit = ref<number>(DEFAULT_SEARCH_LIMIT);
const page = ref(1);
const showAdvanced = ref(false);

function syncStateFromRoute(routeQuery: typeof route.query) {
    const rawQ = Array.isArray(routeQuery.q) ? routeQuery.q[0] : routeQuery.q;
    const extracted = extractInlineAuthorUid(typeof rawQ === 'string' ? rawQ : '');
    const explicitAuthorId = parsePositiveInt(routeQuery.authorId);

    query.value = extracted.text;
    authorId.value = explicitAuthorId ?? extracted.authorId;
    categories.value = parseCategoryListQuery(routeQuery.category);
    tags.value = parseTagsQuery(routeQuery.tags);
    exactPhrases.value = parseExactPhrasesQuery(routeQuery.exact);

    const after = parseNonNegativeInt(routeQuery.updatedAfter);
    const before = parseNonNegativeInt(routeQuery.updatedBefore);
    updatedRange.value = after !== null && before !== null ? [after, before] : null;

    minViews.value = parseNonNegativeInt(routeQuery.minViews);
    sort.value = parseSearchSort(routeQuery.sort);
    limit.value = normalizeSearchLimit(routeQuery.limit);
    page.value = parsePositiveInt(routeQuery.page) ?? 1;

    if (updatedRange.value !== null || minViews.value !== null || exactPhrases.value.length > 0) {
        showAdvanced.value = true;
    }
}

syncStateFromRoute(route.query);

const loading = ref(false);
const error = ref<string | null>(null);
const hits = ref<ArticleSearchHit[]>([]);
const total = ref(0);
const processingTimeMs = ref(0);
let requestId = 0;

const categoryOptions = computed(() =>
    Object.entries(ARTICLE_CATEGORIES)
        .filter(([key]) => Number(key) !== 9)
        .map(([key, item]) => ({ label: item.label, value: Number(key) }))
);

const sortOptions = [...SEARCH_SORT_OPTIONS];
const pageSizeOptions = SEARCH_PAGE_SIZE_OPTIONS.map(size => ({
    label: `${size} 条/页`,
    value: size
}));

const dateRangeShortcuts = {
    近7天: () => {
        const end = Date.now();
        return [end - 7 * 24 * 60 * 60 * 1000, end] as [number, number];
    },
    近30天: () => {
        const end = Date.now();
        return [end - 30 * 24 * 60 * 60 * 1000, end] as [number, number];
    },
    近1年: () => {
        const end = Date.now();
        return [end - 365 * 24 * 60 * 60 * 1000, end] as [number, number];
    }
};

const advancedFilterCount = computed(() => {
    let count = exactPhrases.value.length;
    if (updatedRange.value !== null) count += 1;
    if (minViews.value !== null) count += 1;
    return count;
});

const activeFilterCount = computed(() => {
    let count = categories.value.length + tags.value.length + advancedFilterCount.value;
    if (authorId.value !== null) count += 1;
    return count;
});

const hasAnyCriteria = computed(
    () =>
        Boolean(query.value.trim()) ||
        activeFilterCount.value > 0 ||
        sort.value !== 'relevance' ||
        limit.value !== DEFAULT_SEARCH_LIMIT
);

function getCategory(categoryId: number) {
    return ARTICLE_CATEGORIES[categoryId] || UNKNOWN_CATEGORY;
}

function formatDateDay(ts: number) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
}

function normalizeInlineInputs() {
    const extracted = extractInlineAuthorUid(query.value);
    if (extracted.authorId !== null) {
        authorId.value = extracted.authorId;
        query.value = extracted.text;
    }

    const pendingTag = tagDraft.value.trim();
    if (pendingTag && !tags.value.includes(pendingTag) && tags.value.length < 10) {
        tags.value = [...tags.value, pendingTag];
    }
    tagDraft.value = '';

    const pendingPhrase = sanitizeExactPhrase(exactPhraseDraft.value);
    if (pendingPhrase && !exactPhrases.value.includes(pendingPhrase)) {
        exactPhrases.value = [...exactPhrases.value, pendingPhrase];
    }
    exactPhraseDraft.value = '';
}

function getNormalizedDateRange(): { after: number | null; before: number | null } {
    if (!updatedRange.value) return { after: null, before: null };
    const [startRaw, endRaw] = updatedRange.value;
    const start = Math.min(startRaw, endRaw);
    const endDate = new Date(Math.max(startRaw, endRaw));
    endDate.setHours(23, 59, 59, 999);
    return { after: Math.trunc(start), before: endDate.getTime() };
}

async function updateRoute() {
    normalizeInlineInputs();
    const trimmedQuery = query.value.trim();
    const { after, before } = getNormalizedDateRange();
    const failure = await router.replace({
        path: '/search',
        query: {
            q: trimmedQuery || undefined,
            category: categories.value.length ? categories.value.join(',') : undefined,
            authorId: authorId.value !== null ? String(authorId.value) : undefined,
            tags: tags.value.length ? tags.value.join(',') : undefined,
            exact: exactPhrases.value.length ? exactPhrases.value : undefined,
            updatedAfter: after !== null ? String(after) : undefined,
            updatedBefore: before !== null ? String(before) : undefined,
            minViews: minViews.value !== null ? String(minViews.value) : undefined,
            sort: sort.value !== 'relevance' ? sort.value : undefined,
            limit: limit.value !== DEFAULT_SEARCH_LIMIT ? String(limit.value) : undefined,
            page: page.value > 1 ? String(page.value) : undefined
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

let activeController: AbortController | null = null;

async function loadSearch() {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const id = ++requestId;
    loading.value = true;
    error.value = null;
    try {
        const composedQ = composeSearchQuery(query.value, exactPhrases.value);
        const { after, before } = getNormalizedDateRange();
        const response = await searchArticles(
            {
                q: composedQ,
                category: categories.value.length ? categories.value : null,
                authorId: authorId.value,
                tags: tags.value,
                updatedAfter: after,
                updatedBefore: before,
                minViews: minViews.value,
                sort: sort.value,
                page: page.value,
                limit: limit.value
            },
            controller.signal
        );
        if (id !== requestId) return;

        if (response.code !== 200) {
            clearResults();
            error.value = response.message || '搜索失败';
            return;
        }

        hits.value = response.data.hits;
        total.value = response.data.total;
        processingTimeMs.value = response.data.processingTimeMs;
    } catch (failure) {
        if (id !== requestId || isCancel(failure)) return;
        clearResults();
        error.value = requestErrorMessage(failure, '搜索失败');
    } finally {
        if (id === requestId) loading.value = false;
    }
}

function handleSearch() {
    page.value = 1;
    void updateRoute();
}

function handleAddTag() {
    const cleaned = tagDraft.value.trim();
    tagDraft.value = '';
    if (!cleaned || tags.value.includes(cleaned) || tags.value.length >= 10) return;
    tags.value = [...tags.value, cleaned];
    handleSearch();
}

function removeTag(tag: string) {
    tags.value = tags.value.filter(item => item !== tag);
    handleSearch();
}

function handleAddExactPhrase() {
    const cleaned = sanitizeExactPhrase(exactPhraseDraft.value);
    exactPhraseDraft.value = '';
    if (!cleaned || exactPhrases.value.includes(cleaned)) return;
    exactPhrases.value = [...exactPhrases.value, cleaned];
    handleSearch();
}

function removeExactPhrase(phrase: string) {
    exactPhrases.value = exactPhrases.value.filter(item => item !== phrase);
    handleSearch();
}

function removeCategory(categoryId: number) {
    categories.value = categories.value.filter(item => item !== categoryId);
    handleSearch();
}

function applyCategoryFilter(categoryId: number) {
    if (!categories.value.includes(categoryId)) {
        categories.value = [...categories.value, categoryId];
    }
    handleSearch();
}

function applyAuthorFilter(uid: number) {
    if (!Number.isInteger(uid) || uid <= 0) return;
    authorId.value = uid;
    handleSearch();
}

function applyTagFilter(tag: string) {
    const cleaned = tag.trim();
    if (!cleaned || tags.value.includes(cleaned) || tags.value.length >= 10) return;
    tags.value = [...tags.value, cleaned];
    handleSearch();
}

function clearFiltersOnly() {
    categories.value = [];
    authorId.value = null;
    tags.value = [];
    tagDraft.value = '';
    exactPhrases.value = [];
    exactPhraseDraft.value = '';
    updatedRange.value = null;
    minViews.value = null;
    handleSearch();
}

function resetAll() {
    query.value = '';
    categories.value = [];
    authorId.value = null;
    tags.value = [];
    tagDraft.value = '';
    exactPhrases.value = [];
    exactPhraseDraft.value = '';
    updatedRange.value = null;
    minViews.value = null;
    sort.value = 'relevance';
    limit.value = DEFAULT_SEARCH_LIMIT;
    page.value = 1;
    void updateRoute();
}

watch(
    () => route.query,
    value => {
        // The watcher can fire while navigating away (e.g. to an article) before unmount.
        if (route.name !== 'search') return;
        syncStateFromRoute(value);
        void loadSearch();
    }
);

onMounted(loadSearch);
onUnmounted(() => {
    activeController?.abort();
    requestId++;
});
</script>

<template>
    <div class="search-page">
        <CardTitle title="搜索" :icon="Search" class="search-header" />

        <Card class="search-controls">
            <div class="search-main-row">
                <n-input
                    v-model:value="query"
                    class="search-keyword-input"
                    clearable
                    aria-label="搜索关键词"
                    placeholder="搜索标题、摘要、正文、作者名或标签（支持 uid:123456）"
                    @keydown.enter="handleSearch"
                    @clear="handleSearch"
                >
                    <template #prefix>
                        <n-icon :component="Search" />
                    </template>
                </n-input>
                <n-button
                    secondary
                    :type="showAdvanced || advancedFilterCount > 0 ? 'primary' : 'default'"
                    class="advanced-toggle-btn"
                    :aria-expanded="showAdvanced"
                    @click="showAdvanced = !showAdvanced"
                >
                    <template #icon>
                        <n-icon :component="SlidersHorizontal" />
                    </template>
                    更多筛选{{ advancedFilterCount > 0 ? ` (${advancedFilterCount})` : '' }}
                </n-button>
                <n-button type="primary" class="search-submit-btn" @click="handleSearch">
                    <template #icon>
                        <n-icon :component="Search" />
                    </template>
                    搜索
                </n-button>
            </div>

            <div class="filter-bar" role="region" aria-label="快捷筛选">
                <div class="filter-field filter-category">
                    <n-select
                        v-model:value="categories"
                        multiple
                        max-tag-count="responsive"
                        :options="categoryOptions"
                        clearable
                        placeholder="全部分类（可多选）"
                        :input-props="{ 'aria-label': '按文章分类筛选' }"
                        @update:value="handleSearch"
                    />
                </div>

                <div class="filter-field filter-author">
                    <n-input-number
                        v-model:value="authorId"
                        :min="1"
                        :precision="0"
                        :show-button="false"
                        clearable
                        placeholder="作者 UID"
                        :input-props="{ 'aria-label': '按作者 UID 筛选' }"
                        @keydown.enter="handleSearch"
                        @clear="handleSearch"
                    >
                        <template #prefix>
                            <n-icon :component="User" />
                        </template>
                    </n-input-number>
                </div>

                <div class="filter-field filter-tag">
                    <n-input
                        v-model:value="tagDraft"
                        clearable
                        placeholder="添加文章标签（回车加入）"
                        aria-label="添加文章标签筛选"
                        @keydown.enter.prevent="handleAddTag"
                    >
                        <template #prefix>
                            <n-icon :component="Hash" />
                        </template>
                        <template #suffix>
                            <n-button
                                text
                                size="tiny"
                                type="primary"
                                :disabled="!tagDraft.trim() || tags.length >= 10"
                                aria-label="添加标签筛选"
                                @click="handleAddTag"
                            >
                                <template #icon>
                                    <n-icon :component="Plus" />
                                </template>
                                添加
                            </n-button>
                        </template>
                    </n-input>
                </div>

                <div class="filter-bar-tail">
                    <n-select
                        v-model:value="sort"
                        class="sort-select"
                        :options="sortOptions"
                        :input-props="{ 'aria-label': '结果排序方式' }"
                        @update:value="handleSearch"
                    >
                        <template #arrow>
                            <n-icon :component="ArrowUpDown" :size="14" />
                        </template>
                    </n-select>
                    <n-select
                        v-model:value="limit"
                        class="limit-select"
                        :options="pageSizeOptions"
                        :input-props="{ 'aria-label': '每页结果条数' }"
                        @update:value="handleSearch"
                    />
                    <n-button
                        v-if="hasAnyCriteria"
                        secondary
                        aria-label="重置全部搜索条件"
                        @click="resetAll"
                    >
                        <template #icon>
                            <n-icon :component="RotateCcw" />
                        </template>
                        重置
                    </n-button>
                </div>
            </div>

            <div v-if="showAdvanced" class="advanced-panel" role="region" aria-label="高级筛选条件">
                <div class="advanced-field advanced-date">
                    <label class="advanced-label">更新时间</label>
                    <n-date-picker
                        v-model:value="updatedRange"
                        type="daterange"
                        clearable
                        :shortcuts="dateRangeShortcuts"
                        @update:value="handleSearch"
                    />
                </div>

                <div class="advanced-field advanced-views">
                    <label class="advanced-label" for="search-min-views">最低阅读量</label>
                    <n-input-number
                        id="search-min-views"
                        v-model:value="minViews"
                        :min="0"
                        :step="50"
                        :precision="0"
                        clearable
                        placeholder="不限"
                        @keydown.enter="handleSearch"
                        @clear="handleSearch"
                    >
                        <template #prefix>
                            <n-icon :component="Eye" />
                        </template>
                    </n-input-number>
                </div>

                <div class="advanced-field advanced-phrase">
                    <label class="advanced-label" for="search-exact-phrase">精确匹配短语</label>
                    <n-input
                        id="search-exact-phrase"
                        v-model:value="exactPhraseDraft"
                        clearable
                        placeholder="必须完整出现的词组（回车加入）"
                        @keydown.enter.prevent="handleAddExactPhrase"
                    >
                        <template #prefix>
                            <n-icon :component="Quote" />
                        </template>
                        <template #suffix>
                            <n-button
                                text
                                size="tiny"
                                type="primary"
                                :disabled="!exactPhraseDraft.trim()"
                                aria-label="添加精确短语"
                                @click="handleAddExactPhrase"
                            >
                                <template #icon>
                                    <n-icon :component="Plus" />
                                </template>
                                添加
                            </n-button>
                        </template>
                    </n-input>
                </div>
            </div>

            <div v-if="activeFilterCount > 0" class="active-filters" aria-label="已生效筛选">
                <span class="active-filters-label">
                    <n-icon :component="Filter" :size="14" />
                    <span>已筛选 ({{ activeFilterCount }})</span>
                </span>

                <n-tag
                    v-for="catId in categories"
                    :key="`cat-${catId}`"
                    closable
                    size="small"
                    class="article-color-tag"
                    :style="getCategoryTagStyle(catId)"
                    @close="removeCategory(catId)"
                >
                    分类：{{ getCategory(catId).label }}
                </n-tag>

                <n-tag
                    v-if="authorId !== null"
                    closable
                    size="small"
                    type="primary"
                    @close="
                        authorId = null;
                        handleSearch();
                    "
                >
                    作者 UID：{{ authorId }}
                </n-tag>

                <n-tag
                    v-for="tag in tags"
                    :key="`tag-${tag}`"
                    closable
                    size="small"
                    type="success"
                    @close="removeTag(tag)"
                >
                    标签：#{{ tag }}
                </n-tag>

                <n-tag
                    v-if="updatedRange !== null"
                    closable
                    size="small"
                    type="warning"
                    @close="
                        updatedRange = null;
                        handleSearch();
                    "
                >
                    时间：{{ formatDateDay(updatedRange[0]) }} ～
                    {{ formatDateDay(updatedRange[1]) }}
                </n-tag>

                <n-tag
                    v-if="minViews !== null"
                    closable
                    size="small"
                    type="info"
                    @close="
                        minViews = null;
                        handleSearch();
                    "
                >
                    阅读量 ≥ {{ minViews }}
                </n-tag>

                <n-tag
                    v-for="phrase in exactPhrases"
                    :key="`phrase-${phrase}`"
                    closable
                    size="small"
                    type="info"
                    @close="removeExactPhrase(phrase)"
                >
                    短语：“{{ phrase }}”
                </n-tag>

                <n-button text size="tiny" class="clear-filters-btn" @click="clearFiltersOnly">
                    清空筛选
                </n-button>
            </div>
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
                    :marked-title="item.formatted?.title || item.title"
                    :title="item.title"
                    :icon="Newspaper"
                    :to="`/article/${item.id}`"
                    class="result-card"
                    hoverable
                >
                    <div class="result-body">
                        <p class="summary">
                            <MarkedText
                                :text="item.formatted?.summary"
                                :fallback="item.summary || '暂无摘要'"
                            />
                        </p>
                        <div v-if="item.tags?.length" class="result-tags">
                            <button
                                v-for="tag in item.tags.slice(0, 4)"
                                :key="tag"
                                type="button"
                                class="result-tag-btn"
                                :title="`按标签 #${tag} 筛选`"
                                @click.stop="applyTagFilter(tag)"
                            >
                                <n-icon :component="Hash" :size="12" aria-hidden="true" />
                                <span>{{ tag }}</span>
                            </button>
                        </div>
                    </div>
                    <n-space align="center" justify="space-between" class="result-footer">
                        <n-space size="small" align="center" class="result-footer-left">
                            <span class="author-filter-group">
                                <SearchResultAuthor :hit="item" />
                                <n-tooltip v-if="item.authorId > 0" trigger="hover">
                                    <template #trigger>
                                        <button
                                            type="button"
                                            class="quick-filter-icon-btn"
                                            :aria-label="`只看 UID ${item.authorId} 的文章`"
                                            @click.stop="applyAuthorFilter(item.authorId)"
                                        >
                                            <n-icon :component="Filter" :size="13" />
                                        </button>
                                    </template>
                                    只看该作者（UID {{ item.authorId }}）
                                </n-tooltip>
                            </span>
                            <button
                                type="button"
                                class="category-filter-btn"
                                :title="`按「${getCategory(item.category).label}」分类筛选`"
                                @click.stop="applyCategoryFilter(item.category)"
                            >
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
                            </button>
                        </n-space>
                        <span class="result-stats">
                            <span v-if="item.viewCount > 0" class="meta-item">
                                <n-icon :component="Eye" />
                                {{ item.viewCount }}
                            </span>
                            <span class="meta-item">
                                <n-icon :component="CalendarDays" />
                                {{ formatDate(item.updatedAt) }}
                            </span>
                        </span>
                    </n-space>
                </Card>
            </div>
            <n-empty
                v-else-if="!loading && !error"
                class="search-empty"
                :description="activeFilterCount > 0 ? '当前筛选条件下没有匹配结果' : '没有搜索结果'"
            >
                <template v-if="activeFilterCount > 0" #extra>
                    <n-button secondary size="small" @click="clearFiltersOnly">
                        清空筛选条件
                    </n-button>
                </template>
            </n-empty>
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

.search-main-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
}

.search-keyword-input {
    flex: 1;
    min-width: 0;
}

.advanced-toggle-btn,
.search-submit-btn {
    flex-shrink: 0;
}

.search-submit-btn {
    min-width: 88px;
}

.filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-3);
}

.filter-field {
    min-width: 0;
}

.filter-category {
    min-width: 196px;
    flex: 0 1 230px;
}

.filter-author {
    width: 144px;
}

.filter-tag {
    flex: 1 1 200px;
    min-width: 180px;
}

.filter-bar-tail {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    margin-left: auto;
}

.sort-select {
    width: 118px;
}

.limit-select {
    width: 106px;
}

.advanced-panel {
    display: grid;
    grid-template-columns: minmax(240px, 1.25fr) minmax(150px, 0.7fr) minmax(220px, 1.15fr);
    gap: var(--ui-space-3);
    margin-top: var(--ui-space-3);
    padding: var(--ui-space-3) var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-table-header-color);
}

.advanced-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.advanced-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ui-muted-text-color);
}

.active-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-3);
    padding-top: var(--ui-space-3);
    border-top: 1px solid var(--ui-border-color);
}

.active-filters-label {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
    color: var(--ui-muted-text-color);
    font-size: 12px;
    font-weight: 500;
}

.clear-filters-btn {
    margin-left: var(--ui-space-1);
    color: var(--ui-muted-text-color);
}

.search-error-actions {
    margin-top: var(--ui-space-3);
}

.result-meta {
    display: flex;
    justify-content: space-between;
    margin: var(--ui-space-1) var(--ui-space-1) var(--ui-space-4);
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
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

.result-card :deep(.card-content) {
    display: flex;
    flex-direction: column;
}

.result-body {
    flex: 1;
}

.summary {
    min-height: 54px;
    margin: 0 0 var(--ui-space-3);
    color: var(--ui-secondary-text-color);
    line-height: 1.65;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.result-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: var(--ui-space-3);
}

.result-tag-btn {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-tag-radius);
    background: var(--ui-table-header-color);
    color: var(--ui-secondary-text-color);
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    transition:
        border-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease);
}

.result-tag-btn:hover {
    border-color: var(--ui-primary-color);
    color: var(--ui-primary-color);
}

.result-footer {
    color: var(--ui-muted-text-color);
}

.result-footer :deep(.user-link-container),
.quick-filter-icon-btn,
.category-filter-btn {
    position: relative;
    z-index: 1;
}

.author-filter-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.quick-filter-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-muted-text-color);
    cursor: pointer;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease);
}

.quick-filter-icon-btn:hover {
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
}

.category-filter-btn {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
}

.result-stats {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-3);
    font-variant-numeric: tabular-nums;
}

.meta-item {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
}

.search-empty {
    padding: var(--ui-space-8) 0;
}

.pagination {
    display: flex;
    justify-content: center;
    margin-top: var(--ui-space-5);
}

@media (max-width: 900px) {
    .advanced-panel {
        grid-template-columns: minmax(0, 1fr);
    }

    .result-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .search-main-row {
        flex-wrap: wrap;
    }

    .search-keyword-input {
        flex: 1 1 100%;
    }

    .advanced-toggle-btn,
    .search-submit-btn {
        flex: 1;
    }

    .filter-category,
    .filter-author,
    .filter-tag {
        width: 100%;
        flex-basis: 100%;
    }

    .filter-bar-tail {
        width: 100%;
        margin-left: 0;
        flex-wrap: wrap;
    }

    .sort-select,
    .limit-select {
        flex: 1;
    }
}
</style>
