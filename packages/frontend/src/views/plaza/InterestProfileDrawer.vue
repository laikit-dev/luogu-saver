<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
    NAlert,
    NButton,
    NDrawer,
    NDrawerContent,
    NEmpty,
    NIcon,
    NPopconfirm,
    NSkeleton,
    NTag,
    NTooltip,
    useMessage
} from 'naive-ui';
import { Clock, Compass, Layers, RefreshCw, Sparkles, Tag, Trash2, Users } from 'lucide-vue-next';
import UserLink from '@/components/UserLink.vue';
import {
    clearInterestProfile,
    type InterestProfileSummary,
    type PersonaTagTone,
    type ReadingRhythmPeriod
} from '@/api/recommendation.ts';
import {
    getCategoryColor,
    getCategoryIcon,
    getCategoryLabel,
    getTagStyle
} from '@/utils/article.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { trackingAllowed, trackingConsent } from '@/utils/tracking-consent.ts';

const props = defineProps<{
    show: boolean;
    loading: boolean;
    error: string | null;
    profile: InterestProfileSummary | null;
}>();

const emit = defineEmits<{
    'update:show': [value: boolean];
    refresh: [];
    cleared: [];
}>();

const message = useMessage();
const clearing = ref(false);

const TONE_COLOR_MAP: Record<PersonaTagTone, string> = {
    primary: 'var(--ui-primary-color)',
    info: 'var(--ui-cyan-color)',
    success: 'var(--ui-success-color)',
    warning: 'var(--ui-orange-color)',
    purple: 'var(--ui-category-study-color)'
};

const RHYTHM_META: Record<ReadingRhythmPeriod, { label: string; range: string; color: string }> = {
    morning: { label: '上午', range: '06–11', color: 'var(--ui-category-solution-color)' },
    afternoon: { label: '下午', range: '12–17', color: 'var(--ui-primary-color)' },
    evening: { label: '晚间', range: '18–22', color: 'var(--ui-category-algorithm-color)' },
    night: { label: '深夜', range: '23–05', color: 'var(--ui-category-study-color)' }
};

const maxCategoryShare = computed(() =>
    (props.profile?.categories ?? []).reduce((max, item) => Math.max(max, item.share), 0)
);

const maxRhythmShare = computed(() =>
    (props.profile?.readingRhythm ?? []).reduce((max, item) => Math.max(max, item.share), 0)
);

function formatPercent(share: number): string {
    return `${Math.round(share * 100)}%`;
}

function enableTracking() {
    trackingConsent.value = 'allowed';
    message.success('已开启个性化推荐与阅读画像');
}

async function handleClearProfile() {
    clearing.value = true;
    try {
        const response = await clearInterestProfile();
        if (response.code !== 200) {
            message.error(response.message || '清空画像失败');
            return;
        }
        message.success('已清空阅读画像与推荐记录');
        emit('cleared');
    } catch (failure) {
        message.error(requestErrorMessage(failure, '清空画像失败'));
    } finally {
        clearing.value = false;
    }
}
</script>

