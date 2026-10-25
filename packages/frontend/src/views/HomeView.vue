<script setup lang="ts">
import { inject, onMounted, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NEmpty, NIcon, NInput, NStatistic } from 'naive-ui';
import { ArrowRight, Clipboard, Megaphone, Newspaper, Search } from 'lucide-vue-next';
import { getArticleCount } from '@/api/article.ts';
import { getPasteCount } from '@/api/paste.ts';
import { getCurrentAnnouncement, type Announcement } from '@/api/announcement.ts';
import { getCurrentAdvertisements, type Advertisement } from '@/api/advertisement.ts';
import AdvertisementCarousel from '@/components/AdvertisementCarousel.vue';
import Card from '@/components/Card.vue';
import LuoguLogo from '@/components/icons/LuoguLogo.vue';
import ThemeEditor from '@/components/ThemeEditor.vue';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';
import type { ApiResponse } from '@/types/common';

// null = still loading or failed; the statistic shows a dash instead of a misleading zero.
const articleCount = ref<number | null>(null);
const pasteCount = ref<number | null>(null);
const announcement = ref<Announcement | null>(null);
const announcementState = ref<'loading' | 'ready' | 'failed'>('loading');
const advertisements = ref<Advertisement[]>([]);
const searchText = ref('');

const themeVars = inject(uiThemeKey)!;
const router = useRouter();

async function loadCount(
    request: () => Promise<ApiResponse<{ count: number }>>,
    target: Ref<number | null>
) {
    try {
        const response = await request();
        if (response.code === 200) target.value = response.data.count;
    } catch {
        // The dash placeholder already communicates the failure.
    }
}

async function loadAnnouncement() {
    try {
        const response = await getCurrentAnnouncement();
        if (response.code !== 200) {
            announcementState.value = 'failed';
            return;
        }
        announcement.value = response.data;
        announcementState.value = 'ready';
    } catch {
        announcementState.value = 'failed';
    }
}

async function loadAdvertisements() {
    try {
        const response = await getCurrentAdvertisements();
        if (response.code === 200) advertisements.value = response.data.advertisements;
    } catch {
        // Advertisements are optional; on failure the slot simply stays hidden.
    }
}

onMounted(() => {
    void loadCount(getArticleCount, articleCount);
    void loadCount(getPasteCount, pasteCount);
    void loadAnnouncement();
    void loadAdvertisements();
});

function parsePathLikeInput(input: string) {
    try {
        return new URL(input).pathname;
    } catch {
        if (/^(?:www\.)?luogu\.com(?:\.cn)?\//i.test(input)) {
            return new URL(`https://${input}`).pathname;
        }
        return input.startsWith('/') ? input : '';
    }
}

function handleSearch() {
    const query = searchText.value.trim();
    if (!query) return;

    const path = parsePathLikeInput(query);
    const articlePathMatch = path.match(/^\/article\/([A-Za-z0-9_-]+)\/?$/);
    if (articlePathMatch?.[1]) {
        void router.push(`/article/${articlePathMatch[1]}`);
        return;
    }

    const pastePathMatch = path.match(/^\/paste\/([A-Za-z0-9_-]+)\/?$/);
    if (pastePathMatch?.[1]) {
        void router.push(`/paste/${pastePathMatch[1]}`);
        return;
    }

    const userPathMatch = path.match(/^\/user\/(\d+)\/?$/);
    if (userPathMatch?.[1]) {
        void router.push(`/user/${userPathMatch[1]}`);
        return;
    }

    const explicitArticleMatch = query.match(/^article\s*[:：]\s*([A-Za-z0-9_-]+)$/i);
    if (explicitArticleMatch?.[1]) {
        void router.push(`/article/${explicitArticleMatch[1]}`);
        return;
    }

    const explicitPasteMatch = query.match(/^paste\s*[:：]\s*([A-Za-z0-9_-]+)$/i);
    if (explicitPasteMatch?.[1]) {
        void router.push(`/paste/${explicitPasteMatch[1]}`);
        return;
    }

    // Same author filter syntax as the search page, so `uid:123` means "articles by 123" everywhere.
    const authorFilterMatch = query.match(/(?:^|\s)(?:author|uid|作者)\s*[:：]\s*(\d+)(?=\s|$)/i);
    if (authorFilterMatch?.[1] && Number(authorFilterMatch[1]) > 0) {
        void router.push({
            path: '/search',
            query: { q: query, authorId: authorFilterMatch[1] }
        });
        return;
    }

    const explicitUserMatch = query.match(/^(?:user|用户)\s*[:：]\s*(\d+)$/i);
    if (explicitUserMatch?.[1]) {
        void router.push(`/user/${explicitUserMatch[1]}`);
        return;
    }

    if (/^[1-9]\d*$/.test(query)) {
        void router.push(`/user/${query}`);
        return;
    }

    if (/^[A-Za-z0-9]{8}$/.test(query)) {
        void router.push(`/article/${query}`);
        return;
    }

    void router.push({ path: '/search', query: { q: query } });
}
</script>

