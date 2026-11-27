<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import {
    NAlert,
    NAvatar,
    NButton,
    NEmpty,
    NIcon,
    NPagination,
    NSkeleton,
    NSpin,
    NTabPane,
    NTabs,
    NTag,
    NTimeline,
    NTimelineItem,
    NTooltip,
    useDialog,
    useMessage
} from 'naive-ui';
import { Check, Clock3, GitCompareArrows, RefreshCw } from 'lucide-vue-next';

import { getUserProfile, refreshUserProfile } from '@/api/user';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import {
    getProfileVersion,
    getProfileVersions,
    getUserArchiveStats,
    parsePositiveIntId,
    type ArchiveStats,
    type ProfileSnapshotData,
    type ProfileVersionMetadata,
    type ProfileVersionSnapshot
} from '@/api/archive.ts';
import type { UserProfile } from '@/types/user';

import Card from '@/components/Card.vue';
import LuoguSourceButton from '@/components/LuoguSourceButton.vue';
import SidebarWidget from '@/components/SidebarWidget.vue';
import AuthorArticles from '@/components/AuthorArticles.vue';
import UserBadge from '@/components/UserBadge.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import VersionCompareModal, {
    type CompareSnapshotContent,
    type CompareVersionOption
} from '@/components/VersionCompareModal.vue';
import ProfileSnapshotContent from './ProfileSnapshotContent.vue';

import { useContentSaver } from '@/composables/useContentSaver';
import {
    consumePendingProfileSyncTask,
    pendingProfileSyncTask
} from '@/composables/useProfileSyncTask';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { getJudgementPermissionNames } from '@/utils/judgement.ts';
import { goBackIgnoringHash } from '@/utils/navigation-history';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { authToken, currentAuth } from '@/utils/auth.ts';

const USER_COLOR_LABELS: Record<string, string> = {
    Purple: '紫名',
    Red: '红名',
    Orange: '橙名',
    Green: '绿名',
    Blue: '蓝名',
    Gray: '灰名',
    Cheater: '棕名'
};

// Keep `https://` out of inline template literals to avoid @vue/language-core 3.3.x comment-stripping misparses.
const getUserAvatarUrl = (id: number) => `https://cdn.luogu.com.cn/upload/usericon/${id}.png`;

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const {
    isSaving,
    hasUpdate,
    setupUpdateListener,
    setupTaskUpdateListener,
    handleRefresh,
    stopSaving,
    notifySaveCompleted
} = useContentSaver();

const loading = ref(true);
const profile = ref<UserProfile | null>(null);
const refreshing = ref(false);
const activeProfileTaskId = ref<string | null>(null);
const profileRefreshError = ref<string | null>(null);
const profileError = ref<string | null>(null);
const archiveRefreshKey = ref(0);
const activeTab = ref('profile');

const stats = ref<ArchiveStats | null>(null);
const statsLoading = ref(false);
const statsError = ref<string | null>(null);

const versions = ref<ProfileVersionMetadata[]>([]);
const versionsLoading = ref(false);
const versionsError = ref<string | null>(null);
const snapshot = ref<ProfileVersionSnapshot | null>(null);
const snapshotLoading = ref(false);
const snapshotError = ref<string | null>(null);
const snapshotCache = ref<Map<number, ProfileVersionSnapshot>>(new Map());

const compareOpen = ref(false);
const compareLeftVersion = ref<number | null>(null);
const compareRightVersion = ref<number | null>(null);
const compareLoading = ref(false);
const compareError = ref<string | null>(null);

const judgementLoading = ref(false);
const judgementError = ref<string | null>(null);
const judgements = ref<JudgementItem[]>([]);
const judgementTotal = ref(0);
const judgementPage = ref(1);
const JUDGEMENT_PAGE_SIZE = 10;

let latestProfileRequestId = 0;
let latestStatsRequestId = 0;
let latestJudgementRequestId = 0;
let versionsRequestId = 0;
let snapshotRequestId = 0;
let compareRequestId = 0;
let profileDialog: { destroy: () => void } | null = null;
let disposed = false;
let uidGeneration = 0;
let stopSaveTaskListener: (() => void) | null = null;
let stopProfileUpdateListener: (() => void) | null = null;

const uid = computed(() => parsePositiveIntId(route.params.id));
const hasVersionQuery = computed(() => route.query.version !== undefined);
const requestedVersion = computed(() => parsePositiveIntId(route.query.version));
const latestVersion = computed(() => versions.value[0]?.version ?? null);
const colorClass = computed(() => `user-${profile.value?.color || 'Gray'}`);
const room = computed(() => (uid.value !== null ? `user_${uid.value}` : null));
const event = computed(() => (uid.value !== null ? `user:${uid.value}:profile-updated` : null));

const currentLocation = computed(() => ({
    path: route.path,
    query: { ...route.query, version: undefined },
    hash: route.hash
}));

const compareOptions = computed<CompareVersionOption[]>(() =>
    versions.value.map((item, index) => ({
        value: item.version,
        label: `v${item.version}${index === 0 ? '（最新）' : ''} · ${formatDate(item.observedAt)} · ${item.name}`
    }))
);

