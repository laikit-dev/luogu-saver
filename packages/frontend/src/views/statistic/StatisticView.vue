<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NButtonGroup, NEmpty, NIcon, NSkeleton, NTag, NTooltip } from 'naive-ui';
import {
    Award,
    BookOpen,
    Calendar,
    ChartNoAxesColumnIncreasing,
    Clock,
    Database,
    Eye,
    Flame,
    Layers,
    Moon,
    RefreshCw,
    Server,
    Star,
    ThumbsUp,
    TrendingUp,
    Trophy,
    Users
} from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import UserLink from '@/components/UserLink.vue';
import QueueStatsSection from './QueueStatsSection.vue';
import { getSiteStatsOverview, type SiteStatsOverviewResponse } from '@/api/statistic.ts';
import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants.ts';
import { getCategoryTagStyle } from '@/utils/article.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';

type StatisticTab = 'overview' | 'queues';
type ArticleRankMode = 'upvote' | 'view';

const USER_COLOR_META: Record<string, { label: string; color: string; order: number }> = {
    Purple: { label: '紫名', color: 'var(--ui-user-purple-color)', order: 1 },
    Red: { label: '红名', color: 'var(--ui-user-red-color)', order: 2 },
    Orange: { label: '橙名', color: 'var(--ui-user-orange-color)', order: 3 },
    Green: { label: '绿名', color: 'var(--ui-user-green-color)', order: 4 },
    Blue: { label: '蓝名', color: 'var(--ui-user-blue-color)', order: 5 },
    Gray: { label: '灰名', color: 'var(--ui-user-gray-color)', order: 6 },
    Cheater: { label: '棕名', color: 'var(--ui-user-cheater-color)', order: 7 }
};

const route = useRoute();
const router = useRouter();

const activeTab = ref<StatisticTab>(route.query.tab === 'queues' ? 'queues' : 'overview');
const articleRankMode = ref<ArticleRankMode>('view');
const queueSectionRef = ref<InstanceType<typeof QueueStatsSection> | null>(null);

const loading = ref(false);
const error = ref<string | null>(null);
const overview = ref<SiteStatsOverviewResponse | null>(null);
let requestId = 0;

function formatNumber(value: number): string {
    return value.toLocaleString('zh-CN');
}

function formatCompact(value: number): string {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
    return value.toLocaleString('zh-CN');
}

function formatPercent(part: number, total: number): string {
    if (total <= 0) return '0.0%';
    return `${((part / total) * 100).toFixed(1)}%`;
}

function ccfLevelColor(level: number): string {
    if (level >= 8) return 'var(--ui-prize-gold-color)';
    if (level >= 6) return 'var(--ui-prize-blue-color)';
    return 'var(--ui-prize-green-color)';
}

function setTab(tab: StatisticTab) {
    if (activeTab.value === tab) return;
    activeTab.value = tab;
    router.replace({
        query:
            tab === 'queues'
                ? { ...route.query, tab: 'queues' }
                : { ...route.query, tab: undefined }
    });
}

async function fetchOverview() {
    const id = ++requestId;
    loading.value = true;
    error.value = null;
    try {
        const response = await getSiteStatsOverview();
        if (id !== requestId) return;
        if (response.code !== 200) {
            error.value = response.message || '站点统计数据加载失败';
            return;
        }
        overview.value = response.data;
    } catch (failure) {
        if (id !== requestId) return;
        error.value = requestErrorMessage(failure, '站点统计数据加载失败');
    } finally {
        if (id === requestId) loading.value = false;
    }
}

async function handleRefresh() {
    if (activeTab.value === 'queues') {
        await queueSectionRef.value?.refresh();
        return;
    }
    await fetchOverview();
}

const isRefreshing = computed(() =>
    activeTab.value === 'queues' ? Boolean(queueSectionRef.value?.loading) : loading.value
);

const hourlyStats = computed(() => {
    const points = overview.value?.publishHourDistribution ?? [];
    const total = overview.value?.summary.publishedTimeKnown ?? 0;
    let maxCount = 0;
    let peakHour: number | null = null;
    let nightCount = 0;

    for (const point of points) {
        if (point.count > maxCount) {
            maxCount = point.count;
            peakHour = point.hour;
        }
        if (point.hour === 23 || point.hour <= 4) {
            nightCount += point.count;
        }
    }

    return {
        points,
        total,
        maxCount,
        peakHour,
        nightCount,
        nightShare: formatPercent(nightCount, total)
    };
});

const yearlyStats = computed(() => {
    const points = overview.value?.publishYearDistribution ?? [];
    const total = points.reduce((sum, item) => sum + item.count, 0);
    const maxCount = points.reduce((max, item) => Math.max(max, item.count), 0);
    return { points, total, maxCount };
});