<template>
    <div class="home-container">
        <header class="search-stage">
            <div class="brand-lockup">
                <div class="home-brand">
                    <n-icon
                        class="brand-mark"
                        size="48"
                        :component="LuoguLogo"
                        :color="themeVars.primaryColor"
                    />
                    <h1>洛谷保存站</h1>
                </div>
                <p class="home-slogan">Save everything, keep it alive.</p>
            </div>

            <n-input
                v-model:value="searchText"
                class="home-search"
                size="large"
                round
                aria-label="搜索"
                placeholder="输入链接、文章 ID、关键词或用户名"
                @keydown.enter="handleSearch"
            >
                <template #prefix>
                    <n-icon :component="Search" />
                </template>
                <template #suffix>
                    <n-button
                        circle
                        type="primary"
                        size="small"
                        class="home-search-button"
                        aria-label="搜索"
                        @click="handleSearch"
                    >
                        <template #icon>
                            <n-icon :component="ArrowRight" />
                        </template>
                    </n-button>
                </template>
            </n-input>
        </header>

        <div class="home-information">
            <section class="announcement-section" aria-label="站点公告">
                <Card
                    :title="announcement?.title || '公告'"
                    class="announcement-card"
                    :class="{ 'is-empty': !announcement }"
                >
                    <template #header-extra>
                        <n-icon size="20" :component="Megaphone" :color="themeVars.primaryColor" />
                    </template>
                    <div
                        v-if="announcement"
                        class="announcement-content"
                        v-html="announcement.content"
                    ></div>
                    <p
                        v-else-if="announcementState === 'loading'"
                        class="announcement-status"
                        role="status"
                    >
                        正在加载公告...
                    </p>
                    <p
                        v-else-if="announcementState === 'failed'"
                        class="announcement-status is-error"
                        role="status"
                    >
                        公告加载失败，请稍后刷新页面重试。
                    </p>
                    <n-empty v-else description="暂无公告" size="small" />
                </Card>
            </section>

            <aside class="home-sidebar" aria-label="站点信息">
                <div class="stats-section" aria-label="站点内容统计">
                    <Card class="stat-card">
                        <div class="stat-item">
                            <span class="stat-icon-wrapper">
                                <n-icon
                                    size="22"
                                    :component="Newspaper"
                                    :color="themeVars.primaryColor"
                                />
                            </span>
                            <n-statistic label="文章总数" :value="articleCount ?? '—'" />
                        </div>
                    </Card>
                    <Card class="stat-card">
                        <div class="stat-item">
                            <span class="stat-icon-wrapper">
                                <n-icon
                                    size="22"
                                    :component="Clipboard"
                                    :color="themeVars.primaryColor"
                                />
                            </span>
                            <n-statistic label="剪贴板总数" :value="pasteCount ?? '—'" />
                        </div>
                    </Card>
                </div>
                <AdvertisementCarousel
                    v-if="advertisements.length"
                    :advertisements="advertisements"
                />
            </aside>
        </div>

        <ThemeEditor />
    </div>
