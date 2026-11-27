<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { goBackIgnoringHash } from '@/utils/navigation-history';
import {
    NAlert,
    NButton,
    NIcon,
    NResult,
    NSkeleton,
    NSpace,
    NSpin,
    NTag,
    useDialog,
    useMessage
} from 'naive-ui';
import {
    ArrowLeft,
    CalendarDays,
    Clipboard,
    Copy,
    RotateCcw,
    RefreshCw,
    Trash2
} from 'lucide-vue-next';

import { getPasteById, savePaste } from '@/api/paste';
import { restorePaste } from '@/api/admin';
import type { CreateWorkflowTemplateResponse } from '@/api/workflow';
import type { Paste } from '@/types/paste';
import type { TocItem } from '@/types/article';
import type { ApiResponse } from '@/types/common';
import { useContentSaver } from '@/composables/useContentSaver';
import { useViewMode } from '@/composables/useViewMode';
import { useBookmarks } from '@/composables/useBookmarks';
import { useBookmarkIcons } from '@/composables/useBookmarkIcons';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { playArticleRevealCurtain } from '@/composables/useArticleTransition';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import LoadingSkeleton from '@/components/LoadingSkeleton.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserLink from '@/components/UserLink.vue';
import DeletionRequestModal from '@/components/DeletionRequestModal.vue';
import SourceCodeModal from '@/components/SourceCodeModal.vue';
import LuoguSourceButton from '@/components/LuoguSourceButton.vue';
import ViewModeSwitch from '@/components/ViewModeSwitch.vue';
import FocusSidebar from '@/components/FocusSidebar.vue';
import TableOfContents from '@/components/TableOfContents.vue';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request';
import { currentRole, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { hasRole, UserRole } from '@/utils/permissions.ts';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const {
    isSaving,
    hasUpdate,
    requestSave,
    setupUpdateListener,
    setupTaskUpdateListener,
    handleRefresh,
    notifyWorkflowSubmitted,
    notifySaveCompleted
} = useContentSaver();

const pasteId = route.params.id as string;
const reducedMotion = useReducedMotion();
let stopRevealCurtain: (() => void) | null = null;
const paste = ref<Paste | null>(null);
const loading = ref(true);
const forbiddenReason = ref('');
const loadError = ref('');
const notFound = ref(false);
const updating = ref(false);
let stopTaskListener: (() => void) | null = null;
let dataRequest = 0;
let disposed = false;

const title = computed(() => `剪贴板 ${pasteId}`);

// View mode
const { viewMode, isFocus, setViewMode } = useViewMode();

// Bookmarks
const { bookmarks, toggleBookmark, removeBookmark, renameBookmark } = useBookmarks(
    'paste',
    pasteId,
    () => title.value
);

// TOC for the left sidebar (default mode) and focus sidebar
const tocItems = ref<TocItem[]>([]);

// Handle markdown rendered for TOC extraction
const handleRendered = (toc: TocItem[]) => {
    if (!paste.value || paste.value.deleted) return;
    tocItems.value = toc;
};

// Bookmark heading icons (available in both normal and focus reading modes)
useBookmarkIcons(
    '.md-body',
    'h1, h2, h3, h4, h5, h6',
    ref(true),
    bookmarks,
    (headingId: string, headingText: string) => {
        const result = toggleBookmark(headingId, headingText);
        if (result === 'added') {
            message.success(`已收藏段落: ${headingText.slice(0, 30)}`);
        } else if (result === 'removed') {
            message.success(`已取消收藏: ${headingText.slice(0, 30)}`);
        }
    }
);

onMounted(() => {
    if (!reducedMotion.value) {
        stopRevealCurtain = playArticleRevealCurtain('正在加载剪贴板');
    }
    const scrollEl = document.querySelector<HTMLElement>('.page-scroll-container');
    if (scrollEl && !route.hash) {
        scrollEl.scrollTop = 0;
    }
    loadData();
});

onUnmounted(() => {
    disposed = true;
    dataRequest++;
    stopTaskListener?.();
    stopRevealCurtain?.();
    stopRevealCurtain = null;
});

const goBack = () => {
    goBackIgnoringHash(router);
};

const triggerRefresh = () => {
    handleRefresh(loadData);
};

const getSaveReportTaskId = (response: ApiResponse<CreateWorkflowTemplateResponse>) => {
    if (response.code !== 200 || !response.data?.reportTaskIds?.save) {
        throw new Error(response.message || '保存请求提交失败');
    }

    return response.data.reportTaskIds.save;
};

let pendingSaveCompleteText = '剪贴板已保存';

const trackSaveTask = (taskId?: string, completeText = '剪贴板已保存') => {
    if (!taskId) return;
    pendingSaveCompleteText = completeText;
    stopTaskListener?.();
    stopTaskListener = setupTaskUpdateListener(
        taskId,
        (_data, meta) => {
            stopTaskListener = null;
            notifySaveCompleted(pendingSaveCompleteText);
            markStarPromptEligible();
            if (!meta?.alreadyRefreshed) {
                void loadData();
            }
        },
        (error: string) => {
            stopTaskListener = null;
            const detail = error?.trim();
            const retryDialog = dialog.error({
                title: '保存失败',
                content: detail ? `剪贴板保存失败：${detail}` : '剪贴板保存失败，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: () => {
                    retryDialog.destroy();
                    void handleRetrySave();
                },
                maskClosable: false,
                closable: false,
                closeOnEsc: false
            });
        }
    );
};