const dailyStats = computed(() => {
    const points = overview.value?.recentDailyArchives ?? [];
    const total = points.reduce((sum, item) => sum + item.count, 0);
    const maxCount = points.reduce((max, item) => Math.max(max, item.count), 0);
    const avg = points.length > 0 ? (total / points.length).toFixed(1) : '0.0';
    return {
        points,
        total,
        maxCount,
        avg,
        startLabel: points[0]?.date.slice(5) ?? '',
        midLabel: points[Math.floor(points.length / 2)]?.date.slice(5) ?? '',
        endLabel: points[points.length - 1]?.date.slice(5) ?? ''
    };
});

const categoryRows = computed(() => {
    const items = overview.value?.categories ?? [];
    const total = overview.value?.summary.articles ?? 0;
    const maxCount = items.reduce((max, item) => Math.max(max, item.count), 0);
    return items.map(item => {
        const meta = ARTICLE_CATEGORIES[item.category] || UNKNOWN_CATEGORY;
        return {
            ...item,
            label: meta.label,
            icon: meta.icon,
            color: meta.color,
            share: formatPercent(item.count, total),
            widthPercent: maxCount > 0 ? Math.max(2, (item.count / maxCount) * 100) : 0
        };
    });
});

const userColorRows = computed(() => {
    const items = overview.value?.userColors ?? [];
    const total = overview.value?.summary.users ?? 0;
    return items
        .map(item => {
            const meta = USER_COLOR_META[item.color] ?? {
                label: item.color,
                color: 'var(--ui-muted-accent-color)',
                order: 99
            };
            return {
                ...item,
                label: meta.label,
                swatch: meta.color,
                order: meta.order,
                share: formatPercent(item.count, total),
                widthPercent: total > 0 ? (item.count / total) * 100 : 0
            };
        })
        .sort((a, b) => a.order - b.order || b.count - a.count);
});

const ccfStats = computed(() => {
    const levels = overview.value?.ccfLevels ?? [];
    const totalCertified = levels.reduce((sum, item) => sum + item.count, 0);
    const maxCount = levels.reduce((max, item) => Math.max(max, item.count), 0);
    let green = 0;
    let blue = 0;
    let gold = 0;

    for (const item of levels) {
        if (item.level >= 8) gold += item.count;
        else if (item.level >= 6) blue += item.count;
        else green += item.count;
    }

    return {
        levels,
        totalCertified,
        maxCount,
        tiers: [
            { label: '绿钩 (1–5级)', count: green, color: 'var(--ui-prize-green-color)' },
            { label: '蓝钩 (6–7级)', count: blue, color: 'var(--ui-prize-blue-color)' },
            { label: '金钩 (8–10级)', count: gold, color: 'var(--ui-prize-gold-color)' }
        ]
    };
});

const topProblemMax = computed(() =>
    (overview.value?.topProblems ?? []).reduce((max, item) => Math.max(max, item.solutionCount), 0)
);

const rankedArticles = computed(() =>
    articleRankMode.value === 'upvote'
        ? (overview.value?.topArticlesByUpvote ?? [])
        : (overview.value?.topArticlesByView ?? [])
);

watch(
    () => route.query.tab,
    tab => {
        activeTab.value = tab === 'queues' ? 'queues' : 'overview';
    }
);

watch(activeTab, tab => {
    if (tab === 'overview' && !overview.value && !loading.value) {
        fetchOverview();
    }
});

onMounted(() => {
    if (activeTab.value === 'overview') {
        fetchOverview();
    }
});

onUnmounted(() => {
    requestId++;
});
</script>

