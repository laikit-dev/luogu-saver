<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NEmpty, NSelect, NSpin, NTag } from 'naive-ui';
import {
    getProfileVersion,
    getProfileVersions,
    parsePositiveIntId,
    type ProfileVersionMetadata,
    type ProfileVersionSnapshot
} from '@/api/archive.ts';
import type { UserProfile } from '@/types/user';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const props = defineProps<{
    uid: number;
    currentProfile: UserProfile | null;
    currentLoading?: boolean;
    currentError?: string | null;
    refreshKey?: number;
}>();
const route = useRoute();
const router = useRouter();
const versions = ref<ProfileVersionMetadata[]>([]);
const versionsLoading = ref(false);
const versionsError = ref<string | null>(null);
const snapshot = ref<ProfileVersionSnapshot | null>(null);
const snapshotLoading = ref(false);
const snapshotError = ref<string | null>(null);
let versionsRequestId = 0;
let snapshotRequestId = 0;
const hasVersionQuery = computed(() => route.query.version !== undefined);
const requestedVersion = computed(() => parsePositiveIntId(route.query.version));
const historical = computed(() => hasVersionQuery.value);
const versionOptions = computed(() => [
    { value: 0, label: '最新版本' },
    ...versions.value.map(item => ({
        value: item.version,
        label: `v${item.version} · ${formatDate(item.observedAt)} · ${item.name}`
    }))
]);
const displayedProfile = computed(() =>
    historical.value ? (snapshot.value?.profile ?? null) : props.currentProfile
);
const orderedPrizes = computed(() => [...(displayedProfile.value?.prizes ?? [])].reverse());
const currentLocation = computed(() => ({
    path: route.path,
    query: { ...route.query, version: undefined },
    hash: route.hash
}));

function prizeTagType(prize: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
    if (prize.includes('金') || prize.includes('一等')) return 'warning';
    if (prize.includes('银') || prize.includes('二等')) return 'default';
    if (prize.includes('铜') || prize.includes('三等')) return 'error';
    return 'info';
}

function selectVersion(version: number) {
    void router.push({
        path: route.path,
        query: { ...route.query, version: version === 0 ? undefined : String(version) },
        hash: route.hash
    });
}

async function loadVersions() {
    const id = ++versionsRequestId;
    const targetUid = props.uid;
    versionsLoading.value = true;
    versionsError.value = null;
    try {
        const response = await getProfileVersions(targetUid);
        if (id !== versionsRequestId) return;
        if (response.code !== 200) {
            versionsError.value = response.message || '历史版本加载失败';
            return;
        }
        versions.value = response.data.versions;
    } catch (error) {
        if (id === versionsRequestId)
            versionsError.value = requestErrorMessage(error, '历史版本加载失败');
    } finally {
        if (id === versionsRequestId) versionsLoading.value = false;
    }
}

async function loadSnapshot() {
    const id = ++snapshotRequestId;
    const targetUid = props.uid;
    const version = requestedVersion.value;
    snapshot.value = null;
    snapshotError.value = null;
    snapshotLoading.value = false;
    if (!hasVersionQuery.value) return;
    if (version === null) {
        snapshotError.value = '无效的版本号';
        return;
    }
    snapshotLoading.value = true;
    try {
        const response = await getProfileVersion(targetUid, version);
        if (id !== snapshotRequestId) return;
        if (response.code !== 200) {
            snapshotError.value =
                response.code === 404 ? '该版本不存在' : response.message || '快照加载失败';
            return;
        }
        snapshot.value = response.data;
    } catch (error) {
        if (id !== snapshotRequestId) return;
        snapshotError.value = requestErrorMessage(error, '快照加载失败');
    } finally {
        if (id === snapshotRequestId) snapshotLoading.value = false;
    }
}

watch(
    () => [props.uid, props.refreshKey],
    () => {
        versionsRequestId++;
        versions.value = [];
        versionsError.value = null;
        void loadVersions();
    },
    { immediate: true, flush: 'sync' }
);
watch(
    () => [props.uid, props.refreshKey, route.query.version],
    () => void loadSnapshot(),
    { immediate: true, flush: 'sync' }
);
onUnmounted(() => {
    versionsRequestId++;
    snapshotRequestId++;
});
</script>

