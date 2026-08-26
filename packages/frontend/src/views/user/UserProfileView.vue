<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
    NAvatar,
    NSpin,
    NEmpty,
    NTag,
    NTime,
    NButton,
    NIcon,
    NTooltip,
    NAlert,
    NPagination,
    NTimeline,
    NTimelineItem,
    useDialog,
    useMessage
} from 'naive-ui';
import { RefreshCw, Trophy, BookOpenText, CircleUserRound, Share2, Hammer } from 'lucide-vue-next';

import { getUserProfile, refreshUserProfile } from '@/api/user';
import { getJudgements, type JudgementItem } from '@/api/judgement.ts';
import type { UserProfile } from '@/types/user';

import Card from '@/components/Card.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { useContentSaver } from '@/composables/useContentSaver';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { getJudgementPermissionNames } from '@/utils/judgement.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { formatDate } from '@/utils/render.ts';

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
    return Number(raw);
});

const colorClass = computed(() => `user-${profile.value?.color || 'Gray'}`);

// Award level → tag type mapping. The strings are free-form from Luogu, so we use
// substring matching on the user-visible terms.
function prizeTagType(prize: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
    if (prize.includes('金')) return 'warning';
    if (prize.includes('银')) return 'default';
    if (prize.includes('铜')) return 'error';
    if (prize.includes('一等')) return 'warning';
    if (prize.includes('二等')) return 'default';
    if (prize.includes('三等')) return 'error';
    return 'info';
}

// Prizes are pre-sorted by Luogu in chronological order. Reverse for display so the
// most recent contest appears at the top.
const orderedPrizes = computed(() => {
    if (!profile.value?.prizes) return [];
    return [...profile.value.prizes].reverse();
});

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
        if (response.code !== 200) throw new Error(response.message || '接口返回失败状态');
        judgements.value = response.data.items;
        judgementTotal.value = response.data.pagination.total;
    } catch (error) {
        if (requestId !== latestJudgementRequestId || requestedUid !== uid.value) return;
        judgementError.value = error instanceof Error ? error.message : String(error);
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
            void reload();
        },
        () => Boolean(profile.value)
    );
}

async function reload(silent = false) {
    if (uid.value === null) return;
    if (!silent) loading.value = true;
    try {
        const res = await getUserProfile(uid.value);
        if (res.code !== 200 || !res.data) {
            profile.value = null;
            promptSaveProfileIfNeeded();
        } else {
            profile.value = res.data;
            document.title = `${res.data.name} - 洛谷保存站`;
            stopSaving();
            saveDialogShown.value = false;
        }
    } catch (e: any) {
        const status = e?.response?.status;
        if (status === 404) {
            profile.value = null;
            promptSaveProfileIfNeeded();
        } else {
            message.error(e?.message || '加载用户信息失败');
        }
    } finally {
        if (!silent) loading.value = false;
    }
}