const canCompare = computed(() => versions.value.length >= 2);
function toCompareContent(
    data: ProfileSnapshotData | UserProfile | null
): CompareSnapshotContent | null {
    if (!data) return null;
    const colorLabel = USER_COLOR_LABELS[data.color] ?? data.color;
    return {
        fields: [
            { label: '用户名', before: data.name, after: data.name },
            { label: '名字颜色', before: colorLabel, after: colorLabel },
            { label: 'OI 等级', before: `${data.ccfLevel} 级`, after: `${data.ccfLevel} 级` },
            {
                label: 'ICPC/CCPC 等级',
                before: `${data.xcpcLevel} 级`,
                after: `${data.xcpcLevel} 级`
            },
            { label: '个性签名', before: data.slogan || '', after: data.slogan || '' }
        ],
        listLabel: '获奖记录变更',
        listItems: (data.prizes ?? []).map(
            p => `[${p.year}] ${p.contest}${p.event ? ` ${p.event}` : ''} · ${p.prize}`
        ),
        textLabel: '个人介绍（Markdown 源码）',
        text: data.introduction || ''
    };
}

function resolveCachedProfile(version: number | null): ProfileSnapshotData | UserProfile | null {
    if (version === null) return null;
    if (version === 0) return profile.value;
    return snapshotCache.value.get(version)?.profile ?? null;
}

const compareLeftContent = computed(() =>
    toCompareContent(resolveCachedProfile(compareLeftVersion.value))
);
const compareRightContent = computed(() =>
    toCompareContent(resolveCachedProfile(compareRightVersion.value))
);

async function ensureCompareSnapshotsLoaded() {
    const targetUid = uid.value;
    if (targetUid === null || !compareOpen.value) return;

    const needed = [compareLeftVersion.value, compareRightVersion.value].filter(
        (v): v is number => v !== null && v > 0 && !snapshotCache.value.has(v)
    );
    if (needed.length === 0) {
        compareError.value = null;
        return;
    }

    const reqId = ++compareRequestId;
    compareLoading.value = true;
    compareError.value = null;
    try {
        const fetched = await Promise.all(
            [...new Set(needed)].map(async ver => {
                const res = await getProfileVersion(targetUid, ver);
                if (res.code !== 200 || !res.data) {
                    throw new Error(res.message || `加载快照 v${ver} 失败`);
                }
                return res.data;
            })
        );
        if (reqId !== compareRequestId || targetUid !== uid.value) return;
        const nextCache = new Map(snapshotCache.value);
        for (const item of fetched) {
            nextCache.set(item.version, item);
        }
        snapshotCache.value = nextCache;
    } catch (error) {
        if (reqId === compareRequestId) {
            compareError.value = requestErrorMessage(error, '加载比对快照失败');
        }
    } finally {
        if (reqId === compareRequestId) compareLoading.value = false;
    }
}

function openCompareModal(left?: number, right?: number) {
    if (!canCompare.value) return;
    const latest = latestVersion.value;
    const previous = versions.value[1]?.version ?? null;
    if (left !== undefined && right !== undefined) {
        compareLeftVersion.value = left;
        compareRightVersion.value = right;
    } else if (
        hasVersionQuery.value &&
        requestedVersion.value !== null &&
        latest !== null &&
        requestedVersion.value !== latest
    ) {
        compareLeftVersion.value = requestedVersion.value;
        compareRightVersion.value = latest;
    } else if (previous !== null && latest !== null) {
        compareLeftVersion.value = previous;
        compareRightVersion.value = latest;
    }
    compareOpen.value = true;
    void ensureCompareSnapshotsLoaded();
}

function compareSnapshotWithLatest(version: number) {
    if (latestVersion.value === null || version === latestVersion.value) return;
    openCompareModal(version, latestVersion.value);
}

function isVersionActive(version: number, index: number): boolean {
    if (hasVersionQuery.value) return requestedVersion.value === version;
    return index === 0;
}

function selectVersion(version: number) {
    activeTab.value = 'profile';
    const isLatest =
        version === 0 || (latestVersion.value !== null && version === latestVersion.value);
    void router.push({
        path: route.path,
        query: { ...route.query, version: isLatest ? undefined : String(version) },
        hash: route.hash
    });
}

function judgementTitle(item: JudgementItem): string {
    if (item.revoked_permission && item.added_permission) return '权限发生变更';
    if (item.revoked_permission) return '移除权限';
    if (item.added_permission) return '添加权限';
    return '无权限变更';
}

function judgementType(item: JudgementItem): 'success' | 'error' | 'warning' | 'default' {
    if (item.revoked_permission && item.added_permission) return 'warning';
    if (item.revoked_permission) return 'error';
    if (item.added_permission) return 'success';
    return 'default';
}