<template>
    <n-drawer
        :show="show"
        width="min(540px, 100vw)"
        placement="right"
        @update:show="value => emit('update:show', value)"
    >
        <n-drawer-content title="我的兴趣画像" closable>
            <div v-if="!trackingAllowed" class="empty-panel">
                <n-empty description="尚未开启阅读记录，推荐算法还无法认识你">
                    <template #extra>
                        <n-button type="primary" size="small" @click="enableTracking">
                            <template #icon>
                                <n-icon :component="Sparkles" />
                            </template>
                            开启个性化推荐
                        </n-button>
                    </template>
                </n-empty>
            </div>

            <div v-else-if="loading && !profile" class="drawer-skeleton" role="status">
                <n-skeleton text :repeat="3" />
                <n-skeleton height="120px" />
                <n-skeleton height="140px" />
            </div>

            <n-alert v-else-if="error" type="error" class="drawer-alert">
                {{ error }}
                <div class="alert-actions">
                    <n-button size="small" :disabled="loading" @click="emit('refresh')">
                        重试
                    </n-button>
                </div>
            </n-alert>

            <div v-else-if="profile && profile.viewedCount === 0" class="empty-panel">
                <n-empty description="还没有阅读记录，先在广场逛几篇文章吧" />
            </div>

            <div v-else-if="profile" class="profile-body">
                <section class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Sparkles" size="15" />
                            算法给你打的标签
                        </span>
                        <span class="section-meta">
                            基于近 {{ profile.viewedCount }} 篇阅读 ·
                            {{ profile.subjectKind === 'user' ? '账号' : '本设备' }}保留
                            {{ profile.retentionDays }} 天
                        </span>
                    </div>

                    <div class="persona-wrap">
                        <n-tooltip v-for="tag in profile.personaTags" :key="tag.id" :delay="120">
                            <template #trigger>
                                <n-tag
                                    class="persona-tag"
                                    size="medium"
                                    :style="getTagStyle(TONE_COLOR_MAP[tag.tone])"
                                >
                                    {{ tag.label }}
                                </n-tag>
                            </template>
                            {{ tag.description }}
                        </n-tooltip>
                    </div>
                </section>

                <section v-if="profile.topicTags.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Tag" size="15" />
                            高频兴趣主题
                        </span>
                        <span class="section-meta">点击标签搜索同类文章</span>
                    </div>

                    <div class="topic-cloud">
                        <RouterLink
                            v-for="item in profile.topicTags"
                            :key="item.tag"
                            :to="{ path: '/search', query: { q: item.tag } }"
                            class="topic-chip"
                            :class="{ 'is-strong': item.share >= 0.7 }"
                            @click="emit('update:show', false)"
                        >
                            <span># {{ item.tag }}</span>
                            <span class="topic-count">{{ item.count }}</span>
                        </RouterLink>
                    </div>
                </section>

                <section v-if="profile.clusters.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Compass" size="15" />
                            语义兴趣簇
                        </span>
                        <span class="section-meta">与广场向量召回同步</span>
                    </div>

                    <div class="cluster-list">
                        <div
                            v-for="(cluster, index) in profile.clusters"
                            :key="`${cluster.label}-${index}`"
                            class="cluster-block"
                        >
                            <div class="cluster-top">
                                <span class="cluster-name">{{ cluster.label }}</span>
                                <span class="cluster-share">
                                    权重 {{ formatPercent(cluster.share) }}
                                </span>
                            </div>
                            <div class="bar-track">
                                <div
                                    class="bar-fill"
                                    :style="{
                                        width: `${Math.max(6, cluster.share * 100)}%`,
                                        backgroundColor:
                                            cluster.dominantCategory !== null
                                                ? getCategoryColor(cluster.dominantCategory)
                                                : 'var(--ui-primary-color)'
                                    }"
                                />
                            </div>
                            <div class="cluster-articles">
                                <RouterLink
                                    v-for="art in cluster.sampleArticles"
                                    :key="art.id"
                                    :to="`/article/${art.id}`"
                                    class="cluster-article-link"
                                    @click="emit('update:show', false)"
                                >
                                    {{ art.title }}
                                </RouterLink>
                            </div>
                        </div>
                    </div>
                </section>

                <section v-if="profile.categories.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Layers" size="15" />
                            分区偏好
                        </span>
                    </div>

                    <div class="category-list">
                        <RouterLink
                            v-for="item in profile.categories"
                            :key="item.category"
                            :to="{ path: '/search', query: { category: String(item.category) } }"
                            class="category-row"
                            @click="emit('update:show', false)"
                        >
                            <span class="category-name">
                                <n-icon
                                    :component="getCategoryIcon(item.category)"
                                    :style="{ color: getCategoryColor(item.category) }"
                                    size="15"
                                />
                                {{ getCategoryLabel(item.category) }}
                            </span>
                            <div class="bar-track">
                                <div
                                    class="bar-fill"
                                    :style="{
                                        width:
                                            maxCategoryShare > 0
                                                ? `${Math.max(4, (item.share / maxCategoryShare) * 100)}%`
                                                : '0%',
                                        backgroundColor: getCategoryColor(item.category)
                                    }"
                                />
                            </div>
                            <span class="category-stat">
                                <strong>{{ formatPercent(item.share) }}</strong>
                                <span>{{ item.count }} 篇</span>
                            </span>
                        </RouterLink>
                    </div>
                </section>

                <section v-if="profile.readingRhythm.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Clock" size="15" />
                            阅读时段（北京时间）
                        </span>
                    </div>

                    <div class="rhythm-grid">
                        <div
                            v-for="bucket in profile.readingRhythm"
                            :key="bucket.period"
                            class="rhythm-row"
                        >
                            <span class="rhythm-label">
                                {{ RHYTHM_META[bucket.period].label }}
                                <small>{{ RHYTHM_META[bucket.period].range }}</small>
                            </span>
                            <div class="bar-track is-thin">
                                <div
                                    class="bar-fill"
                                    :style="{
                                        width:
                                            maxRhythmShare > 0 && bucket.count > 0
                                                ? `${Math.max(5, (bucket.share / maxRhythmShare) * 100)}%`
                                                : '0%',
                                        backgroundColor: RHYTHM_META[bucket.period].color
                                    }"
                                />
                            </div>
                            <span class="rhythm-val">
                                {{ formatPercent(bucket.share) }}
                            </span>
                        </div>
                    </div>
                </section>

                <section v-if="profile.favoriteAuthors.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">
                            <n-icon :component="Users" size="15" />
                            常看作者
                        </span>
                    </div>

                    <div class="author-list">
                        <div
                            v-for="author in profile.favoriteAuthors"
                            :key="author.id"
                            class="author-row"
                            @click="emit('update:show', false)"
                        >
                            <UserLink :user="author" :show-avatar="true" />
                            <span class="author-count">{{ author.count }} 篇</span>
                        </div>
                    </div>
                </section>

                <section v-if="profile.recentArticles.length" class="profile-section">
                    <div class="section-head">
                        <span class="section-title">近期影响推荐的阅读</span>
                    </div>

                    <div class="recent-list">
                        <RouterLink
                            v-for="art in profile.recentArticles"
                            :key="art.id"
                            :to="`/article/${art.id}`"
                            class="recent-row"
                            @click="emit('update:show', false)"
                        >
                            <span class="recent-title">{{ art.title }}</span>
                            <span class="recent-time">{{ formatDate(art.viewedAt) }}</span>
                        </RouterLink>
                    </div>
                </section>
            </div>

            <template v-if="trackingAllowed" #footer>
                <div class="drawer-footer">
                    <n-button size="small" secondary :loading="loading" @click="emit('refresh')">
                        <template #icon>
                            <n-icon :component="RefreshCw" />
                        </template>
                        刷新画像
                    </n-button>

                    <n-popconfirm
                        positive-text="确认清空"
                        negative-text="取消"
                        :positive-button-props="{ type: 'error', loading: clearing }"
                        @positive-click="handleClearProfile"
                    >
                        <template #trigger>
                            <n-button
                                size="small"
                                quaternary
                                type="error"
                                :disabled="!profile || profile.viewedCount === 0 || clearing"
                            >
                                <template #icon>
                                    <n-icon :component="Trash2" />
                                </template>
                                清空记录
                            </n-button>
                        </template>
                        将清空你的阅读历史和已推荐记录，广场推荐会重新开始学习。
                    </n-popconfirm>
                </div>
            </template>
        </n-drawer-content>
    </n-drawer>
