<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import {
    NAvatar,
    NSpin,
    NEmpty,
    NTag,
    NButton,
    NIcon,
    NAlert,
    NPagination,
    NTimeline,
    NTimelineItem,
    NTabs,
    NTabPane,
    useDialog,
    useMessage
} from 'naive-ui';
import {
    RefreshCw,
    CircleUserRound,
    Share2,
    Hammer,
    Rss,
    Copy,
    History,
    BookOpenText
} from 'lucide-vue-next';

import { getUserProfile, refreshUserProfile } from '@/api/user';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import { getUserArchiveStats, getUserRssUrl, type ArchiveStats } from '@/api/archive.ts';
import type { UserProfile } from '@/types/user';

import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import ArchiveTimeline from '@/components/ArchiveTimeline.vue';
import AuthorArticles from '@/components/AuthorArticles.vue';
import ProfileHistoryPanel from '@/components/ProfileHistoryPanel.vue';
import FollowAuthorButton from '@/components/FollowAuthorButton.vue';
import { archiveTabProps, selectedArchiveTabProps } from '@/utils/archive-tab-props';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { useContentSaver } from '@/composables/useContentSaver';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { getJudgementPermissionNames } from '@/utils/judgement.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';
import { authToken, currentAuth } from '@/utils/auth.ts';

const route = useRoute();
const message = useMessage();
const dialog = useDialog();
const { buildLuoguUrl } = useLuoguSource();
const {
    isSaving,
    hasUpdate,
    setupUpdateListener,
    setupTaskUpdateListener,
    handleRefresh,
    stopSaving
} = useContentSaver();

const loading = ref(true);
const profile = ref<UserProfile | null>(null);
const refreshing = ref(false);
const saveDialogShown = ref(false);
const profileError = ref<string | null>(null);
const archiveRefreshKey = ref(0);
const activeTab = ref(route.query.version === undefined ? 'timeline' : 'profile');
const stats = ref<ArchiveStats | null>(null);
const statsLoading = ref(false);
const statsError = ref<string | null>(null);
const copyingRss = ref(false);
let latestProfileRequestId = 0;
let latestStatsRequestId = 0;
let rssAlternateLink: HTMLLinkElement | null = null;
let profileDialog: ReturnType<typeof dialog.warning> | null = null;
let disposed = false;
let uidGeneration = 0;
const judgementLoading = ref(false);
const judgementError = ref<string | null>(null);
const judgements = ref<JudgementItem[]>([]);
const judgementTotal = ref(0);
const judgementPage = ref(1);
const JUDGEMENT_PAGE_SIZE = 10;
let latestJudgementRequestId = 0;

const uid = computed(() => {
    const raw = route.params.id;
    if (typeof raw !== 'string') return null;
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value <= 4294967295 ? value : null;
});

const colorClass = computed(() => `user-${profile.value?.color || 'Gray'}`);
const rssUrl = computed(() => (uid.value === null ? null : getUserRssUrl(uid.value)));
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
            throw new Error('Judgement records request failed');
        }
        judgements.value = response.data.items;
        judgementTotal.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestJudgementRequestId || requestedUid !== uid.value) return;
        judgementError.value = requestErrorMessage(error, '陶片记录加载失败，请重试。');
        judgements.value = [];
        judgementTotal.value = 0;
    } finally {
        if (requestId === latestJudgementRequestId) judgementLoading.value = false;
    }
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

function handleJudgementPageChange(page: number) {
    judgementPage.value = page;
    void loadUserJudgements();
}

const room = computed(() => (uid.value !== null ? `user_${uid.value}` : null));
const event = computed(() => (uid.value !== null ? `user:${uid.value}:profile-updated` : null));

let stopSaveTaskListener: (() => void) | null = null;
let stopProfileUpdateListener: (() => void) | null = null;

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
        () => Boolean(profile.value)
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
            promptSaveProfileIfNeeded();
        } else if (res.code !== 200 || !res.data) {
            profileError.value = '当前用户资料加载失败，请重试。';
        } else {
            profile.value = res.data;
            document.title = `${res.data.name}的用户归档 - 洛谷保存站`;
            stopSaving();
            saveDialogShown.value = false;
        }
    } catch (error) {
        if (requestId !== latestProfileRequestId || requestedUid !== uid.value) return;
        if (isAxiosError(error) && error.response?.status === 404) {
            profile.value = null;
            promptSaveProfileIfNeeded();
        } else {
            profileError.value = requestErrorMessage(error, '当前用户资料加载失败，请重试。');
        }
    } finally {
        if (requestId === latestProfileRequestId) loading.value = false;
    }
}