async function loadVersions() {
    const targetUid = uid.value;
    if (targetUid === null) return;
    const id = ++versionsRequestId;
    versionsLoading.value = true;
    versionsError.value = null;
    try {
        const response = await getProfileVersions(targetUid);
        if (id !== versionsRequestId || targetUid !== uid.value) return;
        if (response.code === 404) {
            versions.value = [];
            versionsError.value = null;
            return;
        }
        if (response.code !== 200) {
            versionsError.value = response.message || '历史快照列表加载失败';
            return;
        }
        versions.value = response.data.versions;
    } catch (error) {
        if (id === versionsRequestId) {
            if (isAxiosError(error) && error.response?.status === 404) {
                versions.value = [];
                versionsError.value = null;
            } else {
                versionsError.value = requestErrorMessage(error, '历史快照列表加载失败');
            }
        }
    } finally {
        if (id === versionsRequestId) versionsLoading.value = false;
    }
}

async function loadSnapshot() {
    const targetUid = uid.value;
    const id = ++snapshotRequestId;
    const version = requestedVersion.value;
    snapshot.value = null;
    snapshotError.value = null;
    snapshotLoading.value = false;
    if (!hasVersionQuery.value || targetUid === null) return;
    if (version === null) {
        snapshotError.value = '无效的版本号';
        return;
    }
    const cached = snapshotCache.value.get(version);
    if (cached) {
        snapshot.value = cached;
        return;
    }
    snapshotLoading.value = true;
    try {
        const response = await getProfileVersion(targetUid, version);
        if (id !== snapshotRequestId || targetUid !== uid.value) return;
        if (response.code !== 200) {
            snapshotError.value =
                response.code === 404 ? '该版本不存在' : response.message || '快照加载失败';
            return;
        }
        snapshot.value = response.data;
        const nextCache = new Map(snapshotCache.value);
        nextCache.set(version, response.data);
        snapshotCache.value = nextCache;
    } catch (error) {
        if (id === snapshotRequestId) {
            snapshotError.value = requestErrorMessage(error, '快照加载失败');
        }
    } finally {
        if (id === snapshotRequestId) snapshotLoading.value = false;
    }
}

async function loadUserJudgements() {
    const requestedUid = uid.value;
    if (requestedUid === null) return;
    const requestId = ++latestJudgementRequestId;
    judgementLoading.value = true;
    judgementError.value = null;
    try {
        const response = await getJudgements({
            page: judgementPage.value,
            limit: JUDGEMENT_PAGE_SIZE,
            uid: [requestedUid]
        });
        if (requestId !== latestJudgementRequestId || requestedUid !== uid.value) return;
        if (response.code !== 200) {
            throw new Error(response.message || '陶片记录加载失败');
        }
        judgements.value = response.data.items;
        judgementTotal.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestJudgementRequestId || requestedUid !== uid.value) return;
        judgementError.value = requestErrorMessage(error, '陶片记录加载失败');
        judgements.value = [];
        judgementTotal.value = 0;
    } finally {
        if (requestId === latestJudgementRequestId) judgementLoading.value = false;
    }
}

function handleJudgementPageChange(page: number) {
    judgementPage.value = page;
    void loadUserJudgements();
}

function setupProfileUpdateListener() {
    stopProfileUpdateListener?.();
    stopProfileUpdateListener = null;
    if (!room.value || !event.value) return;
    stopProfileUpdateListener = setupUpdateListener(
        room.value,
        event.value,
        () => {
            archiveRefreshKey.value++;
            void reload(true);
        },
        () => Boolean(profile.value) && !activeProfileTaskId.value
    );
}

async function reload(silent = false) {
    const requestedUid = uid.value;
    if (requestedUid === null) return;
    const requestId = ++latestProfileRequestId;
    if (!silent) loading.value = true;
    profileError.value = null;
    try {
        const res = await getUserProfile(requestedUid);
        if (requestId !== latestProfileRequestId || requestedUid !== uid.value) return;
        if (res.code === 404) {
            profile.value = null;
            document.title = `UID ${requestedUid} 未收录 - 洛谷保存站`;
        } else if (res.code !== 200 || !res.data) {
            profileError.value = res.message || '用户主页加载失败';
        } else {
            profile.value = res.data;
            document.title = `${res.data.name} 的用户归档 - 洛谷保存站`;
            stopSaving();
            if (!activeProfileTaskId.value) {
                if (res.data.profileRefreshTaskId) {
                    trackSaveTask(res.data.profileRefreshTaskId, requestedUid, uidGeneration, true);
                } else {
                    profileRefreshError.value = res.data.profileStale
                        ? '自动刷新失败，可点击刷新重试'
                        : null;
                }
            }
        }
    } catch (error) {
        if (requestId !== latestProfileRequestId || requestedUid !== uid.value) return;
        profileError.value = requestErrorMessage(error, '用户主页加载失败');
    } finally {
        if (requestId === latestProfileRequestId) loading.value = false;
    }
}