function trackSaveTask(taskId?: string) {
    if (!taskId) return;
    stopSaveTaskListener?.();
    stopSaveTaskListener = setupTaskUpdateListener(
        taskId,
        () => {
            stopSaveTaskListener = null;
            message.success('用户主页保存完成');
            markStarPromptEligible();
            saveDialogShown.value = false;
            void reload();
        },
        error => {
            stopSaveTaskListener = null;
            dialog.error({
                title: '保存失败',
                content: error || '用户主页保存过程中出现错误，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    isSaving.value = true;
                    await submitProfileSave();
                },
                onNegativeClick: () => {
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

async function submitProfileSave() {
    if (uid.value === null) throw new Error('无效的用户 ID');
    const response = await refreshUserProfile(uid.value);
    if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.message || '保存请求提交失败');
    }
    trackSaveTask(response.data.taskId);
    return response;
}

function promptSaveProfileIfNeeded() {
    if (uid.value === null || saveDialogShown.value) return;
    saveDialogShown.value = true;
    dialog.warning({
        title: '用户主页未收录',
        content: '该用户主页尚未被收录，是否立即发起保存任务？',
        positiveText: '立即保存',
        negativeText: '取消',
        closable: false,
        closeOnEsc: false,
        maskClosable: false,
        onPositiveClick: async () => {
            try {
                isSaving.value = true;
                await submitProfileSave();
                message.success('保存任务已提交');
            } catch (e: any) {
                message.error(e.message || '保存失败');
                stopSaving();
                saveDialogShown.value = false;
            }
        },
        onNegativeClick: () => {
            stopSaving();
            saveDialogShown.value = false;
        }
    });
}

async function handleManualRefresh() {
    if (uid.value === null || refreshing.value) return;
    refreshing.value = true;
    try {
        const response = await refreshUserProfile(uid.value);
        trackSaveTask(response.data?.taskId);
        message.info('已请求刷新,稍后将自动更新');
    } catch (e: any) {
        message.error(e?.message || '刷新失败');
    } finally {
        refreshing.value = false;
    }
}

function triggerRefresh() {
    handleRefresh(() => {
        void reload();
    });
}

watch(uid, async () => {
    stopProfileUpdateListener?.();
    stopProfileUpdateListener = null;
    profile.value = null;
    latestJudgementRequestId++;
    judgements.value = [];
    judgementTotal.value = 0;
    judgementPage.value = 1;
    judgementError.value = null;
    judgementLoading.value = false;
    saveDialogShown.value = false;
    stopSaveTaskListener?.();
    stopSaveTaskListener = null;
    if (uid.value === null) {
        loading.value = false;
        return;
    }
    await Promise.all([reload(), loadUserJudgements()]);
    setupProfileUpdateListener();
});

onMounted(async () => {
    if (uid.value === null) {
        loading.value = false;
        return;
    }
    await Promise.all([reload(), loadUserJudgements()]);
    setupProfileUpdateListener();
});

onUnmounted(() => {
    stopProfileUpdateListener?.();
    stopSaveTaskListener?.();
});
</script>

<template>
    <div class="user-profile-view">
        <n-spin
            :show="loading || isSaving"
            :description="isSaving ? '正在保存并处理...' : undefined"
        >
            <div v-if="profile" class="profile-grid">
                <!-- LEFT COLUMN: introduction (Markdown) -->
                <div class="profile-left">
                    <Card
                        class="profile-card profile-card--intro"
                        title="个人介绍"
                        :icon="BookOpenText"
                    >
                        <MarkdownViewer
                            v-if="profile.introduction"
                            :content="profile.introduction"
                        />
                        <n-empty v-else description="该用户暂无个人介绍" />
                    </Card>
                </div>

                <!-- RIGHT COLUMN: identity card + compact prizes list -->
                <div class="profile-right">
                    <Card
                        class="profile-card profile-card--identity"
                        title="用户主页"
                        :icon="CircleUserRound"
                    >
                        <template #header-extra>
                            <n-button
                                size="small"
                                secondary
                                tag="a"
                                :href="buildLuoguUrl(`/user/${profile.id}`)"
                                target="_blank"
                            >
                                <template #icon>
                                    <n-icon><Share2 /></n-icon>
                                </template>
                                原站
                            </n-button>
                        </template>

                        <div class="identity-header">
                            <n-avatar
                                round
                                :size="56"
                                :src="`https://cdn.luogu.com.cn/upload/usericon/${profile.id}.png`"
                            />
                            <div class="identity-name-block">
                                <div class="identity-name-row">
                                    <span class="identity-name user-name" :class="colorClass">
                                        {{ profile.name }}
                                    </span>
                                    <UserPrizeBadge
                                        v-if="profile.ccfLevel > 0 || profile.xcpcLevel > 0"
                                        :ccf-level="profile.ccfLevel"
                                        :xcpc-level="profile.xcpcLevel"
                                        :size="16"
                                    />
                                </div>
                                <div v-if="profile.slogan" class="identity-slogan">
                                    {{ profile.slogan }}
                                </div>
                            </div>
                        </div>

                        <dl class="identity-fields">
                            <div class="identity-field">
                                <dt>UID</dt>
                                <dd>{{ profile.id }}</dd>
                            </div>
                            <div v-if="profile.ccfLevel > 0" class="identity-field">
                                <dt>OI 等级</dt>
                                <dd>{{ profile.ccfLevel }} 级</dd>
                            </div>
                            <div v-if="profile.xcpcLevel > 0" class="identity-field">
                                <dt>ICPC/CCPC 等级</dt>
                                <dd>{{ profile.xcpcLevel }} 级</dd>
                            </div>
                            <div class="identity-field identity-field--faint">
                                <dt>更新于</dt>
                                <dd>
                                    <template v-if="profile.profileFetchedAt">
                                        <n-time
                                            :time="new Date(profile.profileFetchedAt)"
                                            type="relative"
                                        />
                                    </template>
                                    <template v-else>尚未拉取完整资料</template>
                                </dd>
                            </div>
                        </dl>

                        <div class="identity-actions">
                            <n-button
                                size="small"
                                secondary
                                :loading="refreshing"
                                @click="handleManualRefresh"
                            >
                                <template #icon>
                                    <n-icon><RefreshCw /></n-icon>
                                </template>
                                刷新
                            </n-button>
                            <span v-if="profile.profileStale" class="identity-stale">
                                后台刷新中
                            </span>
                        </div>
                    </Card>

                    <Card class="profile-card profile-card--prizes" title="获奖信息" :icon="Trophy">
                        <n-empty
                            v-if="orderedPrizes.length === 0"
                            :description="
                                profile.profileFetchedAt
                                    ? '该用户暂无可见的获奖记录'
                                    : '正在拉取数据,请稍候...'
                            "
                        />

                        <ul v-else class="prize-list-compact">
                            <li v-for="(prize, idx) in orderedPrizes" :key="idx" class="prize-row">
                                <n-tooltip
                                    v-if="prize.score != null || prize.rank != null"
                                    :delay="200"
                                >
                                    <template #trigger>
                                        <div class="prize-row-text">
                                            <span class="prize-row-year">[{{ prize.year }}]</span>
                                            <span class="prize-row-contest">
                                                {{ prize.contest }}
                                            </span>
                                            <span v-if="prize.event" class="prize-row-event">
                                                · {{ prize.event }}
                                            </span>
                                        </div>
                                    </template>
                                    <div class="prize-tooltip">
                                        <div v-if="prize.score != null">
                                            成绩: {{ prize.score }}
                                        </div>
                                        <div v-if="prize.rank != null">排名: {{ prize.rank }}</div>
                                    </div>
                                </n-tooltip>
                                <div v-else class="prize-row-text">
                                    <span class="prize-row-year">[{{ prize.year }}]</span>
                                    <span class="prize-row-contest">{{ prize.contest }}</span>
                                    <span v-if="prize.event" class="prize-row-event">
                                        · {{ prize.event }}
                                    </span>
                                </div>
                                <n-tag
                                    size="small"
                                    :type="prizeTagType(prize.prize)"
                                    :bordered="false"
                                >
                                    {{ prize.prize }}
                                </n-tag>
                            </li>
                        </ul>
                    </Card>

                    <Card
                        class="profile-card profile-card--judgement"
                        title="陶片放逐"
                        :icon="Hammer"
                    >
                        <template #header-extra>
                            <span class="judgement-count">共 {{ judgementTotal }} 条</span>
                        </template>

                        <n-alert
                            v-if="judgementError"
                            class="judgement-error"
                            type="error"
                            :show-icon="true"
                        >
                            获取记录失败：{{ judgementError }}
                        </n-alert>

                        <n-spin :show="judgementLoading">
                            <n-empty
                                v-if="!judgementLoading && judgements.length === 0"
                                :description="
                                    judgementError ? '暂时无法加载陶片记录' : '该用户暂无陶片记录'
                                "
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
                </div>
            </div>
        </n-spin>

        <div v-if="hasUpdate" class="update-floater">
            <n-button
                type="primary"
                circle
                size="large"
                class="shadow-button"
                @click="triggerRefresh"
            >
                <template #icon>
                    <n-icon><RefreshCw /></n-icon>
                </template>
            </n-button>
        </div>
    </div>
</template>

<style scoped>
.user-profile-view {
    max-width: 1200px;
    margin: 0 auto;
    min-width: 0;
}

.update-floater {
    position: fixed;
    bottom: 32px;
    left: 260px;
    z-index: 999;
    animation: slide-in 0.3s ease-out;
}

.shadow-button {
    box-shadow: var(--ui-elevated-shadow);
}

@keyframes slide-in {
    from {
        transform: translateY(100%);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

.user-profile-view :deep(.n-spin-body) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

.profile-grid {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: var(--ui-space-4);
    align-items: start;
    min-width: 0;
}

@media (max-width: 900px) {
    .profile-grid {
        grid-template-columns: 1fr;
    }
}

.profile-left,
.profile-right {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    /* prevent any oversized child from overflowing the grid cell */
    overflow: hidden;
}

.profile-card {
    width: 100%;
    box-sizing: border-box;
    /* belt-and-suspenders: even if a child has fixed width, clip it */
    overflow: hidden;
}
.profile-card :deep(*) {
    box-sizing: border-box;
}

/* Constrain Markdown content that would otherwise blow up the grid */
.profile-card--intro :deep(img),
.profile-card--intro :deep(video) {
    max-width: 100%;
    height: auto;
}
.profile-card--intro :deep(pre) {
    max-width: 100%;
    overflow-x: auto;
}
.profile-card--intro :deep(.table-container) {
    max-width: 100%;
    overflow-x: auto;
}
.profile-card--intro :deep(table) {
    max-width: 100%;
}
.profile-card--intro :deep(iframe) {
    max-width: 100%;
}

/* Identity card */
.identity-header {
    display: flex;
    gap: var(--ui-space-4);
    align-items: center;
    margin-bottom: var(--ui-space-4);
    min-width: 0;
}
.identity-name-block {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}
.identity-name-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
}
.identity-name {
    font-size: 18px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.identity-slogan {
    margin-top: 4px;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    line-height: 1.4;
    font-style: italic;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    /* break long English/URLs so flex children don't blow out the column */
    overflow-wrap: anywhere;
    word-break: break-word;
}

.identity-fields {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.identity-field {
    display: flex;
    align-items: baseline;
    gap: var(--ui-control-gap);
    padding: var(--ui-space-2) 0;
    border-bottom: 1px solid var(--ui-border-color);
    min-width: 0;
}
.identity-field:last-child {
    border-bottom: none;
}
.identity-field dt {
    margin: 0;
    flex-shrink: 0;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    white-space: nowrap;
}
.identity-field dd {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-color);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.identity-field--faint dd {
    font-weight: 400;
    color: var(--ui-muted-text-color);
    font-size: 12px;
}

.identity-actions {
    margin-top: var(--ui-space-4);
    display: flex;
    align-items: center;
    gap: var(--ui-control-gap);
}
.identity-stale {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

/* Compact prize list */
.prize-list-compact {
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
    gap: var(--ui-control-gap);
    padding: var(--ui-space-2) 0;
    border-bottom: 1px solid var(--ui-border-color);
}
.prize-row:last-child {
    border-bottom: none;
}
.prize-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--ui-inline-gap);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.prize-row-year {
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}
.prize-row-contest {
    color: var(--ui-text-color);
    font-weight: 500;
}
.prize-row-event {
    color: var(--ui-muted-text-color);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
}
.prize-tooltip {
    font-size: 12px;
    line-height: 1.6;
}

.judgement-count {
    color: var(--ui-muted-text-color);
    font-size: 12px;
    white-space: nowrap;
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
    margin-top: 4px;
}

.judgement-no-permission {
    color: var(--ui-muted-text-color);
    font-size: 12px;
}

.judgement-reason {
    margin: 6px 0 0;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
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