<template>
    <div class="statistic-page">
        <CardTitle title="统计数据" :icon="ChartNoAxesColumnIncreasing">
            <template #extra>
                <div class="header-controls">
                    <n-button-group size="small" role="tablist" aria-label="统计视图切换">
                        <n-button
                            role="tab"
                            :type="activeTab === 'overview' ? 'primary' : 'default'"
                            :ghost="activeTab !== 'overview'"
                            :aria-selected="activeTab === 'overview'"
                            @click="setTab('overview')"
                        >
                            <template #icon>
                                <n-icon :component="ChartNoAxesColumnIncreasing" />
                            </template>
                            数据概览
                        </n-button>
                        <n-button
                            role="tab"
                            :type="activeTab === 'queues' ? 'primary' : 'default'"
                            :ghost="activeTab !== 'queues'"
                            :aria-selected="activeTab === 'queues'"
                            @click="setTab('queues')"
                        >
                            <template #icon>
                                <n-icon :component="Server" />
                            </template>
                            队列状态
                        </n-button>
                    </n-button-group>

                    <n-button size="small" secondary :loading="isRefreshing" @click="handleRefresh">
                        <template #icon>
                            <n-icon :component="RefreshCw" />
                        </template>
                        刷新
                    </n-button>
                </div>
            </template>
        </CardTitle>

        <Transition name="ui-fade" mode="out-in">
            <QueueStatsSection v-if="activeTab === 'queues'" key="queues" ref="queueSectionRef" />

            <div v-else key="overview" class="overview-tab-pane">
                <n-alert v-if="error" type="error" class="stat-alert">
                    {{ error }}
                    <div class="stat-alert-actions">
                        <n-button size="small" :disabled="loading" @click="fetchOverview"
                            >重试</n-button
                        >
                    </div>
                </n-alert>

                <div
                    v-if="loading && !overview"
                    class="skeleton-layout"
                    role="status"
                    aria-label="正在加载统计数据"
                >
                    <div class="kpi-grid">
                        <Card v-for="i in 4" :key="i">
                            <n-skeleton text :repeat="3" />
                        </Card>
                    </div>
                    <Card>
                        <n-skeleton height="200px" />
                    </Card>
                    <div class="two-col-grid">
                        <Card><n-skeleton height="180px" /></Card>
                        <Card><n-skeleton height="180px" /></Card>
                    </div>
                </div>

                <div v-else-if="overview" class="overview-stack">
                    <section class="kpi-grid" aria-label="归档核心指标">
                        <Card
                            title="已归档文章"
                            :icon="BookOpen"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 0 }"
                        >
                            <div class="kpi-body">
                                <div
                                    class="kpi-value"
                                    :title="formatNumber(overview.summary.articles)"
                                >
                                    {{ formatNumber(overview.summary.articles) }}
                                </div>
                                <div class="kpi-meta">
                                    <span>历史修订</span>
                                    <strong
                                        :title="formatNumber(overview.summary.articleRevisions)"
                                    >
                                        {{ formatNumber(overview.summary.articleRevisions) }}
                                    </strong>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="本站累计阅读"
                            :icon="Eye"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 1 }"
                        >
                            <div class="kpi-body">
                                <div
                                    class="kpi-value"
                                    :title="formatNumber(overview.summary.totalViews)"
                                >
                                    {{ formatCompact(overview.summary.totalViews) }}
                                </div>
                                <div class="kpi-meta">
                                    <span>近 30 日新增归档</span>
                                    <strong :title="formatNumber(dailyStats.total)">
                                        +{{ formatNumber(dailyStats.total) }}
                                    </strong>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="归档作者"
                            :icon="Users"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 2 }"
                        >
                            <div class="kpi-body">
                                <div
                                    class="kpi-value"
                                    :title="formatNumber(overview.summary.users)"
                                >
                                    {{ formatNumber(overview.summary.users) }}
                                </div>
                                <div class="kpi-meta">
                                    <span>CCF 认证</span>
                                    <strong :title="formatNumber(ccfStats.totalCertified)">
                                        {{ formatNumber(ccfStats.totalCertified) }}
                                    </strong>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="延伸存档"
                            :icon="Database"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 3 }"
                        >
                            <div class="kpi-mini-list">
                                <div class="kpi-mini-row">
                                    <span>剪贴板</span>
                                    <strong>{{ formatNumber(overview.summary.pastes) }}</strong>
                                </div>
                                <div class="kpi-mini-row">
                                    <span>文章评论</span>
                                    <strong>{{ formatNumber(overview.summary.comments) }}</strong>
                                </div>
                                <div class="kpi-mini-row">
                                    <span>陶片记录</span>
                                    <strong>{{ formatNumber(overview.summary.judgements) }}</strong>
                                </div>
                            </div>
                        </Card>
                    </section>

                    <Card
                        title="OIer 昼夜发文作息（北京时间）"
                        :icon="Clock"
                        class="ui-stagger-item"
                        :style="{ '--stagger-index': 4 }"
                    >
                        <template #header-extra>
                            <div v-if="hourlyStats.total > 0" class="chart-badges">
                                <n-tag
                                    v-if="hourlyStats.peakHour !== null"
                                    size="small"
                                    type="info"
                                >
                                    峰值 {{ String(hourlyStats.peakHour).padStart(2, '0') }}:00
                                </n-tag>
                                <n-tag size="small">
                                    <template #icon>
                                        <n-icon :component="Moon" />
                                    </template>
                                    深夜 23–05 点占 {{ hourlyStats.nightShare }}
                                </n-tag>
                            </div>
                        </template>

                        <n-empty
                            v-if="hourlyStats.total === 0"
                            description="暂无已记录原文发布时间的文章"
                        />
                        <div v-else class="bar-chart-wrap">
                            <div class="chart-legend">
                                <span class="legend-item">
                                    <i class="legend-dot is-day" />日间 05:00–22:59
                                </span>
                                <span class="legend-item">
                                    <i class="legend-dot is-night" />深夜 23:00–04:59
                                </span>
                            </div>
                            <div
                                class="bar-chart bar-chart-24"
                                role="img"
                                aria-label="24 小时发文分布柱状图"
                            >
                                <n-tooltip
                                    v-for="(point, index) in hourlyStats.points"
                                    :key="point.hour"
                                    :delay="80"
                                >
                                    <template #trigger>
                                        <div class="bar-col">
                                            <div class="bar-track">
                                                <div
                                                    class="bar-fill"
                                                    :class="{
                                                        'is-night':
                                                            point.hour === 23 || point.hour <= 4,
                                                        'is-peak':
                                                            point.hour === hourlyStats.peakHour &&
                                                            point.count > 0
                                                    }"
                                                    :style="{
                                                        height:
                                                            hourlyStats.maxCount > 0 &&
                                                            point.count > 0
                                                                ? `${Math.max(4, (point.count / hourlyStats.maxCount) * 100)}%`
                                                                : '0%',
                                                        '--bar-delay': `${Math.min(index * 8, 160)}ms`
                                                    }"
                                                />
                                            </div>
                                            <span class="bar-tick">
                                                {{
                                                    point.hour % 3 === 0
                                                        ? String(point.hour).padStart(2, '0')
                                                        : ''
                                                }}
                                            </span>
                                        </div>
                                    </template>
                                    {{ String(point.hour).padStart(2, '0') }}:00 –
                                    {{ String(point.hour).padStart(2, '0') }}:59 ·
                                    {{ formatNumber(point.count) }} 篇（{{
                                        formatPercent(point.count, hourlyStats.total)
                                    }}）
                                </n-tooltip>
                            </div>
                            <div class="chart-footnote">
                                基于 {{ formatNumber(hourlyStats.total) }} /
                                {{
                                    formatNumber(overview.summary.articles)
                                }}
                                篇已记录原文发布时间的文章
                            </div>
                        </div>
                    </Card>

                    <section class="two-col-grid" aria-label="时间维度统计">
                        <Card
                            title="原文创作年代分布"
                            :icon="Calendar"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 5 }"
                        >
                            <template #header-extra>
                                <span v-if="yearlyStats.points.length" class="header-metric">
                                    {{ yearlyStats.points[0]?.year }} –
                                    {{ yearlyStats.points[yearlyStats.points.length - 1]?.year }}
                                </span>
                            </template>

                            <n-empty
                                v-if="!yearlyStats.points.length"
                                description="暂无原文发布年份数据"
                            />
                            <div v-else class="bar-chart-wrap">
                                <div
                                    class="bar-chart bar-chart-year"
                                    :style="{
                                        gridTemplateColumns: `repeat(${yearlyStats.points.length}, minmax(0, 1fr))`
                                    }"
                                >
                                    <n-tooltip
                                        v-for="(point, index) in yearlyStats.points"
                                        :key="point.year"
                                        :delay="80"
                                    >
                                        <template #trigger>
                                            <div class="bar-col">
                                                <div class="bar-track">
                                                    <div
                                                        class="bar-fill is-year"
                                                        :style="{
                                                            height:
                                                                yearlyStats.maxCount > 0 &&
                                                                point.count > 0
                                                                    ? `${Math.max(4, (point.count / yearlyStats.maxCount) * 100)}%`
                                                                    : '0%',
                                                            '--bar-delay': `${Math.min(index * 12, 160)}ms`
                                                        }"
                                                    />
                                                </div>
                                                <span class="bar-tick">{{ point.year }}</span>
                                            </div>
                                        </template>
                                        {{ point.year }} 年 · {{ formatNumber(point.count) }} 篇（{{
                                            formatPercent(point.count, yearlyStats.total)
                                        }}）
                                    </n-tooltip>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="近 30 日新增归档"
                            :icon="TrendingUp"
                            class="ui-stagger-item"
                            :style="{ '--stagger-index': 6 }"
                        >
                            <template #header-extra>
                                <span class="header-metric">
                                    合计 +{{ formatNumber(dailyStats.total) }} · 日均
                                    {{ dailyStats.avg }}
                                </span>
                            </template>

                            <div class="bar-chart-wrap">
                                <div class="bar-chart bar-chart-30">
                                    <n-tooltip
                                        v-for="(point, index) in dailyStats.points"
                                        :key="point.date"
                                        :delay="80"
                                    >
                                        <template #trigger>
                                            <div class="bar-col">
                                                <div class="bar-track">
                                                    <div
                                                        class="bar-fill is-daily"
                                                        :style="{
                                                            height:
                                                                dailyStats.maxCount > 0 &&
                                                                point.count > 0
                                                                    ? `${Math.max(4, (point.count / dailyStats.maxCount) * 100)}%`
                                                                    : '0%',
                                                            '--bar-delay': `${Math.min(index * 6, 160)}ms`
                                                        }"
                                                    />
                                                </div>
                                            </div>
                                        </template>
                                        {{ point.date }} · 新增 {{ formatNumber(point.count) }} 篇
                                    </n-tooltip>
                                </div>
                                <div class="axis-range">
                                    <span>{{ dailyStats.startLabel }}</span>
                                    <span>{{ dailyStats.midLabel }}</span>
                                    <span>{{ dailyStats.endLabel }}</span>
                                </div>
                            </div>
                        </Card>
                    </section>

                    <section class="two-col-grid" aria-label="内容与社区结构">
                        <Card title="文章分类分布" :icon="Layers">
                            <n-empty v-if="!categoryRows.length" description="暂无分类数据" />
                            <div v-else class="category-list">
                                <n-tooltip
                                    v-for="(item, index) in categoryRows"
                                    :key="item.category"
                                    :delay="150"
                                >
                                    <template #trigger>
                                        <RouterLink
                                            :to="{
                                                path: '/search',
                                                query: { category: String(item.category) }
                                            }"
                                            class="category-row"
                                        >
                                            <div class="category-label">
                                                <n-icon
                                                    :component="item.icon"
                                                    :style="{ color: item.color }"
                                                    size="16"
                                                />
                                                <span>{{ item.label }}</span>
                                            </div>
                                            <div class="h-bar-track">
                                                <div
                                                    class="h-bar-fill"
                                                    :style="{
                                                        '--bar-scale': Math.max(
                                                            0,
                                                            Math.min(1, item.widthPercent / 100)
                                                        ),
                                                        '--bar-delay': `${Math.min(index * 18, 180)}ms`,
                                                        backgroundColor: item.color
                                                    }"
                                                />
                                            </div>
                                            <div class="category-numbers">
                                                <strong>{{ formatNumber(item.count) }}</strong>
                                                <span>{{ item.share }}</span>
                                            </div>
                                        </RouterLink>
                                    </template>
                                    {{ item.label }}：{{ formatNumber(item.count) }} 篇 · 本站阅读
                                    {{ formatCompact(item.totalViews) }} · 源站
                                    {{ formatCompact(item.totalUpvotes) }} 赞 /
                                    {{ formatCompact(item.totalFavors) }} 藏
                                </n-tooltip>
                            </div>
                        </Card>

                        <Card title="作者生态画像" :icon="Award">
                            <div class="ecosystem-body">
                                <div class="eco-block">
                                    <div class="eco-heading">
                                        <span>洛谷名色分布</span>
                                        <span class="eco-sub">
                                            共 {{ formatNumber(overview.summary.users) }} 人
                                        </span>
                                    </div>
                                    <n-empty
                                        v-if="!userColorRows.length"
                                        size="small"
                                        description="暂无作者数据"
                                    />
                                    <template v-else>
                                        <div
                                            class="stacked-bar"
                                            role="img"
                                            aria-label="洛谷名字颜色占比条"
                                        >
                                            <n-tooltip
                                                v-for="item in userColorRows"
                                                :key="item.color"
                                                :delay="80"
                                            >
                                                <template #trigger>
                                                    <div
                                                        class="stacked-seg"
                                                        :style="{
                                                            width: `${item.widthPercent}%`,
                                                            backgroundColor: item.swatch
                                                        }"
                                                    />
                                                </template>
                                                {{ item.label }}：{{
                                                    formatNumber(item.count)
                                                }}
                                                人（{{ item.share }}）
                                            </n-tooltip>
                                        </div>
                                        <div class="color-legend-grid">
                                            <div
                                                v-for="item in userColorRows"
                                                :key="item.color"
                                                class="color-legend-item"
                                            >
                                                <span class="color-legend-name">
                                                    <i
                                                        class="swatch-dot"
                                                        :style="{ backgroundColor: item.swatch }"
                                                    />
                                                    {{ item.label }}
                                                </span>
                                                <span class="color-legend-val">
                                                    <strong>{{ formatNumber(item.count) }}</strong>
                                                    <span>{{ item.share }}</span>
                                                </span>
                                            </div>
                                        </div>
                                    </template>
                                </div>

                                <div class="eco-divider" />

                                <div class="eco-block">
                                    <div class="eco-heading">
                                        <span>CCF 认证等级</span>
                                        <span class="eco-sub">
                                            已认证 {{ formatNumber(ccfStats.totalCertified) }} 人
                                        </span>
                                    </div>
                                    <n-empty
                                        v-if="!ccfStats.levels.length"
                                        size="small"
                                        description="暂无 CCF 认证数据"
                                    />
                                    <template v-else>
                                        <div class="tier-chips">
                                            <div
                                                v-for="tier in ccfStats.tiers"
                                                :key="tier.label"
                                                class="tier-chip"
                                            >
                                                <i
                                                    class="swatch-dot"
                                                    :style="{ backgroundColor: tier.color }"
                                                />
                                                <span>{{ tier.label }}</span>
                                                <strong>{{ formatNumber(tier.count) }}</strong>
                                            </div>
                                        </div>
                                        <div class="ccf-grid">
                                            <div
                                                v-for="(item, index) in ccfStats.levels"
                                                :key="item.level"
                                                class="ccf-row"
                                            >
                                                <span class="ccf-level">{{ item.level }} 级</span>
                                                <div class="h-bar-track is-thin">
                                                    <div
                                                        class="h-bar-fill"
                                                        :style="{
                                                            '--bar-scale':
                                                                ccfStats.maxCount > 0
                                                                    ? Math.max(
                                                                          0.04,
                                                                          item.count /
                                                                              ccfStats.maxCount
                                                                      )
                                                                    : 0,
                                                            '--bar-delay': `${Math.min(index * 18, 180)}ms`,
                                                            backgroundColor: ccfLevelColor(
                                                                item.level
                                                            )
                                                        }"
                                                    />
                                                </div>
                                                <strong class="ccf-count">
                                                    {{ formatNumber(item.count) }}
                                                </strong>
                                            </div>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </Card>
                    </section>

                    <section class="two-col-grid" aria-label="热门题解与高产作者榜">
                        <Card title="热门题解题目 Top 10" :icon="Flame">
                            <n-empty
                                v-if="!overview.topProblems.length"
                                description="暂无题解关联数据"
                            />
                            <div v-else class="rank-list">
                                <RouterLink
                                    v-for="(item, index) in overview.topProblems"
                                    :key="item.pid"
                                    :to="{ path: '/search', query: { q: item.pid, category: '2' } }"
                                    class="rank-row problem-row"
                                >
                                    <span class="rank-index" :class="{ 'is-top': index < 3 }">
                                        {{ index + 1 }}
                                    </span>
                                    <span class="problem-pid">{{ item.pid }}</span>
                                    <div class="h-bar-track is-thin">
                                        <div
                                            class="h-bar-fill is-solution"
                                            :style="{
                                                '--bar-scale':
                                                    topProblemMax > 0
                                                        ? Math.max(
                                                              0.06,
                                                              item.solutionCount / topProblemMax
                                                          )
                                                        : 0,
                                                '--bar-delay': `${Math.min(index * 18, 180)}ms`
                                            }"
                                        />
                                    </div>
                                    <span class="rank-metric">
                                        <strong>{{ formatNumber(item.solutionCount) }}</strong> 篇
                                    </span>
                                </RouterLink>
                            </div>
                        </Card>

                        <Card title="高产作者榜 Top 10" :icon="Trophy">
                            <n-empty
                                v-if="!overview.topAuthors.length"
                                description="暂无作者排行数据"
                            />
                            <div v-else class="rank-list">
                                <div
                                    v-for="(author, index) in overview.topAuthors"
                                    :key="author.id"
                                    class="rank-row author-row"
                                >
                                    <span class="rank-index" :class="{ 'is-top': index < 3 }">
                                        {{ index + 1 }}
                                    </span>
                                    <div class="author-cell">
                                        <UserLink :user="author" :show-avatar="true" />
                                    </div>
                                    <div class="author-metrics">
                                        <span class="author-articles">
                                            <strong>{{ formatNumber(author.articleCount) }}</strong>
                                            篇
                                        </span>
                                        <span
                                            class="author-upvotes"
                                            :title="`本站累计阅读 ${formatNumber(author.totalViews)} · 源站赞 ${formatNumber(author.totalUpvotes)}`"
                                        >
                                            <n-icon :component="Eye" size="12" />
                                            {{ formatCompact(author.totalViews) }}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </section>

                    <Card title="热门文章榜" :icon="Star">
                        <template #header-extra>
                            <n-button-group size="tiny" role="group" aria-label="文章榜单排序">
                                <n-button
                                    :type="articleRankMode === 'view' ? 'primary' : 'default'"
                                    :ghost="articleRankMode !== 'view'"
                                    @click="articleRankMode = 'view'"
                                >
                                    本站阅读
                                </n-button>
                                <n-button
                                    :type="articleRankMode === 'upvote' ? 'primary' : 'default'"
                                    :ghost="articleRankMode !== 'upvote'"
                                    @click="articleRankMode = 'upvote'"
                                >
                                    源站高赞
                                </n-button>
                            </n-button-group>
                        </template>

                        <n-empty v-if="!rankedArticles.length" description="暂无文章排行数据" />
                        <div v-else class="rank-list">
                            <div
                                v-for="(article, index) in rankedArticles"
                                :key="article.id"
                                class="rank-row article-rank-row"
                            >
                                <span class="rank-index" :class="{ 'is-top': index < 3 }">
                                    {{ index + 1 }}
                                </span>
                                <div class="article-rank-main">
                                    <RouterLink
                                        :to="`/article/${article.id}`"
                                        class="article-rank-title"
                                    >
                                        {{ article.title }}
                                    </RouterLink>
                                    <div class="article-rank-sub">
                                        <n-tag
                                            size="tiny"
                                            :style="getCategoryTagStyle(article.category)"
                                        >
                                            {{
                                                (
                                                    ARTICLE_CATEGORIES[article.category] ||
                                                    UNKNOWN_CATEGORY
                                                ).label
                                            }}
                                        </n-tag>
                                        <UserLink v-if="article.author" :user="article.author" />
                                    </div>
                                </div>
                                <div class="article-rank-metrics">
                                    <span
                                        class="article-metric"
                                        :class="{ 'is-primary': articleRankMode === 'view' }"
                                        :title="`本站阅读 ${formatNumber(article.viewCount)}`"
                                    >
                                        <n-icon :component="Eye" size="13" />
                                        {{ formatCompact(article.viewCount) }}
                                    </span>
                                    <span
                                        class="article-metric"
                                        :class="{ 'is-primary': articleRankMode === 'upvote' }"
                                        :title="`归档时洛谷源站赞 ${formatNumber(article.upvote)}`"
                                    >
                                        <n-icon :component="ThumbsUp" size="13" />
                                        {{ formatCompact(article.upvote) }}
                                    </span>
                                    <span
                                        class="article-metric"
                                        :title="`归档时洛谷源站藏 ${formatNumber(article.favorCount)}`"
                                    >
                                        <n-icon :component="Star" size="13" />
                                        {{ formatCompact(article.favorCount) }}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <footer class="stats-footer">
                        数据更新于 {{ formatDate(overview.generatedAt) }} · 每
                        {{ Math.round(overview.cachedTtlSeconds / 60) }} 分钟更新一次缓存
                    </footer>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.statistic-page {
    max-width: 1220px;
    margin: 0 auto;
}