</template>

<style scoped>
.empty-panel {
    padding: var(--ui-space-10) 0;
}

.drawer-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.drawer-alert {
    margin-bottom: var(--ui-space-4);
}

.alert-actions {
    margin-top: var(--ui-space-2);
}

.profile-body {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-5);
}

.profile-section {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    padding-bottom: var(--ui-space-4);
    border-bottom: 1px solid var(--ui-border-color);
}

.profile-section:last-child {
    padding-bottom: 0;
    border-bottom: 0;
}

.section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
}

.section-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.section-meta {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.persona-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.persona-tag {
    font-weight: 600;
    cursor: default;
}

.topic-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.topic-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-panel-color);
    color: var(--ui-text-color);
    font-size: 13px;
    text-decoration: none;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.topic-chip:hover {
    background: var(--ui-control-tag-color);
    color: var(--ui-link-color);
}

.topic-chip.is-strong {
    font-weight: 600;
    color: var(--ui-primary-color);
}

.topic-count {
    font-size: 11px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.cluster-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.cluster-block {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: var(--ui-space-3);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.cluster-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-2);
}

.cluster-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.cluster-share {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.cluster-articles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 2px;
}

.cluster-article-link {
    font-size: 12px;
    color: var(--ui-secondary-text-color);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cluster-article-link:hover {
    color: var(--ui-link-color);
}

.bar-track {
    width: 100%;
    height: 8px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-panel-color);
    overflow: hidden;
}

.cluster-block .bar-track {
    background: var(--ui-border-color);
}

.bar-track.is-thin {
    height: 6px;
}

.bar-fill {
    height: 100%;
    border-radius: var(--ui-pill-radius);
}

.category-list,
.rhythm-grid,
.author-list,
.recent-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.category-row {
    display: grid;
    grid-template-columns: 98px minmax(0, 1fr) 82px;
    align-items: center;
    gap: var(--ui-space-2);
    padding: 4px 6px;
    border-radius: var(--ui-card-radius);
    color: inherit;
    text-decoration: none;
}

.category-row:hover {
    background: var(--ui-panel-color);
}

.category-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ui-text-color);
    white-space: nowrap;
}

.category-stat {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 6px;
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.category-stat strong {
    color: var(--ui-card-title-color);
}

.rhythm-row {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr) 44px;
    align-items: center;
    gap: var(--ui-space-2);
    font-size: 12px;
}

.rhythm-label {
    color: var(--ui-secondary-text-color);
    white-space: nowrap;
}

.rhythm-label small {
    color: var(--ui-muted-text-color);
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
}

.rhythm-val {
    text-align: right;
    color: var(--ui-card-title-color);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.author-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    padding: 4px 2px;
}

.author-count {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.recent-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-3);
    padding: 4px 6px;
    border-radius: var(--ui-card-radius);
    color: inherit;
    text-decoration: none;
}

.recent-row:hover {
    background: var(--ui-panel-color);
}

.recent-title {
    font-size: 13px;
    color: var(--ui-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.recent-time {
    font-size: 11px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}

.drawer-footer {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
}
</style>