function trackSaveTask(taskId: string, targetUid: number, generation: number, background = false) {
    if (generation !== uidGeneration || disposed) return;
    stopSaveTaskListener?.();
    activeProfileTaskId.value = taskId;
    profileRefreshError.value = null;
    stopSaveTaskListener = setupTaskUpdateListener(
        taskId,
        (_data, meta) => {
            if (generation !== uidGeneration || disposed || activeProfileTaskId.value !== taskId)
                return;
            activeProfileTaskId.value = null;
            stopSaveTaskListener = null;
            if (!background) {
                notifySaveCompleted('用户主页已更新');
                markStarPromptEligible();
            }
            if (!meta?.alreadyRefreshed) {
                archiveRefreshKey.value++;
                void reload(true);
            }
        },
        (error: string) => {
            if (generation !== uidGeneration || disposed || activeProfileTaskId.value !== taskId)
                return;
            activeProfileTaskId.value = null;
            stopSaveTaskListener = null;
            const detail = error?.trim();
            if (background) {
                profileRefreshError.value = detail
                    ? `自动刷新失败：${detail}`
                    : '自动刷新失败，可点击刷新重试';
                return;
            }
            profileDialog = dialog.error({
                title: '保存失败',
                content: detail ? `用户主页保存失败：${detail}` : '用户主页保存失败，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    if (generation !== uidGeneration || disposed) return;
                    try {
                        isSaving.value = true;
                        await submitProfileSave(targetUid);
                    } catch (error) {
                        if (generation !== uidGeneration || disposed) return;
                        message.error(requestErrorMessage(error, '保存请求提交失败'));
                        stopSaving();
                    }
                },
                onNegativeClick: () => {
                    if (generation !== uidGeneration || disposed) return;
                    stopSaving();
                },
                maskClosable: false,
                closable: false,
                closeOnEsc: false
            });
        }
    );
}

async function submitProfileSave(targetUid: number) {
    const generation = uidGeneration;
    profileRefreshError.value = null;
    const response = await refreshUserProfile(targetUid);
    if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.message || '保存请求提交失败');
    }
    trackSaveTask(response.data.taskId, targetUid, generation);
    return response;
}

async function handleManualRefresh() {
    const targetUid = uid.value;
    const generation = uidGeneration;
    if (targetUid === null || refreshing.value || activeProfileTaskId.value) return;
    refreshing.value = true;
    try {
        await submitProfileSave(targetUid);
        if (generation === uidGeneration && !disposed) message.info('已提交刷新任务');
    } catch (error) {
        if (generation === uidGeneration && !disposed)
            message.error(requestErrorMessage(error, '刷新请求提交失败'));
    } finally {
        if (generation === uidGeneration && !disposed) refreshing.value = false;
    }
}

function triggerRefresh() {
    handleRefresh(() => {
        archiveRefreshKey.value++;
        void reload(true);
    });
}

async function loadArchiveStats() {
    const requestedUid = uid.value;
    if (requestedUid === null) return;
    const requestId = ++latestStatsRequestId;
    statsLoading.value = true;
    statsError.value = null;
    try {
        const response = await getUserArchiveStats(requestedUid);
        if (requestId !== latestStatsRequestId) return;
        if (response.code !== 200) {
            statsError.value = response.message || '归档统计加载失败';
            return;
        }
        stats.value = response.data;
    } catch (error) {
        if (requestId === latestStatsRequestId)
            statsError.value = requestErrorMessage(error, '归档统计加载失败');
    } finally {
        if (requestId === latestStatsRequestId) statsLoading.value = false;
    }
}

watch(
    uid,
    () => {
        uidGeneration++;
        latestProfileRequestId++;
        latestJudgementRequestId++;
        versionsRequestId++;
        snapshotRequestId++;
        compareRequestId++;
        stopProfileUpdateListener?.();
        stopProfileUpdateListener = null;
        stopSaveTaskListener?.();
        stopSaveTaskListener = null;
        profileDialog?.destroy();
        profileDialog = null;
        stopSaving();
        hasUpdate.value = false;
        profile.value = null;
        profileError.value = null;
        refreshing.value = false;
        activeProfileTaskId.value = null;
        profileRefreshError.value = null;
        versions.value = [];
        versionsError.value = null;
        snapshot.value = null;
        snapshotError.value = null;
        snapshotCache.value = new Map();
        compareOpen.value = false;
        compareLeftVersion.value = null;
        compareRightVersion.value = null;
        compareError.value = null;
        judgements.value = [];
        judgementTotal.value = 0;
        judgementPage.value = 1;
        judgementError.value = null;
        judgementLoading.value = false;
        activeTab.value = 'profile';
        document.title = '用户归档 - 洛谷保存站';
        if (uid.value === null) {
            loading.value = false;
            return;
        }
        setupProfileUpdateListener();
        void reload();
        void loadUserJudgements();
    },
    { immediate: true, flush: 'sync' }
);

watch(
    [uid, pendingProfileSyncTask],
    ([currentUid]) => {
        if (currentUid === null) return;
        const pending = consumePendingProfileSyncTask(currentUid);
        if (pending) {
            trackSaveTask(pending.taskId, pending.uid, uidGeneration, false);
        }
    },
    { immediate: true }
);