function trackSaveTask(taskId: string, targetUid: number, generation: number) {
    if (generation !== uidGeneration || disposed) return;
    stopSaveTaskListener?.();
    stopSaveTaskListener = setupTaskUpdateListener(
        taskId,
        () => {
            if (generation !== uidGeneration || disposed) return;
            stopSaveTaskListener = null;
            message.success('用户主页保存完成');
            markStarPromptEligible();
            saveDialogShown.value = false;
            archiveRefreshKey.value++;
            void reload(true);
        },
        () => {
            if (generation !== uidGeneration || disposed) return;
            stopSaveTaskListener = null;
            profileDialog = dialog.error({
                title: '保存失败',
                content: '用户主页保存过程中出现错误，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    if (generation !== uidGeneration || disposed) return;
                    try {
                        isSaving.value = true;
                        await submitProfileSave(targetUid);
                    } catch (error) {
                        if (generation !== uidGeneration || disposed) return;
                        message.error(requestErrorMessage(error, '保存请求提交失败，请重试。'));
                        stopSaving();
                        saveDialogShown.value = false;
                    }
                },
                onNegativeClick: () => {
                    if (generation !== uidGeneration || disposed) return;
                    stopSaving();
                    saveDialogShown.value = false;
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
    const response = await refreshUserProfile(targetUid);
    if (response.code !== 200 || !response.data?.taskId) {
        throw new Error('保存请求提交失败');
    }
    trackSaveTask(response.data.taskId, targetUid, generation);
    return response;
}

function promptSaveProfileIfNeeded() {
    const targetUid = uid.value;
    const generation = uidGeneration;
    if (
        targetUid === null ||
        saveDialogShown.value ||
        route.query.version !== undefined ||
        disposed
    )
        return;
    saveDialogShown.value = true;
    profileDialog = dialog.warning({
        title: '用户主页未收录',
        content: '该用户主页尚未被收录，是否立即发起保存任务？浏览归档列表不会自动抓取原站。',
        positiveText: '立即保存',
        negativeText: '取消',
        closable: false,
        closeOnEsc: false,
        maskClosable: false,
        onPositiveClick: async () => {
            if (generation !== uidGeneration || disposed) return;
            try {
                isSaving.value = true;
                await submitProfileSave(targetUid);
                if (generation === uidGeneration && !disposed) message.success('保存任务已提交');
            } catch (error) {
                if (generation !== uidGeneration || disposed) return;
                message.error(requestErrorMessage(error, '保存请求提交失败，请重试。'));
                stopSaving();
                saveDialogShown.value = false;
            }
        },
        onNegativeClick: () => {
            if (generation !== uidGeneration || disposed) return;
            stopSaving();
            saveDialogShown.value = false;
        }
    });
}

async function handleManualRefresh() {
    const targetUid = uid.value;
    const generation = uidGeneration;
    if (targetUid === null || refreshing.value) return;
    refreshing.value = true;
    try {
        await submitProfileSave(targetUid);
        if (generation === uidGeneration && !disposed)
            message.info('已请求刷新，完成后将提示更新当前资料和归档记录');
    } catch (error) {
        if (generation === uidGeneration && !disposed)
            message.error(requestErrorMessage(error, '刷新请求提交失败，请重试。'));
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
            statsError.value = '公开归档统计加载失败，请重试。';
            return;
        }
        stats.value = response.data;
    } catch (error) {
        if (requestId === latestStatsRequestId)
            statsError.value = requestErrorMessage(error, '公开归档统计加载失败，请重试。');
    } finally {
        if (requestId === latestStatsRequestId) statsLoading.value = false;
    }
}

async function copyRssUrl() {
    const url = rssUrl.value;
    if (!url || copyingRss.value) return;
    copyingRss.value = true;
    try {
        await navigator.clipboard.writeText(url);
        if (url === rssUrl.value && !disposed) message.success('RSS 地址已复制');
    } catch {
        if (url === rssUrl.value && !disposed)
            message.error('无法访问剪贴板，请从 RSS 订阅链接复制地址。');
    } finally {
        if (!disposed) copyingRss.value = false;
    }
}

watch(
    uid,
    () => {
        uidGeneration++;
        latestProfileRequestId++;
        latestJudgementRequestId++;
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
        copyingRss.value = false;
        judgements.value = [];
        judgementTotal.value = 0;
        judgementPage.value = 1;
        judgementError.value = null;
        judgementLoading.value = false;
        saveDialogShown.value = false;
        activeTab.value = route.query.version === undefined ? 'timeline' : 'profile';
        rssAlternateLink?.remove();
        rssAlternateLink = null;
        document.title = '用户归档 - 洛谷保存站';
        if (uid.value === null) {
            loading.value = false;
            return;
        }
        rssAlternateLink = document.createElement('link');
        rssAlternateLink.rel = 'alternate';
        rssAlternateLink.type = 'application/rss+xml';
        rssAlternateLink.title = `洛谷 UID ${uid.value} 的公开归档 RSS`;
        rssAlternateLink.href = getUserRssUrl(uid.value);
        document.head.appendChild(rssAlternateLink);
        setupProfileUpdateListener();
        void reload();
        void loadUserJudgements();
    },
    { immediate: true, flush: 'sync' }
);

watch(
    () => [uid.value, archiveRefreshKey.value],
    () => {
        latestStatsRequestId++;
        stats.value = null;
        statsError.value = null;
        statsLoading.value = false;
        void loadArchiveStats();
    },
    { immediate: true, flush: 'sync' }
);

watch(
    () => route.query.version,
    value => {
        if (value !== undefined) activeTab.value = 'profile';
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
    profileDialog?.destroy();
    rssAlternateLink?.remove();
    stopProfileUpdateListener?.();
    stopSaveTaskListener?.();
});
</script>

<template>
    <div class="user-profile-view">
        <CardTitle
            :title="
                profile
                    ? `${profile.name}的用户归档`
                    : uid === null
                      ? '用户归档'
                      : `洛谷 UID ${uid} 的用户归档`
            "
            :icon="CircleUserRound"
            >浏览本站已收录的文章、归档版本和公开资料快照。关注关系仅保存在你的登录账号内。</CardTitle
        >

        <n-alert v-if="uid === null" type="error">洛谷 UID 无效，无法读取用户归档。</n-alert>
        <template v-else>
            <Card title="当前用户身份" :icon="CircleUserRound">
                <template #header-extra>
                    <n-button
                        size="small"
                        secondary
                        tag="a"
                        :href="buildLuoguUrl(`/user/${uid}`)"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <template #icon
                            ><n-icon><Share2 /></n-icon
                        ></template>
                        原站主页
                    </n-button>
                </template>
                <n-alert v-if="profileError" type="error" class="archive-state-error">
                    {{ profileError }}
                    <div class="archive-state-actions">
                        <n-button :loading="loading" @click="reload()">重试当前资料</n-button>
                    </div>
                </n-alert>
                <n-spin
                    :show="loading || isSaving"
                    :description="isSaving ? '正在保存并处理…' : undefined"
                >
                    <div v-if="profile" class="archive-identity">
                        <div class="archive-identity-header">
                            <n-avatar
                                round
                                :size="56"
                                :src="`https://cdn.luogu.com.cn/upload/usericon/${profile.id}.png`"
                            />
                            <div class="archive-identity-copy">
                                <div class="archive-identity-name">
                                    <span :class="colorClass">{{ profile.name }}</span>
                                    <UserPrizeBadge
                                        v-if="profile.ccfLevel > 0 || profile.xcpcLevel > 0"
                                        :ccf-level="profile.ccfLevel"
                                        :xcpc-level="profile.xcpcLevel"
                                        :size="16"
                                    />
                                </div>
                                <p v-if="profile.slogan" class="archive-slogan">
                                    {{ profile.slogan }}
                                </p>
                            </div>
                        </div>
                        <dl class="archive-identity-fields">
                            <div>
                                <dt>洛谷 UID</dt>
                                <dd>{{ profile.id }}</dd>
                            </div>
                            <div v-if="profile.ccfLevel > 0">
                                <dt>OI 等级</dt>
                                <dd>{{ profile.ccfLevel }} 级</dd>
                            </div>
                            <div v-if="profile.xcpcLevel > 0">
                                <dt>ICPC/CCPC 等级</dt>
                                <dd>{{ profile.xcpcLevel }} 级</dd>
                            </div>
                            <div>
                                <dt>完整资料记录</dt>
                                <dd>
                                    <time
                                        v-if="profile.profileFetchedAt"
                                        :datetime="profile.profileFetchedAt"
                                        >{{ formatDate(profile.profileFetchedAt) }}</time
                                    ><template v-else>尚未拉取</template>
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <n-empty
                        v-else-if="!loading && !profileError"
                        description="当前用户资料尚未收录；归档列表只显示本站已有记录"
                    />
                    <p v-if="loading && !profile" class="archive-description" role="status">
                        正在读取当前用户资料…
                    </p>
                </n-spin>
                <div class="archive-identity-actions">
                    <FollowAuthorButton :uid="uid" />
                    <n-button
                        secondary
                        :loading="refreshing"
                        :disabled="refreshing || isSaving"
                        @click="handleManualRefresh"
                    >
                        <template #icon
                            ><n-icon><RefreshCw /></n-icon
                        ></template>
                        {{ profile ? '手动刷新资料' : '保存用户资料' }}
                    </n-button>
                    <span v-if="profile?.profileStale" class="archive-description">后台刷新中</span>
                    <n-button
                        secondary
                        tag="a"
                        :href="rssUrl ?? undefined"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <template #icon
                            ><n-icon><Rss /></n-icon
                        ></template>
                        RSS 订阅
                    </n-button>
                    <n-button secondary :loading="copyingRss" @click="copyRssUrl">
                        <template #icon
                            ><n-icon><Copy /></n-icon
                        ></template>
                        复制 RSS 地址
                    </n-button>
                </div>
                <p class="archive-avatar-notice">
                    此处始终展示当前身份；头像来自上游当前头像，不是历史头像。资料快照请在「资料与快照」中切换查看。
                </p>
            </Card>

            <Card title="公开归档统计" :icon="History">
                <n-alert v-if="statsError" type="error">
                    {{ statsError }}
                    <div class="archive-state-actions">
                        <n-button :loading="statsLoading" @click="loadArchiveStats"
                            >重试统计</n-button
                        >
                    </div>
                </n-alert>
                <p v-if="statsLoading" class="archive-description" role="status">
                    正在读取公开归档数量…
                </p>
                <dl v-else-if="stats && !statsError" class="archive-stats">
                    <div>
                        <dt>已收录文章</dt>
                        <dd>{{ stats.articles }}</dd>
                    </div>
                    <div>
                        <dt>追加文章归档版本</dt>
                        <dd>{{ stats.versions }}</dd>
                    </div>
                    <div>
                        <dt>公开资料快照</dt>
                        <dd>{{ stats.profiles }}</dd>
                    </div>
                </dl>
            </Card>

            <n-tabs v-model:value="activeTab" type="line" :animated="false" class="archive-tabs">
                <n-tab-pane
                    name="timeline"
                    tab="归档时间线"
                    display-directive="if"
                    :tab-props="
                        activeTab === 'timeline' ? selectedArchiveTabProps : archiveTabProps
                    "
                >
                    <Card title="归档时间线" :icon="History">
                        <ArchiveTimeline
                            :scope="{ type: 'user', uid }"
                            :refresh-key="archiveRefreshKey"
                        />
                    </Card>
                </n-tab-pane>
                <n-tab-pane
                    name="articles"
                    tab="作者文章"
                    display-directive="if"
                    :tab-props="
                        activeTab === 'articles' ? selectedArchiveTabProps : archiveTabProps
                    "
                >
                    <Card title="作者文章" :icon="BookOpenText">
                        <AuthorArticles :uid="uid" :refresh-key="archiveRefreshKey" />
                    </Card>
                </n-tab-pane>
                <n-tab-pane
                    name="profile"
                    tab="资料与快照"
                    display-directive="if"
                    :tab-props="activeTab === 'profile' ? selectedArchiveTabProps : archiveTabProps"
                >
                    <Card title="资料与快照" :icon="CircleUserRound">
                        <ProfileHistoryPanel
                            :uid="uid"
                            :current-profile="profile"
                            :current-loading="loading"
                            :current-error="profileError"
                            :refresh-key="archiveRefreshKey"
                            @cleared="archiveRefreshKey++"
                        />
                    </Card>
                </n-tab-pane>
                <n-tab-pane
                    name="judgements"
                    tab="陶片放逐"
                    display-directive="if"
                    :tab-props="
                        activeTab === 'judgements' ? selectedArchiveTabProps : archiveTabProps
                    "
                >
                    <Card class="archive-judgements" title="陶片放逐" :icon="Hammer">
                        <template #header-extra>
                            <span class="judgement-count">共 {{ judgementTotal }} 条</span>
                        </template>

                        <n-alert
                            v-if="judgementError"
                            class="judgement-error"
                            type="error"
                            :show-icon="true"
                        >
                            {{ judgementError }}
                            <div class="archive-state-actions">
                                <n-button :loading="judgementLoading" @click="loadUserJudgements"
                                    >重试陶片记录</n-button
                                >
                            </div>
                        </n-alert>

                        <n-spin :show="judgementLoading">
                            <n-empty
                                v-if="
                                    !judgementLoading && !judgementError && judgements.length === 0
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
                                        v-if="
                                            !item.hidden &&
                                            (item.revoked_permission || item.added_permission)
                                        "
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
                                    <div v-else-if="!item.hidden" class="judgement-no-permission">
                                        记录未包含权限位变更
                                    </div>
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
        </template>

        <div v-if="hasUpdate" class="update-floater">
            <n-button
                type="primary"
                circle
                size="large"
                class="shadow-button"
                aria-label="读取最新用户资料和归档记录"
                @click="triggerRefresh"
            >
                <template #icon
                    ><n-icon><RefreshCw /></n-icon
                ></template>
            </n-button>
        </div>
    </div>
</template>

<style scoped>
.user-profile-view {
    max-width: 1220px;
    margin: 0 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    overflow-wrap: anywhere;
}

.update-floater {
    position: fixed;
    bottom: var(--ui-space-8);
    left: 260px;
    z-index: 999;
}
.shadow-button {
    box-shadow: var(--ui-elevated-shadow);
}
.archive-description {
    margin: 0;
    color: var(--ui-secondary-text-color);
}
.archive-state-error {
    margin-bottom: var(--ui-space-4);
}
.archive-state-actions {
    margin-top: var(--ui-space-3);
}
.archive-identity {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: center;
    gap: var(--ui-space-5);
}
.archive-identity-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-4);
    min-width: 0;
}
.archive-identity-copy {
    min-width: 0;
}
.archive-identity-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    font-size: 18px;
    font-weight: 700;
}
.archive-slogan {
    margin: var(--ui-space-2) 0 0;
    color: var(--ui-secondary-text-color);
    white-space: pre-wrap;
}
.archive-identity-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
    margin: 0;
    min-width: 0;
}
.archive-identity-fields div {
    min-width: 0;
}
.archive-identity-fields dt {
    color: var(--ui-secondary-text-color);
}
.archive-identity-fields dd {
    margin: var(--ui-space-1) 0 0;
    color: var(--ui-text-color);
    font-variant-numeric: tabular-nums;
}
.archive-identity-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-4);
    min-width: 0;
}
.archive-avatar-notice {
    margin: var(--ui-space-3) 0 0;
    color: var(--ui-secondary-text-color);
}
.archive-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--ui-space-4);
    margin: 0;
}
.archive-stats div {
    min-width: 0;
}
.archive-stats dt {
    color: var(--ui-secondary-text-color);
}
.archive-stats dd {
    margin: var(--ui-space-2) 0 0;
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}
.archive-tabs {
    min-width: 0;
}
.archive-judgements {
    min-width: 0;
}
@media (max-width: 768px) {
    .archive-identity,
    .archive-stats {
        grid-template-columns: minmax(0, 1fr);
    }
    .archive-identity-actions {
        align-items: start;
    }
    .update-floater {
        left: var(--ui-space-4);
        bottom: var(--ui-space-12);
    }
}

.judgement-count {
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.judgement-error {
    margin-bottom: var(--ui-space-4);
}

.judgement-timeline {
    padding-top: var(--ui-space-2);
}

.judgement-permissions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    margin-top: var(--ui-space-1);
}

.judgement-no-permission {
    color: var(--ui-muted-text-color);
}

.judgement-reason {
    margin: var(--ui-space-2) 0 0;
    color: var(--ui-secondary-text-color);
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.judgement-pagination {
    display: flex;
    justify-content: center;
    margin-top: var(--ui-space-4);
    overflow-x: auto;
}
</style>
