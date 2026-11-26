<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { NSpin, NDivider, NButton, NIcon, NEmpty, NTag, NAlert, NTooltip } from 'naive-ui';
import {
    Newspaper,
    ArrowRight,
    Sparkles,
    Globe2,
    Flame,
    CalendarDays,
    ChevronRight
} from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import {
    getInterestProfile,
    getRecommendations,
    type InterestProfileSummary,
    type PersonaTagTone
} from '@/api/recommendation';
import type { PlazaArticle } from '@/types/article';

import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import UserLink from '@/components/UserLink.vue';
import InterestProfileDrawer from './InterestProfileDrawer.vue';
import {
    getCategoryIcon,
    getCategoryLabel,
    getCategoryTagStyle,
    getTagStyle
} from '@/utils/article.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { trackingAllowed } from '@/utils/tracking-consent.ts';

const MAX_EXCLUDED_ARTICLES = 200;
const PERSONA_TONE_COLORS: Record<PersonaTagTone, string> = {
    primary: 'var(--ui-primary-color)',
    info: 'var(--ui-cyan-color)',
    success: 'var(--ui-success-color)',
    warning: 'var(--ui-orange-color)',
    purple: 'var(--ui-category-study-color)'
};

const articles = ref<PlazaArticle[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const noMore = ref(false);
let requestId = 0;

const profileDrawerOpen = ref(false);
const profileLoading = ref(false);
const profileError = ref<string | null>(null);
const profile = ref<InterestProfileSummary | null>(null);
let profileRequestId = 0;

const hasProfilePreview = computed(
    () =>
        trackingAllowed.value &&
        profile.value !== null &&
        profile.value.viewedCount > 0 &&
        (profile.value.personaTags.length > 0 || profile.value.topicTags.length > 0)
);
const loadTrigger = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const connectObserver = () => {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
        entries => {
            // A failed load waits for the retry button instead of re-firing on every scroll.
            if (entries[0]?.isIntersecting && !loading.value && !error.value) {
                loadMore();
            }
        },
        {
            rootMargin: '200px',
            threshold: 0.1
        }
    );
    if (loadTrigger.value) {
        observer.observe(loadTrigger.value);
    }
};

const loadMore = async () => {
    if (loading.value || noMore.value) return;

    const id = ++requestId;
    loading.value = true;
    error.value = null;

    try {
        const excludedArticleIds = articles.value
            .slice(-MAX_EXCLUDED_ARTICLES)
            .map(article => article.id);
        const response = await getRecommendations(excludedArticleIds);
        if (id !== requestId) return;
        if (response.code !== 200) {
            error.value = response.message || '推荐文章加载失败';
            return;
        }

        const newArticles = response.data || [];
        const existingIds = new Set(articles.value.map(a => a.id));
        const uniqueArticles = newArticles.filter(a => !existingIds.has(a.id));
        if (uniqueArticles.length > 0) {
            articles.value.push(...uniqueArticles);
        } else {
            noMore.value = true;
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }
    } catch (failure) {
        if (id !== requestId) return;
        error.value = requestErrorMessage(failure, '推荐文章加载失败');
    } finally {
        if (id === requestId) loading.value = false;
    }
};

const fetchInterestProfile = async () => {
    if (!trackingAllowed.value) {
        profile.value = null;
        profileError.value = null;
        return;
    }
    const id = ++profileRequestId;
    profileLoading.value = true;
    profileError.value = null;
    try {
        const response = await getInterestProfile();
        if (id !== profileRequestId) return;
        if (response.code !== 200) {
            profileError.value = response.message || '兴趣画像加载失败';
            return;
        }
        profile.value = response.data;
    } catch (failure) {
        if (id !== profileRequestId) return;
        profileError.value = requestErrorMessage(failure, '兴趣画像加载失败');
    } finally {
        if (id === profileRequestId) profileLoading.value = false;
    }
};

