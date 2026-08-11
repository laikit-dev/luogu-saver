<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    NButton,
    NDivider,
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
    ExternalLink,
    RotateCcw,
    RefreshCw,
    Trash2
} from 'lucide-vue-next';

import { getPasteById, savePaste } from '@/api/paste';
import { restorePaste } from '@/api/admin';
import type { Paste } from '@/types/paste';
import type { TocItem } from '@/types/article';
import { generateTocAndProcessHtml } from '@/utils/article';
import { useContentSaver } from '@/composables/useContentSaver';
import { useViewMode } from '@/composables/useViewMode';
import { useBookmarks } from '@/composables/useBookmarks';
import { useBookmarkIcons } from '@/composables/useBookmarkIcons';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import Card from '@/components/Card.vue';
import LoadingSkeleton from '@/components/LoadingSkeleton.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserLink from '@/components/UserLink.vue';
import DeletionRequestModal from '@/components/DeletionRequestModal.vue';
import ViewModeSwitch from '@/components/ViewModeSwitch.vue';
import FocusSidebar from '@/components/FocusSidebar.vue';
import { formatDate } from '@/utils/render';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { currentRole, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { ROLE_ADMIN } from '@/utils/permissions.ts';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const {
    isSaving,
    hasUpdate,
    handle404,
    setupUpdateListener,
    setupTaskUpdateListener,
    handleRefresh,
    notifyWorkflowSubmitted
} = useContentSaver();

const pasteId = route.params.id as string;
const paste = ref<Paste | null>(null);
const loading = ref(true);
const displayContent = ref('');
const forbiddenReason = ref('');
const { buildLuoguUrl } = useLuoguSource();
let stopTaskListener: (() => void) | null = null;

const title = computed(() => `剪贴板 ${pasteId}`);

// View mode
const { viewMode, isFocus, setViewMode } = useViewMode();

// Bookmarks
const { bookmarks, toggleBookmark, removeBookmark, renameBookmark } = useBookmarks(pasteId);

// TOC for focus mode
const tocItems = ref<TocItem[]>([]);

// Handle markdown rendered for TOC extraction
const handleRendered = (html: string) => {
    const result = generateTocAndProcessHtml(html);
    tocItems.value = result.toc;
};

// Bookmark heading icons (focus mode only)
useBookmarkIcons(
    '.md-body',
    'h1, h2, h3, h4, h5, h6',
    viewMode,
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
    loadData();
});

const triggerRefresh = () => {
    handleRefresh(loadData);
};

const getSaveReportTaskId = (response: Awaited<ReturnType<typeof savePaste>>) => {
    if (response.code !== 200 || !response.data?.reportTaskIds?.save) {
        throw new Error(response.message || '保存请求提交失败');
    }

    return response.data.reportTaskIds.save;
};

const trackSaveTask = (taskId?: string) => {
    if (!taskId) return;
    stopTaskListener?.();
    stopTaskListener = setupTaskUpdateListener(
        taskId,
        () => {
            stopTaskListener = null;
            message.success('保存任务处理完成');
            markStarPromptEligible();
        },
        error => {
            stopTaskListener = null;
            dialog.error({
                title: '保存失败',
                content: error || '剪贴板保存过程中出现错误，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    const response = await savePaste(pasteId);
                    trackSaveTask(getSaveReportTaskId(response));
                    notifyWorkflowSubmitted(response, '重试请求已提交');
                },
                maskClosable: false,
                closable: false,
                closeOnEsc: false
            });
        }
    );
};

const submitSavePaste = async () => {
    const response = await savePaste(pasteId);
    trackSaveTask(getSaveReportTaskId(response));
    return response;
};

const loadData = async () => {
    loading.value = true;
    forbiddenReason.value = '';
    try {
        const res = await getPasteById(pasteId);
        if (res.code === 404) {
            handle404(submitSavePaste);
            return;
        }
        if (res.code === 403) {
            paste.value = null;
            displayContent.value = '';
            forbiddenReason.value = res.message || '剪贴板已删除';
            document.title = '剪贴板不可查看 - 洛谷保存站';
            return;
        }
        if (res.code !== 200 || !res.data) {
            message.error(res.message || '加载失败');
            return;
        }

        paste.value = res.data;
        displayContent.value = paste.value.renderedContent || '';
        document.title = `${paste.value.deleted ? '[已删除] ' : ''}${title.value} - 洛谷保存站`;
    } catch (err: any) {
        message.error(err.message || '加载失败');
    } finally {
        loading.value = false;
    }
};

setupUpdateListener(`paste_${pasteId}`, `paste:${pasteId}:updated`, loadData);

const handleCopy = async () => {
    if (!paste.value?.content) return;

    try {
        await navigator.clipboard.writeText(paste.value.content);
        message.success('源码已复制到剪贴板');
    } catch {
        message.error('复制失败');
    }
};

const handleUpdate = async () => {
    if (!pasteId) return;
    try {
        const response = await submitSavePaste();
        notifyWorkflowSubmitted(response, '更新请求已提交');
    } catch (err: any) {
        message.error(err.message || '更新请求失败');
    }
};