const submitSavePaste = async (completeText = '剪贴板已保存') => {
    const response = await savePaste(pasteId);
    trackSaveTask(getSaveReportTaskId(response), completeText);
    return response;
};

const handleRetrySave = async () => {
    try {
        const response = await requestSave(() => submitSavePaste('剪贴板已保存'));
        if (response !== null) notifyWorkflowSubmitted(response, '正在重试保存…');
    } catch (error) {
        message.error(requestErrorMessage(error, '重试请求提交失败'));
    }
};

const handleSaveMissing = async () => {
    if (isSaving.value) return;
    try {
        const response = await requestSave(async () => {
            isSaving.value = true;
            return await submitSavePaste('剪贴板已保存');
        });
        if (response !== null) notifyWorkflowSubmitted(response, '正在保存剪贴板…');
    } catch (error) {
        isSaving.value = false;
        message.error(requestErrorMessage(error, '保存请求提交失败'));
    }
};

const loadData = async () => {
    const request = ++dataRequest;
    loading.value = true;
    forbiddenReason.value = '';
    notFound.value = false;
    loadError.value = '';
    tocItems.value = [];
    try {
        const res = await getPasteById(pasteId);
        if (disposed || request !== dataRequest) return;
        if (res.code === 404) {
            paste.value = null;
            notFound.value = true;
            document.title = '剪贴板未收录 - 洛谷保存站';
            return;
        }
        if (res.code === 403) {
            paste.value = null;
            forbiddenReason.value = res.message || '剪贴板不可查看';
            document.title = '剪贴板不可查看 - 洛谷保存站';
            return;
        }
        if (res.code !== 200 || !res.data) {
            loadError.value = res.message || '剪贴板加载失败';
            return;
        }

        paste.value = res.data.deleted ? { ...res.data, content: '' } : res.data;
        document.title = `${paste.value.deleted ? '[已删除] ' : ''}${title.value} - 洛谷保存站`;
    } catch (error) {
        if (disposed || request !== dataRequest) return;
        loadError.value = requestErrorMessage(error, '剪贴板加载失败');
    } finally {
        if (!disposed && request === dataRequest) loading.value = false;
    }
};

setupUpdateListener(
    `paste_${pasteId}`,
    `paste:${pasteId}:updated`,
    loadData,
    () => Boolean(paste.value) && !notFound.value
);

