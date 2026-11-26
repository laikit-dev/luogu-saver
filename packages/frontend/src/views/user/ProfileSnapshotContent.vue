<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { NAlert, NButton, NEmpty, NIcon, NSelect, NSpin, NTag } from 'naive-ui';
import { Award, FileText, GitCompareArrows, RotateCcw } from 'lucide-vue-next';
import type { ProfileVersionMetadata, ProfileVersionSnapshot } from '@/api/archive.ts';
import type { UserProfile } from '@/types/user';
import Card from '@/components/Card.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { formatDate } from '@/utils/render.ts';

const props = defineProps<{
    uid: number;
    currentProfile: UserProfile | null;
    historical: boolean;
    requestedVersion: number | null;
    snapshot: ProfileVersionSnapshot | null;
    snapshotLoading: boolean;
    snapshotError: string | null;
    versions: ProfileVersionMetadata[];
    versionsLoading: boolean;
    canCompare: boolean;
    currentLocation: RouteLocationRaw;
}>();

const emit = defineEmits<{
    selectVersion: [version: number];
    compareWithCurrent: [version: number];
    openCompare: [];
    retrySnapshot: [];
}>();

const displayedProfile = computed(() =>
    props.historical ? (props.snapshot?.profile ?? null) : props.currentProfile
);

const orderedPrizes = computed(() => [...(displayedProfile.value?.prizes ?? [])].reverse());

const mobileVersionOptions = computed(() =>
    props.versions.map((item, index) => ({
        value: item.version,
        label: `v${item.version}${index === 0 ? '（最新）' : ''} · ${formatDate(item.observedAt)}`
    }))
);

const selectedMobileVersion = computed(() =>
    props.historical ? props.requestedVersion : (props.versions[0]?.version ?? null)
);
function prizeTagType(prize: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
    if (prize.includes('金') || prize.includes('一等')) return 'warning';
    if (prize.includes('银') || prize.includes('二等')) return 'default';
    if (prize.includes('铜') || prize.includes('三等')) return 'error';
    return 'info';
}
</script>