const openProfileDrawer = () => {
    profileDrawerOpen.value = true;
    if (trackingAllowed.value && !profileLoading.value) {
        void fetchInterestProfile();
    }
};

const handleProfileCleared = () => {
    void fetchInterestProfile();
    resetAndReload();
};

const resetAndReload = () => {
    requestId++;
    loading.value = false;
    articles.value = [];
    error.value = null;
    noMore.value = false;
    connectObserver();
    void loadMore();
};

watch(trackingAllowed, () => {
    void fetchInterestProfile();
    resetAndReload();
});

onMounted(() => {
    connectObserver();
    void loadMore();
    void fetchInterestProfile();
});

onUnmounted(() => {
    requestId++;
    profileRequestId++;
    if (observer) observer.disconnect();
});
</script>

<template>
    <div class="plaza-page">
        <CardTitle title="文章广场" :icon="Globe2" class="feed-header">
            <template #extra>
                <n-button size="small" secondary @click="openProfileDrawer">
                    <template #icon>
                        <n-icon :component="Sparkles" />
                    </template>
                    我的兴趣画像
                </n-button>
            </template>
        </CardTitle>

        <Card v-if="hasProfilePreview && profile" class="profile-strip">
            <div class="profile-strip-body">
                <div class="profile-strip-tags">
                    <span class="profile-strip-label">
                        <n-icon :component="Sparkles" size="14" />
                        你的标签
                    </span>
                    <n-tooltip
                        v-for="tag in profile.personaTags.slice(0, 3)"
                        :key="tag.id"
                        :delay="150"
                    >
                        <template #trigger>
                            <n-tag
                                size="small"
                                round
                                :style="getTagStyle(PERSONA_TONE_COLORS[tag.tone])"
                            >
                                {{ tag.label }}
                            </n-tag>
                        </template>
                        {{ tag.description }}
                    </n-tooltip>
                    <RouterLink
                        v-for="topic in profile.topicTags.slice(0, 4)"
                        :key="topic.tag"
                        :to="{ path: '/search', query: { q: topic.tag } }"
                        class="strip-topic-link"
                    >
                        #{{ topic.tag }}
                    </RouterLink>
                </div>
                <n-button text size="small" type="primary" @click="openProfileDrawer">
                    完整画像
                    <n-icon :component="ChevronRight" size="14" />
                </n-button>
            </div>
        </Card>
        <div class="feed-shell">
            <div class="article-list">
                <div v-for="article in articles" :key="article.id" class="article-item">
                    <Card
                        :title="article.title"
                        :icon="Newspaper"
                        :to="`/article/${article.id}`"
                        class="clickable-card"
                    >
                        <template #title-extra>
                            <n-tag
                                v-if="article.reason === 'hot'"
                                class="article-color-tag"
                                :style="getTagStyle('var(--ui-orange-color)')"
                                size="small"
                            >
                                <template #icon>
                                    <n-icon :component="Flame" />
                                </template>
                                热门
                            </n-tag>
                            <n-tag
                                v-else-if="article.reason === 'vector'"
                                class="article-color-tag"
                                :style="getTagStyle('var(--ui-cyan-color)')"
                                size="small"
                            >
                                <template #icon>
                                    <n-icon :component="Sparkles" />
                                </template>
                                猜你想看
                            </n-tag>
                        </template>
                        <div class="article-card-body">
                            <div class="article-summary">
                                {{ article.summary ? `${article.summary}...` : '暂无预览' }}
                            </div>

                            <div class="article-meta-wrap">
                                <n-divider style="margin: var(--ui-space-3) 0" />

                                <div class="article-meta">
                                    <div class="left">
                                        <UserLink :user="article.author" show-avatar />
                                        <n-tag
                                            class="article-color-tag"
                                            :style="getCategoryTagStyle(article.category)"
                                            size="small"
                                        >
                                            <template #icon>
                                                <n-icon
                                                    :component="getCategoryIcon(article.category)"
                                                />
                                            </template>
                                            {{ getCategoryLabel(article.category) }}
                                        </n-tag>
                                        <span v-if="article.updatedAt" class="meta-item">
                                            <n-icon :component="CalendarDays" />
                                            {{ formatDate(article.updatedAt) }}
                                        </span>
                                    </div>
                                    <div class="right">
                                        <RouterLink
                                            v-slot="{ href, navigate }"
                                            :to="`/article/${article.id}`"
                                            custom
                                        >
                                            <n-button
                                                tag="a"
                                                text
                                                size="small"
                                                type="primary"
                                                class="read-more"
                                                :href="href"
                                                @click="navigate"
                                            >
                                                阅读全文
                                                <n-icon
                                                    :component="ArrowRight"
                                                    class="read-more-icon"
                                                />
                                            </n-button>
                                        </RouterLink>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>

        <div ref="loadTrigger" class="load-trigger">
            <div v-if="loading" class="loading-state" role="status">
                <n-spin size="small" />
                <span class="loading-text">正在加载更多推荐...</span>
            </div>

            <n-alert v-else-if="error" type="error" class="error-state">
                {{ error }}
                <div class="error-actions">
                    <n-button @click="loadMore">重试</n-button>
                </div>
            </n-alert>

            <n-empty v-else-if="noMore && articles.length" description="已经到底了" />
            <n-empty v-else-if="noMore" description="暂无推荐文章" />
        </div>

        <InterestProfileDrawer
            v-model:show="profileDrawerOpen"
            :loading="profileLoading"
            :error="profileError"
            :profile="profile"
            @refresh="fetchInterestProfile"
            @cleared="handleProfileCleared"
        />
    </div>