const showSource = ref(false);
const openSource = () => {
    if (!paste.value || paste.value.deleted || forbiddenReason.value) return;
    showSource.value = true;
};

const handleUpdate = async () => {
    if (!pasteId || updating.value) return;
    updating.value = true;
    try {
        const response = await requestSave(() => submitSavePaste('剪贴板已更新'));
        if (response !== null) notifyWorkflowSubmitted(response, '正在更新剪贴板…');
    } catch (error) {
        message.error(requestErrorMessage(error, '更新请求提交失败'));
    } finally {
        updating.value = false;
    }
};

const showDeletionModal = ref(false);
const restoring = ref(false);
const isAdmin = computed(() => hasRole(currentRole.value, UserRole.MODERATOR));

const handleDelete = () => {
    if (!isAuthenticated.value) {
        dialog.warning({
            title: '需要登录',
            content: '提交删除申请需要登录，是否前往登录？',
            positiveText: '去登录',
            negativeText: '取消',
            onPositiveClick: () => startCpOAuthLogin(`/paste/${pasteId}`)
        });
        return;
    }
    showDeletionModal.value = true;
};

const handleRestore = () => {
    dialog.warning({
        title: '恢复剪贴板',
        content: `确认恢复剪贴板 ${pasteId}？恢复后所有用户都可以重新查看该内容。`,
        positiveText: '确认恢复',
        negativeText: '取消',
        onPositiveClick: async () => {
            restoring.value = true;
            try {
                const response = await restorePaste(pasteId);
                if (response.code !== 200) {
                    throw new Error(response.message || '恢复剪贴板失败');
                }
                message.success(response.data.restored ? '剪贴板已恢复' : '剪贴板已经处于可见状态');
                await loadData();
            } catch (error) {
                message.error(requestErrorMessage(error, '恢复剪贴板失败'));
            } finally {
                restoring.value = false;
            }
        }
    });
};
</script>