<template>
    <div class="archive-profile-history">
        <n-alert v-if="versionsError" type="error">
            {{ versionsError }}
            <div class="archive-state-actions">
                <n-button :loading="versionsLoading" @click="loadVersions">重试</n-button>
            </div>
        </n-alert>
        <div class="archive-version-toolbar">
            <label class="archive-version-select">
                <span>历史版本</span>
                <n-select
                    :value="hasVersionQuery ? requestedVersion : 0"
                    :options="versionOptions"
                    :loading="versionsLoading"
                    filterable
                    placeholder="选择版本"
                    aria-label="选择历史版本"
                    :input-props="{ 'aria-label': '选择历史版本' }"
                    @update:value="selectVersion"
                />
            </label>
            <RouterLink v-if="historical" class="archive-current-link" :to="currentLocation"
                >返回最新</RouterLink
            >
        </div>

        <n-alert v-if="snapshotError" type="error">
            {{ snapshotError }}
            <div v-if="requestedVersion !== null" class="archive-state-actions">
                <n-button :loading="snapshotLoading" @click="loadSnapshot">重试</n-button>
            </div>
        </n-alert>
        <n-spin :show="snapshotLoading" aria-label="正在加载历史快照">
            <p v-if="snapshotLoading" class="archive-description" role="status">正在加载…</p>
            <section v-if="displayedProfile" class="archive-profile-detail">
                <h2>
                    {{ historical ? `历史快照 v${snapshot?.version}` : '当前资料' }}
                </h2>
                <n-alert v-if="historical && snapshot" type="info" class="archive-snapshot-notice">
                    记录于
                    <time :datetime="snapshot.observedAt">{{
                        formatDate(snapshot.observedAt)
                    }}</time>
                </n-alert>
                <div v-if="historical" class="archive-snapshot-identity">
                    <div class="archive-profile-name">
                        <span :class="`user-${displayedProfile.color}`">{{
                            displayedProfile.name
                        }}</span>
                        <UserPrizeBadge
                            v-if="displayedProfile.ccfLevel > 0 || displayedProfile.xcpcLevel > 0"
                            :ccf-level="displayedProfile.ccfLevel"
                            :xcpc-level="displayedProfile.xcpcLevel"
                            :size="16"
                        />
                    </div>
                    <p>
                        洛谷 UID {{ displayedProfile.id }} · OI 等级
                        {{ displayedProfile.ccfLevel }} · ICPC/CCPC 等级
                        {{ displayedProfile.xcpcLevel }}
                    </p>
                    <p>{{ displayedProfile.slogan || '未填写签名' }}</p>
                </div>
                <div class="archive-profile-sections">
                    <section class="archive-introduction">
                        <h3>个人介绍</h3>
                        <MarkdownViewer
                            v-if="displayedProfile.introduction"
                            :key="`${uid}-${snapshot?.version ?? 'current'}`"
                            :content="displayedProfile.introduction"
                            :heading-offset="3"
                        />
                        <n-empty v-else description="暂无个人介绍" />
                    </section>
                    <section class="archive-prizes">
                        <h3>获奖信息</h3>
                        <n-empty v-if="!orderedPrizes.length" description="暂无获奖记录" />
                        <ul v-else class="archive-prize-list">
                            <li v-for="(prize, index) in orderedPrizes" :key="index">
                                <div class="archive-prize-text">
                                    <span
                                        >[{{ prize.year }}] {{ prize.contest
                                        }}<template v-if="prize.event">
                                            · {{ prize.event }}</template
                                        ></span
                                    >
                                    <span
                                        v-if="prize.score != null || prize.rank != null"
                                        class="archive-description"
                                    >
                                        <template v-if="prize.score != null"
                                            >成绩 {{ prize.score }}</template
                                        ><template v-if="prize.score != null && prize.rank != null">
                                            · </template
                                        ><template v-if="prize.rank != null"
                                            >排名 {{ prize.rank }}</template
                                        >
                                    </span>
                                </div>
                                <n-tag
                                    size="small"
                                    :type="prizeTagType(prize.prize)"
                                    :bordered="false"
                                    >{{ prize.prize }}</n-tag
                                >
                            </li>
                        </ul>
                    </section>
                </div>
            </section>
            <n-alert v-else-if="!historical && currentError" type="error">{{
                currentError
            }}</n-alert>
            <p v-else-if="!historical && currentLoading" class="archive-description" role="status">
                正在加载…
            </p>
            <n-empty v-else-if="!historical" description="暂未收录完整资料，可点击刷新获取" />
        </n-spin>
    </div>
</template>

<style scoped>
.archive-profile-history {
    min-width: 0;
}
.archive-description {
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}

.archive-version-select {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: var(--ui-space-2);
    min-width: 0;
    max-width: 100%;
}
.archive-current-link {
    align-self: center;
    color: var(--ui-link-color);
}
.archive-state-actions {
    margin-top: var(--ui-space-3);
}
.archive-profile-history h2 {
    margin: 0 0 var(--ui-space-3);
    font-size: 18px;
    font-weight: 600;
}
.archive-profile-history h3 {
    margin: 0 0 var(--ui-space-3);
    font-size: 16px;
    font-weight: 600;
}
.archive-profile-detail {
    margin-top: var(--ui-space-5);
}
.archive-snapshot-notice {
    margin-bottom: var(--ui-space-4);
}
.archive-profile-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    font-size: 18px;
    font-weight: 600;
}
.archive-snapshot-identity {
    overflow-wrap: anywhere;
}
.archive-snapshot-identity p {
    margin: var(--ui-space-2) 0;
}
.archive-profile-sections {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    align-items: start;
    gap: var(--ui-space-5);
    margin-top: var(--ui-space-4);
}
.archive-introduction,
.archive-prizes {
    min-width: 0;
    overflow-wrap: anywhere;
}
.archive-introduction :deep(img),
.archive-introduction :deep(video),
.archive-introduction :deep(iframe) {
    max-width: 100%;
}

.archive-prize-list {
    list-style: none;
    padding: 0;
    margin: 0;
}
.archive-prize-list li {
    display: flex;
    align-items: start;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    padding: var(--ui-space-3) 0;
    border-bottom: 1px solid var(--ui-border-color);
}
.archive-prize-text {
    display: flex;
    flex: 1 1 160px;
    flex-direction: column;
    gap: var(--ui-space-1);
    min-width: 0;
}
.archive-prize-text .archive-description {
    margin-bottom: 0;
}

a:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 3px;
}
@media (max-width: 768px) {
    .archive-version-select {
        flex: none;
        width: 100%;
    }
    .archive-current-link {
        align-self: start;
    }
}
</style>