watch(
    () => [uid.value, archiveRefreshKey.value],
    () => {
        latestStatsRequestId++;
        stats.value = null;
        statsError.value = null;
        statsLoading.value = false;
        snapshotCache.value = new Map();
        if (uid.value !== null) {
            void loadArchiveStats();
            void loadVersions();
        }
    },
    { immediate: true, flush: 'sync' }
);

watch(
    () => [uid.value, archiveRefreshKey.value, route.query.version],
    () => {
        if (route.query.version !== undefined) activeTab.value = 'profile';
        void loadSnapshot();
    },
    { immediate: true, flush: 'sync' }
);

watch(
    () => [compareOpen.value, compareLeftVersion.value, compareRightVersion.value],
    () => {
        if (compareOpen.value) void ensureCompareSnapshotsLoaded();
    }
);

watch(
    () => [authToken.value, currentAuth.value?.role],
    () => {
        latestJudgementRequestId++;
        judgements.value = [];
        judgementTotal.value = 0;
        judgementPage.value = 1;
        judgementError.value = null;
        judgementLoading.value = false;
        void loadUserJudgements();
    },
    { flush: 'sync' }
);

onUnmounted(() => {
    disposed = true;
    latestProfileRequestId++;
    latestStatsRequestId++;
    latestJudgementRequestId++;
    versionsRequestId++;
    snapshotRequestId++;
    compareRequestId++;
    profileDialog?.destroy();
    stopProfileUpdateListener?.();
    stopSaveTaskListener?.();
});
</script>