<template>
    <n-spin :show="isSaving" description="正在保存并处理..." class="saving-spin">
        <div
            class="paste-layout"
            :class="{
                'is-focus-mode': isFocus
            }"
        >
            <aside v-if="!isFocus" class="sidebar-left">
                <TableOfContents :items="tocItems" />
            </aside>

            <div class="center-column" :class="{ 'focus-center': isFocus }">
                <Card class="reading-sheet">
                    <div class="paste-header">
                        <CardTitle :title="title" :icon="Clipboard" />
                        <LoadingSkeleton :loading="loading">
                            <template #skeleton>
                                <div class="reading-meta-skeleton">
                                    <n-skeleton circle size="small" />
                                    <n-skeleton text style="width: 96px" />
                                    <n-skeleton text style="width: 148px" />
                                </div>
                            </template>

                            <template v-if="paste">
                                <div class="reading-meta-bar">
                                    <span class="reading-meta-item">
                                        <UserLink :user="paste.author" show-avatar />
                                    </span>
                                    <span class="meta-sep" aria-hidden="true" />
                                    <span class="reading-meta-item reading-meta-time">
                                        <NIcon :component="CalendarDays" :size="14" />
                                        <span>本站更新于 {{ formatDate(paste.updatedAt) }}</span>
                                    </span>
                                    <n-tag
                                        v-if="paste.deleted"
                                        type="error"
                                        size="small"
                                        :bordered="false"
                                    >
                                        已删除
                                    </n-tag>
                                </div>

                                <div class="header-toolbar">
                                    <n-space>
                                        <n-button size="small" @click="goBack">
                                            <template #icon>
                                                <NIcon :component="ArrowLeft" />
                                            </template>
                                            返回
                                        </n-button>
                                        <LuoguSourceButton :path="`/paste/${paste.id}`" />
                                        <n-button
                                            size="small"
                                            secondary
                                            :disabled="paste.deleted"
                                            @click="openSource"
                                        >
                                            <template #icon>
                                                <NIcon :component="Copy" />
                                            </template>
                                            源码
                                        </n-button>
                                        <n-button
                                            v-if="!paste.deleted"
                                            size="small"
                                            type="primary"
                                            :loading="updating"
                                            :disabled="updating"
                                            @click="handleUpdate"
                                        >
                                            <template #icon>
                                                <NIcon :component="RefreshCw" />
                                            </template>
                                            更新
                                        </n-button>
                                        <n-button
                                            v-if="!paste.deleted"
                                            size="small"
                                            type="error"
                                            ghost
                                            @click="handleDelete"
                                        >
                                            <template #icon>
                                                <NIcon :component="Trash2" />
                                            </template>
                                            删除
                                        </n-button>
                                        <n-button
                                            v-if="paste.deleted && isAdmin"
                                            size="small"
                                            type="warning"
                                            secondary
                                            :loading="restoring"
                                            @click="handleRestore"
                                        >
                                            <template #icon>
                                                <NIcon :component="RotateCcw" />
                                            </template>
                                            恢复
                                        </n-button>
                                        <ViewModeSwitch
                                            :model-value="viewMode"
                                            @update:model-value="setViewMode"
                                        />
                                    </n-space>
                                </div>

                                <n-alert
                                    v-if="loadError"
                                    type="error"
                                    title="剪贴板刷新失败"
                                    class="refresh-alert"
                                >
                                    {{ loadError }}
                                    <div class="state-actions">
                                        <n-button @click="loadData">重试</n-button>
                                    </div>
                                </n-alert>
                            </template>
                            <div v-else-if="forbiddenReason" class="reading-body">
                                <n-result
                                    status="403"
                                    title="剪贴板不可查看"
                                    :description="forbiddenReason"
                                >
                                    <template #footer>
                                        <n-space justify="center">
                                            <n-button secondary @click="goBack">返回</n-button>
                                            <LuoguSourceButton
                                                :path="`/paste/${pasteId}`"
                                                size="medium"
                                            />
                                        </n-space>
                                    </template>
                                </n-result>
                            </div>
                            <div v-else-if="notFound" class="reading-body">
                                <n-result
                                    status="404"
                                    title="该剪贴板尚未被收录"
                                    description="本站还没有归档这个剪贴板，可以立即提交保存。"
                                >
                                    <template #footer>
                                        <n-space justify="center">
                                            <n-button secondary @click="goBack">返回</n-button>
                                            <LuoguSourceButton
                                                :path="`/paste/${pasteId}`"
                                                size="medium"
                                            />
                                            <n-button
                                                type="primary"
                                                :loading="isSaving"
                                                :disabled="isSaving"
                                                @click="handleSaveMissing"
                                            >
                                                立即保存
                                            </n-button>
                                        </n-space>
                                    </template>
                                </n-result>
                            </div>
                            <div v-else-if="loadError" class="reading-body">
                                <n-alert type="error" title="剪贴板加载失败">
                                    {{ loadError }}
                                    <div class="state-actions">
                                        <n-button @click="loadData">重试</n-button>
                                    </div>
                                </n-alert>
                            </div>
                        </LoadingSkeleton>
                    </div>

                    <main
                        v-if="
                            !forbiddenReason &&
                            !notFound &&
                            !(loadError && !paste) &&
                            (loading || paste)
                        "
                        class="main-content reading-body"
                    >
                        <LoadingSkeleton :loading="loading">
                            <template #skeleton>
                                <n-space vertical size="large">
                                    <n-space vertical>
                                        <n-skeleton text :repeat="2" />
                                        <n-skeleton text style="width: 60%" />
                                    </n-space>
                                    <n-skeleton
                                        height="120px"
                                        style="border-radius: var(--ui-card-radius)"
                                    />
                                    <n-space vertical>
                                        <n-skeleton text :repeat="4" />
                                    </n-space>
                                </n-space>
                            </template>

                            <n-alert v-if="paste?.deleted" type="warning" title="剪贴板已删除">
                                该剪贴板已删除。
                            </n-alert>
                            <MarkdownViewer
                                v-else-if="paste"
                                :content="paste.content"
                                :heading-offset="1"
                                @rendered="handleRendered"
                            />
                        </LoadingSkeleton>
                    </main>
                </Card>
            </div>

            <!-- Default mode: empty sidebar-right -->
            <aside v-if="!isFocus" class="sidebar-right"></aside>

            <!-- Focus mode: sidebar with TOC + bookmarks -->
            <aside v-if="isFocus" class="sidebar-right focus-sidebar-right">
                <FocusSidebar
                    :toc-items="tocItems"
                    :bookmarks="bookmarks"
                    :version-history="[]"
                    :selected-version="null"
                    @remove-bookmark="removeBookmark"
                    @rename-bookmark="
                        (bookmarkId: string, newName: string) => renameBookmark(bookmarkId, newName)
                    "
                />
            </aside>
        </div>
    </n-spin>

    <Transition name="ui-float-up">
        <div v-if="hasUpdate && !forbiddenReason && !paste?.deleted" class="update-floater">
            <n-button
                type="primary"
                circle
                size="large"
                class="shadow-button"
                aria-label="刷新查看最新内容"
                @click="triggerRefresh"
            >
                <template #icon>
                    <NIcon :component="RefreshCw" />
                </template>
            </n-button>
        </div>
    </Transition>

    <SourceCodeModal
        v-if="paste && !paste.deleted && !forbiddenReason"
        v-model:show="showSource"
        :source="paste.content || ''"
    />
    <DeletionRequestModal
        v-model:show="showDeletionModal"
        target-type="paste"
        :target-id="pasteId"
    />