</template>

<style scoped>
.plaza-page {
    max-width: 1220px;
    margin: 0 auto;
}

.feed-header {
    margin-bottom: var(--ui-section-gap);
}

.profile-strip {
    margin-bottom: var(--ui-space-4);
}

.profile-strip-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    flex-wrap: wrap;
}

.profile-strip-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
    min-width: 0;
}

.profile-strip-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-secondary-text-color);
}

.strip-topic-link {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    text-decoration: none;
    padding: 2px 8px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-panel-color);
    transition: color var(--ui-motion-fast) var(--ui-motion-ease);
}

.strip-topic-link:hover {
    color: var(--ui-link-color);
}

.feed-shell {
    width: 100%;
}

.article-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
    align-items: stretch;
}

.article-item {
    min-width: 0;
    display: flex;
}

.article-item :deep(.saver-card) {
    width: 100%;
    min-width: 0;
}

.article-item :deep(.card-content) {
    display: flex;
    flex: 1;
    min-width: 0;
}

.article-item :deep(.card-header),
.article-item :deep(.card-title-wrapper) {
    min-width: 0;
}

.article-item :deep(.card-title) {
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: anywhere;
}

.article-card-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.article-meta-wrap {
    margin-top: auto;
}

/* Stretch the title link over the card; author and read-more links stay above it. */
.clickable-card {
    position: relative;
    cursor: pointer;
}

.clickable-card :deep(.card-title-link)::after {
    content: '';
    position: absolute;
    inset: 0;
}

.article-meta :deep(.user-link-container),
.read-more {
    position: relative;
    z-index: 1;
}

.read-more-icon {
    margin-left: var(--ui-space-1);
}

.article-summary {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    line-height: 1.65;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.article-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    gap: var(--ui-space-3);
}

.article-meta .left {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.meta-item {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
    color: var(--ui-muted-text-color);
}

.load-trigger {
    padding: var(--ui-space-5) 0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 50px;
}

.loading-state {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    color: var(--ui-muted-text-color);
}

.error-state {
    width: 100%;
}

.error-actions {
    margin-top: var(--ui-space-3);
}

@media (max-width: 900px) {
    .article-list {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 560px) {
    .article-meta {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