.overview-tab-pane {
    min-width: 0;
}

.header-controls {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
}

.stat-alert {
    margin-bottom: var(--ui-space-4);
}

.stat-alert-actions {
    margin-top: var(--ui-space-2);
}

.skeleton-layout,
.overview-stack {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
}

.kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.kpi-body {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.kpi-value {
    color: var(--ui-card-title-color);
    font-size: 30px;
    font-weight: 700;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}

.kpi-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-2);
    font-size: 13px;
    color: var(--ui-muted-text-color);
    padding-top: var(--ui-space-2);
    border-top: 1px solid var(--ui-border-color);
}

.kpi-meta strong {
    color: var(--ui-secondary-text-color);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.kpi-mini-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.kpi-mini-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--ui-secondary-text-color);
}

.kpi-mini-row strong {
    color: var(--ui-card-title-color);
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.two-col-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.chart-badges {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
}

.header-metric {
    font-size: 13px;
    font-weight: 500;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.bar-chart-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.chart-legend {
    display: flex;
    align-items: center;
    gap: var(--ui-space-4);
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.legend-dot,
.swatch-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.legend-dot.is-day {
    background: var(--ui-primary-color);
}

.legend-dot.is-night {
    background: var(--ui-category-study-color);
}

.bar-chart {
    display: grid;
    align-items: end;
    gap: var(--ui-space-1);
    height: 168px;
    padding-top: var(--ui-space-2);
}

.bar-chart-24 {
    grid-template-columns: repeat(24, minmax(0, 1fr));
}

.bar-chart-30 {
    grid-template-columns: repeat(30, minmax(0, 1fr));
    gap: 3px;
    height: 152px;
}

.bar-chart-year {
    gap: var(--ui-space-2);
    height: 168px;
}

.bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    min-width: 0;
    cursor: default;
}

.bar-track {
    width: 100%;
    flex: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    border-bottom: 1px solid var(--ui-border-color);
}

.bar-fill {
    width: 100%;
    max-width: 28px;
    border-radius: 3px 3px 0 0;
    background: var(--ui-primary-color);
    opacity: 0.82;
    transform-origin: bottom center;
    animation: bar-grow-y var(--ui-motion-slow) var(--ui-motion-ease-out) var(--bar-delay, 0ms)
        backwards;
    transition:
        opacity var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-fast) var(--ui-motion-ease);
}

@keyframes bar-grow-y {
    from {
        transform: scaleY(0);
    }
    to {
        transform: scaleY(1);
    }
}

.bar-col:hover .bar-fill {
    opacity: 1;
}

.bar-fill.is-night {
    background: var(--ui-category-study-color);
}

.bar-fill.is-peak {
    opacity: 1;
    box-shadow: 0 0 0 1px var(--ui-primary-color-pressed);
}

.bar-fill.is-year {
    background: var(--ui-category-algorithm-color);
    max-width: 36px;
}

.bar-fill.is-daily {
    background: var(--ui-success-color);
    max-width: 16px;
}

.bar-tick {
    height: 18px;
    margin-top: var(--ui-space-1);
    font-size: 11px;
    line-height: 18px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.axis-range {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.chart-footnote {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    line-height: 1.5;
}

.category-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.category-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) 108px;
    align-items: center;
    gap: var(--ui-space-3);
    padding: 6px var(--ui-space-2);
    border-radius: var(--ui-card-radius);
    color: inherit;
    text-decoration: none;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.category-row:hover {
    background: var(--ui-panel-color);
}

.category-label {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-2);
    font-size: 13px;
    font-weight: 500;
    color: var(--ui-text-color);
    white-space: nowrap;
}

.category-numbers {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: var(--ui-space-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.category-numbers strong {
    font-size: 13px;
    color: var(--ui-card-title-color);
}

.category-numbers span {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    min-width: 40px;
    text-align: right;
}

.h-bar-track {
    width: 100%;
    height: 10px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-panel-color);
    overflow: hidden;
}

.h-bar-track.is-thin {
    height: 7px;
}

.h-bar-fill {
    width: 100%;
    height: 100%;
    border-radius: var(--ui-pill-radius);
    transform-origin: left center;
    transform: scaleX(var(--bar-scale, 0));
    animation: bar-grow-x var(--ui-motion-slow) var(--ui-motion-ease-out) var(--bar-delay, 0ms)
        backwards;
    transition: transform var(--ui-motion-slow) var(--ui-motion-ease-out);
}

@keyframes bar-grow-x {
    from {
        transform: scaleX(0);
        opacity: 0.45;
    }
    to {
        transform: scaleX(var(--bar-scale, 1));
        opacity: 1;
    }
}

.h-bar-fill.is-solution {
    background: var(--ui-category-solution-color);
}

.ecosystem-body {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.eco-block {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.eco-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text-color);
}

.eco-sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.eco-divider {
    height: 1px;
    background: var(--ui-border-color);
}

.stacked-bar {
    display: flex;
    height: 14px;
    border-radius: var(--ui-pill-radius);
    overflow: hidden;
    background: var(--ui-panel-color);
    gap: 1px;
    transform-origin: left center;
    animation: stacked-bar-reveal var(--ui-motion-slow) var(--ui-motion-ease-out) backwards;
}

@keyframes stacked-bar-reveal {
    from {
        transform: scaleX(0);
    }
    to {
        transform: scaleX(1);
    }
}

.stacked-seg {
    height: 100%;
    min-width: 2px;
}

.color-legend-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-2) var(--ui-space-4);
}