<template>
    <div class="user-profile-page">
        <n-alert v-if="uid === null" type="error">无效的洛谷 UID</n-alert>

        <div v-else class="profile-layout">
            <aside class="profile-rail">
                <Card class="identity-card">
                    <n-alert v-if="profileError" type="error" class="identity-alert">
                        {{ profileError }}
                        <div class="state-actions">
                            <n-button size="small" :loading="loading" @click="reload()">
                                重试
                            </n-button>
                        </div>
                    </n-alert>

                    <n-spin
                        :show="isSaving"
                        :description="isSaving ? '正在保存并处理…' : undefined"
                    >
                        <div v-if="loading && !profile" class="identity-skeleton" role="status">
                            <div class="identity-top">
                                <n-skeleton circle :width="60" :height="60" />
                                <div class="identity-skeleton-lines">
                                    <n-skeleton text style="width: 120px" />
                                    <n-skeleton text style="width: 72px" />
                                </div>
                            </div>
                            <n-skeleton text :repeat="2" />
                        </div>

                        <div v-else-if="profile" class="identity-body">
                            <div class="identity-top">
                                <n-avatar
                                    round
                                    :size="60"
                                    class="identity-avatar"
                                    :src="getUserAvatarUrl(profile.id)"
                                />
                                <div class="identity-heading">
                                    <h1 class="identity-name" :class="colorClass">
                                        <span>{{ profile.name }}</span>
                                        <UserPrizeBadge
                                            v-if="profile.ccfLevel > 0 || profile.xcpcLevel > 0"
                                            :ccf-level="profile.ccfLevel"
                                            :xcpc-level="profile.xcpcLevel"
                                            :size="16"
                                        />
                                        <UserBadge v-if="profile.badge" :content="profile.badge" />
                                    </h1>
                                    <span class="identity-uid">UID {{ profile.id }}</span>
                                </div>
                            </div>

                            <p v-if="profile.slogan" class="identity-slogan">
                                {{ profile.slogan }}
                            </p>

                            <div v-if="stats && !statsError" class="identity-stats">
                                <button
                                    type="button"
                                    class="stat-pill"
                                    @click="activeTab = 'articles'"
                                >
                                    <strong>{{ stats.articles }}</strong>
                                    <span>文章</span>
                                </button>
                                <button
                                    type="button"
                                    class="stat-pill"
                                    @click="activeTab = 'articles'"
                                >
                                    <strong>{{ stats.versions }}</strong>
                                    <span>修订</span>
                                </button>
                                <button
                                    type="button"
                                    class="stat-pill"
                                    @click="activeTab = 'profile'"
                                >
                                    <strong>{{ stats.profiles }}</strong>
                                    <span>快照</span>
                                </button>
                            </div>
                            <n-alert v-else-if="statsError" type="error" class="identity-alert">
                                {{ statsError }}
                                <div class="state-actions">
                                    <n-button
                                        size="small"
                                        :loading="statsLoading"
                                        @click="loadArchiveStats"
                                    >
                                        重试
                                    </n-button>
                                </div>
                            </n-alert>

                            <dl class="identity-meta">
                                <div v-if="profile.ccfLevel > 0">
                                    <dt>OI 等级</dt>
                                    <dd>{{ profile.ccfLevel }} 级</dd>
                                </div>
                                <div v-if="profile.xcpcLevel > 0">
                                    <dt>ICPC/CCPC</dt>
                                    <dd>{{ profile.xcpcLevel }} 级</dd>
                                </div>
                                <div>
                                    <dt>主页更新</dt>
                                    <dd>
                                        <time
                                            v-if="profile.profileFetchedAt"
                                            :datetime="profile.profileFetchedAt"
                                        >
                                            {{ formatDate(profile.profileFetchedAt) }}
                                        </time>
                                        <template v-else>尚未拉取</template>
                                    </dd>
                                </div>
                            </dl>
                        </div>

                        <div v-else-if="!loading && !profileError" class="identity-empty">
                            <h1 class="identity-name">洛谷 UID {{ uid }}</h1>
                            <p class="identity-slogan">该用户主页尚未收录</p>
                        </div>
                    </n-spin>

                    <div class="identity-actions">
                        <n-button
                            size="small"
                            secondary
                            class="identity-action-btn"
                            :loading="refreshing || Boolean(activeProfileTaskId)"
                            :disabled="refreshing || isSaving || Boolean(activeProfileTaskId)"
                            @click="handleManualRefresh"
                        >
                            <template #icon>
                                <n-icon :component="RefreshCw" />
                            </template>
                            {{
                                activeProfileTaskId || refreshing
                                    ? '后台刷新中'
                                    : profile
                                      ? '刷新主页'
                                      : '保存主页'
                            }}
                        </n-button>
                        <LuoguSourceButton :path="`/user/${uid}`" size="small" block />
                    </div>

                    <div
                        v-if="
                            profile?.profileStale &&
                            !activeProfileTaskId &&
                            !refreshing &&
                            !profileRefreshError
                        "
                        class="identity-stale-hint"
                    >
                        本地主页较旧，可点击「刷新主页」同步最新内容
                    </div>

                    <n-alert v-if="profileRefreshError" type="error" class="identity-refresh-error">
                        {{ profileRefreshError }}
                    </n-alert>
                </Card>

                <SidebarWidget
                    v-if="versionsLoading || versions.length > 0 || versionsError"
                    :title="versions.length ? `主页快照 (${versions.length})` : '主页快照'"
                    :icon="Clock3"
                    class="snapshot-rail-card"
                >
                    <template #header-extra>
                        <n-button
                            v-if="canCompare"
                            size="tiny"
                            quaternary
                            @click="openCompareModal()"
                        >
                            <template #icon>
                                <n-icon :component="GitCompareArrows" />
                            </template>
                            比对
                        </n-button>
                    </template>

                    <div v-if="versionsLoading && !versions.length" class="version-skeleton">
                        <n-skeleton text style="width: 80%" />
                        <n-skeleton text style="width: 65%" />
                        <n-skeleton text style="width: 72%" />
                    </div>

                    <n-alert v-else-if="versionsError" type="error">
                        {{ versionsError }}
                        <div class="state-actions">
                            <n-button size="small" :loading="versionsLoading" @click="loadVersions">
                                重试
                            </n-button>
                        </div>
                    </n-alert>

                    <ul v-else class="version-list" aria-label="主页历史快照列表">
                        <li
                            v-for="(ver, index) in versions"
                            :key="ver.version"
                            class="version-list-entry"
                        >
                            <div
                                class="version-row-wrap"
                                :class="{ 'is-active': isVersionActive(ver.version, index) }"
                            >
                                <button
                                    type="button"
                                    class="version-item"
                                    :class="{ 'is-active': isVersionActive(ver.version, index) }"
                                    :aria-current="
                                        isVersionActive(ver.version, index) ? 'true' : undefined
                                    "
                                    @click="selectVersion(ver.version)"
                                >
                                    <span class="version-dot" aria-hidden="true" />
                                    <span class="version-item-top">
                                        <span class="version-item-heading">
                                            <span class="version-number">
                                                快照 v{{ ver.version }}
                                            </span>
                                            <span v-if="index === 0" class="version-latest-badge">
                                                最新
                                            </span>
                                        </span>
                                        <n-icon
                                            v-if="isVersionActive(ver.version, index)"
                                            :component="Check"
                                            :size="14"
                                            class="version-active-icon"
                                        />
                                    </span>
                                    <span class="version-item-title">{{ ver.name }}</span>
                                    <time class="version-item-time" :datetime="ver.observedAt">
                                        {{ formatDate(ver.observedAt) }}
                                    </time>
                                </button>
                                <n-tooltip v-if="canCompare && index > 0" :delay="150">
                                    <template #trigger>
                                        <button
                                            type="button"
                                            class="version-quick-compare"
                                            :aria-label="`将快照 v${ver.version} 与最新快照比对`"
                                            @click.stop="compareSnapshotWithLatest(ver.version)"
                                        >
                                            <n-icon :component="GitCompareArrows" :size="14" />
                                        </button>
                                    </template>
                                    与最新比对
                                </n-tooltip>
                            </div>
                        </li>
                    </ul>
                </SidebarWidget>
            </aside>

            <main class="profile-main">
                <n-tabs
                    v-model:value="activeTab"
                    type="line"
                    :animated="false"
                    class="profile-tabs"
                >
                    <n-tab-pane name="profile" tab="个人主页" display-directive="if">
                        <ProfileSnapshotContent
                            :uid="uid"
                            :current-profile="profile"
                            :historical="hasVersionQuery"
                            :requested-version="requestedVersion"
                            :snapshot="snapshot"
                            :snapshot-loading="snapshotLoading"
                            :snapshot-error="snapshotError"
                            :versions="versions"
                            :versions-loading="versionsLoading"
                            :can-compare="canCompare"
                            :current-location="currentLocation"
                            :loading="loading || Boolean(profileError)"
                            :saving="refreshing || isSaving || Boolean(activeProfileTaskId)"
                            @select-version="selectVersion"
                            @compare-with-current="compareSnapshotWithLatest"
                            @open-compare="openCompareModal()"
                            @retry-snapshot="loadSnapshot"
                            @go-back="goBackIgnoringHash(router)"
                            @save-missing="handleManualRefresh"
                        />
                    </n-tab-pane>

                    <n-tab-pane
                        name="articles"
                        :tab="stats ? `归档文章 (${stats.articles})` : '归档文章'"
                        display-directive="if"
                    >
                        <Card>
                            <AuthorArticles :uid="uid" :refresh-key="archiveRefreshKey" />
                        </Card>
                    </n-tab-pane>

                    <n-tab-pane
                        name="judgements"
                        :tab="judgementTotal > 0 ? `陶片放逐 (${judgementTotal})` : '陶片放逐'"
                        display-directive="if"
                    >
                        <Card>
                            <n-alert
                                v-if="judgementError"
                                class="judgement-error"
                                type="error"
                                :show-icon="true"
                            >
                                {{ judgementError }}
                                <div class="state-actions">
                                    <n-button
                                        size="small"
                                        :loading="judgementLoading"
                                        @click="loadUserJudgements"
                                    >
                                        重试
                                    </n-button>
                                </div>
                            </n-alert>

                            <n-spin :show="judgementLoading">
                                <n-empty
                                    v-if="
                                        !judgementLoading &&
                                        !judgementError &&
                                        judgements.length === 0
                                    "
                                    description="该用户暂无陶片记录"
                                />

                                <n-timeline v-else class="judgement-timeline">
                                    <n-timeline-item
                                        v-for="item in judgements"
                                        :key="item.id"
                                        :title="judgementTitle(item)"
                                        :type="judgementType(item)"
                                        :time="formatDate(item.time * 1000)"
                                    >
                                        <div
                                            v-if="item.revoked_permission || item.added_permission"
                                            class="judgement-permissions"
                                        >
                                            <n-tag
                                                v-for="name in getJudgementPermissionNames(
                                                    item.revoked_permission
                                                )"
                                                :key="`revoked-${item.id}-${name}`"
                                                size="small"
                                                type="error"
                                                :bordered="false"
                                            >
                                                − {{ name }}
                                            </n-tag>
                                            <n-tag
                                                v-for="name in getJudgementPermissionNames(
                                                    item.added_permission
                                                )"
                                                :key="`added-${item.id}-${name}`"
                                                size="small"
                                                type="success"
                                                :bordered="false"
                                            >
                                                + {{ name }}
                                            </n-tag>
                                        </div>
                                        <div v-else class="judgement-no-permission">无权限变更</div>
                                        <p v-if="item.reason" class="judgement-reason">
                                            {{ item.reason }}
                                        </p>
                                    </n-timeline-item>
                                </n-timeline>
                            </n-spin>

                            <div
                                v-if="judgementTotal > JUDGEMENT_PAGE_SIZE"
                                class="judgement-pagination"
                            >
                                <n-pagination
                                    :page="judgementPage"
                                    :page-size="JUDGEMENT_PAGE_SIZE"
                                    :item-count="judgementTotal"
                                    @update:page="handleJudgementPageChange"
                                />
                            </div>
                        </Card>
                    </n-tab-pane>
                </n-tabs>
            </main>
        </div>

        <VersionCompareModal
            v-model:show="compareOpen"
            v-model:left-version="compareLeftVersion"
            v-model:right-version="compareRightVersion"
            title="主页快照比对"
            :options="compareOptions"
            :left-content="compareLeftContent"
            :right-content="compareRightContent"
            :loading="compareLoading"
            :error="compareError"
            @retry="ensureCompareSnapshotsLoaded"
        />

        <Transition name="ui-float-up">
            <div v-if="hasUpdate" class="update-floater">
                <n-button
                    type="primary"
                    circle
                    size="large"
                    class="shadow-button"
                    aria-label="刷新最新主页"
                    @click="triggerRefresh"
                >
                    <template #icon>
                        <n-icon :component="RefreshCw" />
                    </template>
                </n-button>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.user-profile-page {
    max-width: 1200px;
    margin: 0 auto;
    min-width: 0;
    overflow-wrap: anywhere;
}