<template>
    <div class="profile-tab-stack">
        <div v-if="versions.length > 0" class="mobile-version-bar">
            <n-select
                class="mobile-version-select"
                size="small"
                :value="selectedMobileVersion"
                :options="mobileVersionOptions"
                :loading="versionsLoading"
                aria-label="选择资料版本"
                @update:value="val => emit('selectVersion', val ?? 0)"
            />
            <n-button v-if="canCompare" size="small" secondary @click="emit('openCompare')">
                <template #icon>
                    <n-icon :component="GitCompareArrows" />
                </template>
                比对
            </n-button>
        </div>

        <n-alert v-if="snapshotError" type="error">
            {{ snapshotError }}
            <div v-if="requestedVersion !== null" class="alert-actions">
                <n-button size="small" :loading="snapshotLoading" @click="emit('retrySnapshot')">
                    重试
                </n-button>
                <RouterLink v-slot="{ href, navigate }" :to="currentLocation" custom>
                    <n-button size="small" secondary tag="a" :href="href" @click="navigate">
                        返回最新
                    </n-button>
                </RouterLink>
            </div>
        </n-alert>

        <n-spin :show="snapshotLoading" aria-label="正在加载历史快照">
            <div v-if="historical && snapshot" class="snapshot-banner">
                <div class="snapshot-banner-copy">
                    <n-tag size="small" type="info">历史快照 v{{ snapshot.version }}</n-tag>
                    <span class="snapshot-banner-time">
                        记录于
                        <time :datetime="snapshot.observedAt">
                            {{ formatDate(snapshot.observedAt) }}
                        </time>
                    </span>
                </div>
                <div class="snapshot-banner-actions">
                    <n-button
                        v-if="canCompare"
                        size="small"
                        secondary
                        @click="emit('compareWithCurrent', snapshot.version)"
                    >
                        <template #icon>
                            <n-icon :component="GitCompareArrows" />
                        </template>
                        与最新比对
                    </n-button>
                    <RouterLink v-slot="{ href, navigate }" :to="currentLocation" custom>
                        <n-button
                            size="small"
                            type="primary"
                            secondary
                            tag="a"
                            :href="href"
                            @click="navigate"
                        >
                            <template #icon>
                                <n-icon :component="RotateCcw" />
                            </template>
                            返回最新
                        </n-button>
                    </RouterLink>
                </div>
            </div>

            <template v-if="displayedProfile">
                <Card v-if="historical" title="快照当时资料" class="snapshot-identity-card">
                    <div class="snapshot-identity-body">
                        <div class="snapshot-identity-name">
                            <span :class="`user-${displayedProfile.color}`">
                                {{ displayedProfile.name }}
                            </span>
                            <UserPrizeBadge
                                v-if="
                                    displayedProfile.ccfLevel > 0 || displayedProfile.xcpcLevel > 0
                                "
                                :ccf-level="displayedProfile.ccfLevel"
                                :xcpc-level="displayedProfile.xcpcLevel"
                                :size="16"
                            />
                        </div>
                        <div class="snapshot-identity-meta">
                            <span>UID {{ displayedProfile.id }}</span>
                            <span v-if="displayedProfile.ccfLevel > 0">
                                OI {{ displayedProfile.ccfLevel }} 级
                            </span>
                            <span v-if="displayedProfile.xcpcLevel > 0">
                                ICPC/CCPC {{ displayedProfile.xcpcLevel }} 级
                            </span>
                        </div>
                        <p class="snapshot-identity-slogan">
                            {{ displayedProfile.slogan || '未填写个性签名' }}
                        </p>
                    </div>
                </Card>

                <Card title="个人介绍" :icon="FileText">
                    <MarkdownViewer
                        v-if="displayedProfile.introduction"
                        :key="`${uid}-${snapshot?.version ?? 'current'}`"
                        :content="displayedProfile.introduction"
                        :heading-offset="2"
                    />
                    <n-empty v-else description="暂无个人介绍" />
                </Card>

                <Card title="获奖记录" :icon="Award">
                    <n-empty v-if="!orderedPrizes.length" description="暂无获奖记录" />
                    <ul v-else class="prize-list">
                        <li v-for="(prize, index) in orderedPrizes" :key="index" class="prize-row">
                            <div class="prize-main">
                                <span class="prize-year">{{ prize.year }}</span>
                                <span class="prize-contest">
                                    {{ prize.contest }}
                                    <template v-if="prize.event"> · {{ prize.event }}</template>
                                </span>
                            </div>
                            <n-tag size="small" :type="prizeTagType(prize.prize)" :bordered="false">
                                {{ prize.prize }}
                            </n-tag>
                        </li>
                    </ul>
                </Card>
            </template>

            <Card v-else-if="!snapshotLoading && !snapshotError">
                <n-empty :description="historical ? '暂无该快照数据' : '该用户主页尚未收录'" />
            </Card>
        </n-spin>
    </div>
</template>

<style scoped>
.profile-tab-stack {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.mobile-version-bar {
    display: none;
}

.alert-actions {
    display: flex;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-2);
}

.snapshot-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    flex-wrap: wrap;
    padding: var(--ui-space-3) var(--ui-space-4);
    margin-bottom: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-alert-info-background-color);
}

.snapshot-banner-copy {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
}

.snapshot-banner-time {
    font-size: 13px;
    color: var(--ui-secondary-text-color);
    font-variant-numeric: tabular-nums;
}

.snapshot-banner-actions {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
}

.snapshot-identity-card {
    margin-bottom: var(--ui-space-4);
}

.snapshot-identity-body {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.snapshot-identity-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 16px;
    font-weight: 700;
}

.snapshot-identity-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-3);
    font-size: 12px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.snapshot-identity-slogan {
    margin: 0;
    font-size: 13px;
    color: var(--ui-secondary-text-color);
}

.profile-tab-stack :deep(.saver-card + .saver-card) {
    margin-top: var(--ui-space-4);
}

.prize-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
}

.prize-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    padding: 10px 2px;
    border-bottom: 1px solid var(--ui-border-color);
}

.prize-row:last-child {
    border-bottom: 0;
    padding-bottom: 0;
}

.prize-row:first-child {
    padding-top: 0;
}

.prize-main {
    display: flex;
    align-items: baseline;
    gap: var(--ui-space-2);
    min-width: 0;
}

.prize-year {
    font-family: var(--ui-font-family-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-muted-text-color);
    flex-shrink: 0;
}

.prize-contest {
    font-size: 14px;
    color: var(--ui-text-color);
    overflow-wrap: anywhere;
}

@media (max-width: 960px) {
    .mobile-version-bar {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
    }

    .mobile-version-select {
        flex: 1;
        min-width: 0;
    }
}
</style>