const showDeletionModal = ref(false);
const restoring = ref(false);
const isAdmin = computed(() => currentRole.value === ROLE_ADMIN);

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
                message.error(error instanceof Error ? error.message : '恢复剪贴板失败');
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
            <aside v-if="!isFocus" class="sidebar-left"></aside>

            <div class="center-column" :class="{ 'focus-center': isFocus }">
                <div class="paste-header">
                    <LoadingSkeleton :loading="loading">
                        <template #skeleton>
                            <Card>
                                <div style="margin-bottom: 8px">
                                    <n-skeleton
                                        text
                                        style="width: 40%; height: 28px; margin-bottom: 8px"
                                    />
                                </div>
                                <n-divider style="margin: 12px 0" />
                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="label">作者</span>
                                        <div class="skeleton-line">
                                            <n-skeleton circle size="small" />
                                            <n-skeleton text style="width: 80px" />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </template>

                        <div v-if="paste">
                            <Card
                                :title="title"
                                :icon="Clipboard"
                                :class="{ 'deleted-paste-card': paste.deleted }"
                            >
                                <template #title-extra>
                                    <n-tag
                                        v-if="paste.deleted"
                                        type="error"
                                        size="small"
                                        :bordered="false"
                                    >
                                        已删除
                                    </n-tag>
                                </template>
                                <div class="meta-row">
                                    <n-tag :bordered="false" size="small">
                                        <template #icon>
                                            <NIcon :component="CalendarDays" />
                                        </template>
                                        更新于 {{ formatDate(paste.updatedAt) }}
                                    </n-tag>
                                </div>

                                <n-divider style="margin: 12px 0" />

                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="label">作者</span>
                                        <UserLink :user="paste.author" show-avatar />
                                    </div>
                                </div>

                                <n-divider style="margin: 12px 0" />

                                <div class="header-toolbar">
                                    <n-space>
                                        <n-button size="small" @click="router.go(-1)">
                                            <template #icon>
                                                <NIcon :component="ArrowLeft" />
                                            </template>
                                            返回
                                        </n-button>
                                        <n-button
                                            size="small"
                                            secondary
                                            tag="a"
                                            :href="buildLuoguUrl(`/paste/${paste.id}`)"
                                            target="_blank"
                                        >
                                            <template #icon>
                                                <NIcon :component="ExternalLink" />
                                            </template>
                                            原站
                                        </n-button>
                                        <n-button size="small" secondary @click="handleCopy">
                                            <template #icon>
                                                <NIcon :component="Copy" />
                                            </template>
                                            源码
                                        </n-button>
                                        <n-button
                                            v-if="!paste.deleted"
                                            size="small"
                                            type="primary"
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
                            </Card>
                        </div>
                        <Card v-else-if="forbiddenReason" title="剪贴板不可查看" :icon="Clipboard">
                            <n-result
                                status="403"
                                title="剪贴板不可查看"
                                :description="forbiddenReason"
                            >
                                <template #footer>
                                    <n-space justify="center">
                                        <n-button secondary @click="router.go(-1)">返回</n-button>
                                        <n-button
                                            secondary
                                            tag="a"
                                            :href="buildLuoguUrl(`/paste/${pasteId}`)"
                                            target="_blank"
                                        >
                                            原站
                                        </n-button>
                                    </n-space>
                                </template>
                            </n-result>
                        </Card>
                    </LoadingSkeleton>
                </div>

                <main v-if="!forbiddenReason" class="main-content">
                    <div>
                        <LoadingSkeleton :loading="loading">
                            <template #skeleton>
                                <Card>
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
                                </Card>
                            </template>

                            <Card v-if="paste">
                                <MarkdownViewer
                                    :content="displayContent"
                                    :pre-rendered="true"
                                    @rendered="handleRendered"
                                />
                            </Card>
                        </LoadingSkeleton>
                    </div>
                </main>
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

    <div v-if="hasUpdate && !forbiddenReason && !paste?.deleted" class="update-floater">
        <n-button type="primary" circle size="large" class="shadow-button" @click="triggerRefresh">
            <template #icon>
                <NIcon :component="RefreshCw" />
            </template>
        </n-button>
    </div>

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
    gap: 20px;
    align-items: start;
}

/* Focus mode: wider content, sidebar on right only */
.paste-layout.is-focus-mode {
    grid-template-columns: minmax(0, 1fr) 280px;
}

.paste-layout.is-focus-mode .focus-sidebar-right {
    min-width: 0;
    position: sticky;
    top: 20px;
    margin-top: -36px;
    align-self: start;
}

.sidebar-left,
.sidebar-right,
.main-content {
    min-width: 0;
}

.deleted-paste-card :deep(.card-title) {
    color: var(--ui-error-color) !important;
}

.center-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.meta-row {
    margin-bottom: 8px;
    display: flex;
    gap: 8px;
}

.info-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
}

.info-item {
    min-height: 58px;
    background: linear-gradient(180deg, var(--ui-panel-color), var(--ui-body-gradient-end));
    padding: 10px 12px;
    border-radius: var(--ui-card-radius);
    border: 1px solid var(--ui-border-color);
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.label {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.skeleton-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}

.header-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
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