.profile-layout {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: var(--ui-space-6);
    align-items: start;
}

.profile-rail {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    min-width: 0;
    max-height: calc(100dvh - var(--ui-page-padding) * 2);
}

.profile-main {
    min-width: 0;
}

.identity-body,
.identity-skeleton,
.identity-empty {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.identity-top {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
}

.identity-avatar {
    flex-shrink: 0;
}

.identity-heading {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.identity-skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    flex: 1;
}

.identity-name {
    margin: 0;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-family: var(--ui-font-family-display);
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
}

.identity-uid {
    font-family: var(--ui-font-family-mono);
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.identity-slogan {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ui-secondary-text-color);
}

.identity-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--ui-space-2);
    padding: var(--ui-space-2) 0;
    border-top: 1px solid var(--ui-border-color);
    border-bottom: 1px solid var(--ui-border-color);
}

.stat-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    cursor: pointer;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.stat-pill:hover {
    background: var(--ui-panel-color);
}

.stat-pill strong {
    font-size: 16px;
    font-weight: 700;
    color: var(--ui-card-title-color);
    font-variant-numeric: tabular-nums;
}

.stat-pill span {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.identity-meta {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
}

.identity-meta > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--ui-space-2);
}

.identity-meta dt {
    color: var(--ui-muted-text-color);
    flex-shrink: 0;
}