.color-legend-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    font-size: 13px;
}

.color-legend-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ui-secondary-text-color);
}

.color-legend-val {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-variant-numeric: tabular-nums;
}

.color-legend-val strong {
    color: var(--ui-card-title-color);
    font-weight: 600;
}

.color-legend-val span {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.tier-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.tier-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px var(--ui-space-2);
    border-radius: var(--ui-tag-radius);
    background: var(--ui-panel-color);
    font-size: 12px;
    color: var(--ui-secondary-text-color);
}

.tier-chip strong {
    color: var(--ui-card-title-color);
    font-variant-numeric: tabular-nums;
}

.ccf-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-2) var(--ui-space-4);
}

.ccf-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 44px;
    align-items: center;
    gap: var(--ui-space-2);
    font-size: 12px;
}

.ccf-level {
    color: var(--ui-secondary-text-color);
    font-variant-numeric: tabular-nums;
}

.ccf-count {
    text-align: right;
    color: var(--ui-card-title-color);
    font-variant-numeric: tabular-nums;
}

.rank-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-1);
}

.rank-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    padding: var(--ui-space-2);
    border-radius: var(--ui-card-radius);
    color: inherit;
    text-decoration: none;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.rank-row:hover {
    background: var(--ui-panel-color);
}

.rank-index {
    width: 22px;
    height: 22px;
    border-radius: var(--ui-tag-radius);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ui-muted-text-color);
    background: var(--ui-panel-color);
    flex-shrink: 0;
}