</template>

<style scoped>
.home-container {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-10);
    width: 100%;
    max-width: 1120px;
    margin: 0 auto;
}

.search-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ui-space-6);
    padding: var(--ui-space-12) var(--ui-space-6) 0;
}

.home-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ui-space-5);
}

.brand-lockup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ui-space-2);
}

.home-slogan {
    margin: 0;
    color: var(--ui-muted-text-color);
    font-size: 15px;
    line-height: 1.5;
    letter-spacing: 0;
}

.brand-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    flex: 0 0 48px;
}

.brand-mark :deep(svg) {
    display: block;
    width: calc(100% - 2px);
    height: calc(100% - 2px);
    transform: translateY(-1px);
}

.home-brand h1 {
    margin: 0;
    color: var(--ui-card-title-color);
    font-size: 48px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0;
}

.home-search {
    width: min(100%, 720px);
    overflow: hidden;
    border-radius: var(--ui-pill-radius);
    background: transparent;
    box-shadow: var(--ui-card-shadow);
}

.home-search :deep(.n-input-wrapper) {
    min-height: 54px;
    padding-left: var(--ui-space-5);
    padding-right: var(--ui-space-4);
}

.home-search :deep(.n-input__input) {
    display: flex;
    align-items: center;
}

.home-search :deep(.n-input__input-el) {
    font-size: 16px;
}

.home-search-button {
    width: 28px;
    height: 28px;
}

.home-information {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.85fr);
    align-items: start;
    gap: var(--ui-section-gap);
}

.announcement-card {
    min-height: 248px;
}

.announcement-card.is-empty :deep(.card-content) {
    display: flex;
    align-items: center;
    justify-content: center;
}

.announcement-content {
    color: var(--ui-secondary-text-color);
    font-size: 16px;
    line-height: 1.75;
}

.announcement-status {
    margin: 0;
    color: var(--ui-muted-text-color);
    text-align: center;
}

.announcement-status.is-error {
    color: var(--ui-error-color);
}

.announcement-content :deep(a) {
    color: var(--ui-link-color);
    text-decoration: none;
}

.announcement-content :deep(a:hover) {
    color: var(--ui-link-hover-color);
}

.home-sidebar {
    display: grid;
    gap: var(--ui-space-4);
}

.stats-section {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.stat-card {
    min-width: 0;
}

.stat-card :deep(.card-content) {
    display: flex;
    align-items: center;
}

.stat-item {
    display: grid;
    justify-items: start;
    gap: var(--ui-space-3);
    width: 100%;
    min-height: 88px;
}

.stat-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.stat-card :deep(.n-statistic-value__content) {
    color: var(--ui-card-title-color);
    font-weight: 700;
}

@media (max-width: 768px) {
    .home-information {
        grid-template-columns: minmax(0, 1fr);
    }

    .search-stage {
        padding-top: var(--ui-space-8);
    }

    .announcement-card {
        min-height: 220px;
    }
}

@media (max-width: 480px) {
    .home-container {
        gap: var(--ui-space-8);
    }

    .search-stage {
        gap: var(--ui-space-5);
        padding: var(--ui-space-6) 0 0;
    }

    .home-brand {
        gap: var(--ui-space-3);
    }

    .brand-mark {
        width: 34px;
        height: 34px;
        flex-basis: 34px;
        font-size: 34px !important;
    }

    .brand-mark :deep(svg) {
        width: calc(100% - 1px);
        height: calc(100% - 1px);
        transform: translateY(-0.5px);
    }

    .home-brand h1 {
        font-size: 34px;
    }

    .home-slogan {
        font-size: 14px;
    }

    .home-search :deep(.n-input-wrapper) {
        min-height: 50px;
        padding-left: var(--ui-space-4);
    }

    .stats-section {
        gap: var(--ui-space-3);
    }

    .stat-item {
        min-height: 80px;
    }
}
</style>