</template>

<style scoped>
.sidebar-left,
.sidebar-right {
    display: block;
}

.paste-layout {
    width: min(100%, 1600px);
    max-width: none;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 280px;
    gap: var(--ui-space-5);
    align-items: start;
}

/* Focus mode: wider content, sidebar on right only */
.paste-layout.is-focus-mode {
    grid-template-columns: minmax(0, 1fr) 280px;
}

.paste-layout.is-focus-mode .focus-sidebar-right {
    min-width: 0;
    position: sticky;
    top: var(--ui-space-5);
    margin-top: -28px;
    align-self: start;
}

.sidebar-left {
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    align-self: start;
    max-height: calc(100dvh - var(--ui-page-padding) * 2);
    z-index: 1;
}

.sidebar-right,
.main-content {
    min-width: 0;
}

.center-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.paste-header {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.paste-header :deep(.page-hero) {
    padding: 0 0 var(--ui-space-2);
}

.paste-header :deep(.hero-title) {
    overflow-wrap: anywhere;
}

.reading-meta-bar,
.reading-meta-skeleton {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2) var(--ui-space-3);
    min-height: 28px;
}

.reading-meta-bar {
    margin-bottom: var(--ui-space-4);
}

.reading-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ui-secondary-text-color);
}

.reading-meta-time {
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.meta-sep {
    width: 1px;
    height: 12px;
    background: var(--ui-border-color);
    flex-shrink: 0;
}

.reading-body {
    border-top: 1px solid var(--ui-border-color);
    margin-top: var(--ui-space-4);
    padding-top: var(--ui-space-5);
}

.refresh-alert {
    margin-top: var(--ui-space-4);
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.header-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
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

@media (max-width: 1200px) {
    .paste-layout,
    .paste-layout.is-focus-mode {
        grid-template-columns: minmax(0, 1fr);
    }

    .sidebar-left,
    .sidebar-right,
    .focus-sidebar-right {
        min-width: 0;
    }

    .sidebar-left,
    .focus-sidebar-right {
        position: static;
        margin-top: 0;
        max-height: none;
    }
}

/* noinspection CssUnusedSymbol */
.saving-spin :deep(.n-spin-body) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}
</style>