.rank-index.is-top {
    color: #fff;
    background: var(--ui-primary-color);
}

.problem-pid {
    min-width: 78px;
    padding: 2px var(--ui-space-2);
    border-radius: var(--ui-tag-radius);
    background: var(--ui-panel-color);
    font-family: var(--ui-font-family-mono);
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    color: var(--ui-link-color);
}

.rank-metric {
    min-width: 64px;
    text-align: right;
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.rank-metric strong {
    color: var(--ui-card-title-color);
    font-size: 13px;
}

.author-cell {
    flex: 1;
    min-width: 0;
}

.author-metrics {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}

.author-articles {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.author-articles strong {
    font-size: 14px;
    color: var(--ui-card-title-color);
}

.author-upvotes {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 56px;
    justify-content: flex-end;
    font-size: 12px;
    color: var(--ui-secondary-text-color);
}

.article-rank-row {
    align-items: flex-start;
}

.article-rank-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-1);
}

.article-rank-title {
    color: var(--ui-card-title-color);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    text-decoration: none;
    overflow-wrap: anywhere;
}

.article-rank-title:hover {
    color: var(--ui-link-color);
}

.article-rank-sub {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
    font-size: 12px;
}

.article-rank-metrics {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    flex-shrink: 0;
    padding-top: 2px;
    font-variant-numeric: tabular-nums;
}

.article-metric {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--ui-muted-text-color);
    min-width: 54px;
    justify-content: flex-end;
}

.article-metric.is-primary {
    color: var(--ui-primary-color);
    font-weight: 600;
}

.stats-footer {
    text-align: center;
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    padding-bottom: var(--ui-space-2);
}

@media (max-width: 1024px) {
    .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .two-col-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

@media (max-width: 768px) {
    .kpi-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--ui-space-3);
    }

    .category-row {
        grid-template-columns: 96px minmax(0, 1fr) 92px;
        gap: var(--ui-space-2);
    }

    .color-legend-grid,
    .ccf-grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .article-rank-row {
        flex-wrap: wrap;
    }

    .article-rank-metrics {
        width: 100%;
        padding-left: 34px;
        justify-content: flex-start;
    }

    .article-metric {
        min-width: auto;
        justify-content: flex-start;
    }

    .bar-chart-year .bar-tick {
        font-size: 10px;
    }
}
</style>