.identity-meta dd {
    margin: 0;
    color: var(--ui-text-color);
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.identity-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-4);
}

.identity-action-btn {
    width: 100%;
}

.identity-stale-hint {
    margin-top: var(--ui-space-2);
    font-size: 12px;
    color: var(--ui-muted-text-color);
    line-height: 1.5;
}

.identity-alert,
.identity-refresh-error {
    margin-top: var(--ui-space-3);
}

.identity-alert {
    margin-top: 0;
    margin-bottom: var(--ui-space-3);
}

.state-actions {
    display: flex;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-2);
}

.snapshot-rail-card {
    margin-bottom: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.snapshot-rail-card :deep(.widget-content) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
}

.version-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: var(--ui-space-1) 0;
}

.version-list {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
}

.version-list::before {
    content: '';
    position: absolute;
    left: 11px;
    top: 14px;
    bottom: 14px;
    width: 1px;
    background: var(--ui-border-color);
}

.version-list-entry {
    position: relative;
}

.version-row-wrap {
    position: relative;
    display: flex;
    align-items: center;
}

.version-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    padding: 8px 11px 8px 26px;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.version-item:hover {
    background: var(--ui-panel-color);
}

.version-item.is-active {
    background: var(--ui-panel-color);
}

.version-dot {
    position: absolute;
    left: 7px;
    top: 14px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ui-control-border-hover-color);
    box-shadow: 0 0 0 2px var(--ui-card-color);
}

.version-item.is-active .version-dot {
    background: var(--ui-primary-color);
}

.version-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
}

.version-item-heading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.version-number {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-card-title-color);
    font-variant-numeric: tabular-nums;
}

.version-item.is-active .version-number {
    color: var(--ui-primary-color);
}

.version-latest-badge {
    padding: 0 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-alert-success-background-color);
    color: var(--ui-success-color);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
}

.version-active-icon {
    color: var(--ui-primary-color);
    flex-shrink: 0;
}

.version-item-title {
    font-size: 12px;
    color: var(--ui-secondary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.version-item-time {
    padding-right: 26px;
    font-size: 11px;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.version-quick-compare {
    position: absolute;
    right: 6px;
    bottom: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-muted-text-color);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity var(--ui-motion-fast) var(--ui-motion-ease),
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.version-row-wrap:hover .version-quick-compare,
.version-row-wrap:focus-within .version-quick-compare {
    opacity: 1;
}

.version-quick-compare:hover {
    background: var(--ui-control-tag-color);
    color: var(--ui-primary-color);
}

.version-quick-compare:active {
    transform: scale(0.92);
}

.profile-tabs :deep(.n-tabs-nav) {
    margin-bottom: var(--ui-space-4);
}

.judgement-error {
    margin-bottom: var(--ui-space-4);
}

.judgement-timeline {
    padding: var(--ui-space-1) 0;
}

.judgement-permissions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-1);
    margin-bottom: var(--ui-space-2);
}

.judgement-no-permission {
    font-size: 12px;
    color: var(--ui-muted-text-color);
    margin-bottom: var(--ui-space-1);
}

.judgement-reason {
    margin: 0;
    font-size: 13px;
    color: var(--ui-secondary-text-color);
    white-space: pre-wrap;
}

.judgement-pagination {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--ui-space-4);
}

.update-floater {
    position: fixed;
    bottom: calc(var(--ui-space-6) + env(safe-area-inset-bottom, 0px));
    left: calc(var(--ui-sider-current-width, 0px) + var(--ui-space-6));
    z-index: 999;
}

.shadow-button {
    box-shadow: var(--ui-elevated-shadow);
}

@media (max-width: 960px) {
    .profile-layout {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--ui-space-4);
    }

    .profile-rail {
        position: static;
        max-height: none;
    }

    .snapshot-rail-card {
        display: none;
    }
}
</style>
