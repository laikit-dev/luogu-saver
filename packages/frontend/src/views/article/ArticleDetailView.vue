<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
    useMessage,
    NSpace,
    NButton,
    NIcon,
    NTag,
    NSkeleton,
    NEmpty,
    NSpin,
    NResult,
    NAlert,
    NTooltip,
    useDialog
} from 'naive-ui';
import {
    Copy,
    RefreshCw,
    Trash2,
    ArrowLeft,
    Newspaper,
    CalendarDays,
    Check,
    Clock3,
    GitCompareArrows,
    RotateCcw
} from 'lucide-vue-next';
import { useContentSaver } from '@/composables/useContentSaver';
import { useBookmarks } from '@/composables/useBookmarks';
import { useBookmarkIcons } from '@/composables/useBookmarkIcons';
import { goBackIgnoringHash } from '@/utils/navigation-history';
import { getArticleById, getRelevant, getArticleHistory, saveArticle } from '@/api/article';
import { restoreArticle } from '@/api/admin';
import type { CreateWorkflowTemplateResponse } from '@/api/workflow';
import type { Article, PlazaArticle, TocItem } from '@/types/article';
import type { ApiResponse } from '@/types/common';
import {
    getCategoryLabel,
    getCategoryIcon,
    getCategoryTagStyle,
    getTagStyle
} from '@/utils/article';

import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import SidebarWidget from '@/components/SidebarWidget.vue';
import UserLink from '@/components/UserLink.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import ArticleComments from '@/components/ArticleComments.vue';
import LoadingSkeleton from '@/components/LoadingSkeleton.vue';
import DeletionRequestModal from '@/components/DeletionRequestModal.vue';
import SourceCodeModal from '@/components/SourceCodeModal.vue';
import LuoguSourceButton from '@/components/LuoguSourceButton.vue';
import VersionCompareModal, {
    type CompareSnapshotContent,
    type CompareVersionOption
} from '@/components/VersionCompareModal.vue';
import TableOfContents from '@/components/TableOfContents.vue';
import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants';
import { hasMarkdownHeadings } from '@/utils/article';
import { formatDate } from '@/utils/render';

import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { useReducedMotion } from '@/composables/useReducedMotion';
import {
    consumeArticlePendingTitle,
    consumeCurtainHandled,
    playArticleRevealCurtain
} from '@/composables/useArticleTransition';
import { currentRole, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { hasRole, UserRole } from '@/utils/permissions.ts';
import { requestErrorMessage } from '@/utils/request';
import { parsePositiveIntId } from '@/api/archive';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const {
    isSaving,
    isRemoteRefreshing,
    hasUpdate,
    requestSave,
    setupUpdateListener,
    setupTaskUpdateListener,
    handleRefresh,
    notifyWorkflowSubmitted,
    notifySaveCompleted
} = useContentSaver();

const articleId = route.params.id as string;
const reducedMotion = useReducedMotion();
const pendingTitle = consumeArticlePendingTitle(articleId);
const handledByCardCurtain = consumeCurtainHandled(articleId);
let stopRevealCurtain: (() => void) | null = null;
const article = ref<Article | null>(null);
const loading = ref(true);

const { bookmarks, toggleBookmark } = useBookmarks(
    'article',
    articleId,
    () => article.value?.title
);
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

const recommended = ref<PlazaArticle[]>([]);
const recLoading = ref(false);
const recError = ref('');
const forbiddenReason = ref('');
const notFound = ref(false);
const unavailableCode = ref(403);
const unavailableTitle = computed(() =>
    unavailableCode.value === 404 ? '文章不存在' : '文章不可查看'
);

const tocItems = ref<TocItem[]>([]);
const tocResolved = ref(false);
interface VersionItem {
    version: number;
    createdAt: string;
    title?: string;
    content: string;
}
const versionHistory = ref<VersionItem[]>([]);
const selectedVersion = ref<number | null>(null);
const historyLoading = ref(false);
const historyError = ref('');
const articleError = ref('');
let dataRequest = 0;
let relevantRequest = 0;
let disposed = false;

function handleArchiveUnavailable(code: number, reason?: string) {
    dataRequest++;
    article.value = null;
    tocItems.value = [];
    tocResolved.value = true;
    recommended.value = [];
    recError.value = '';
    versionHistory.value = [];
    selectedVersion.value = null;
    historyError.value = '';
    articleError.value = '';
    notFound.value = false;
    historyLoading.value = false;
    loading.value = false;
    recLoading.value = false;
    unavailableCode.value = code === 404 ? 404 : 403;
    forbiddenReason.value = code === 404 ? '文章不存在' : reason || '文章当前不可查看';
    document.title = `${unavailableTitle.value} - 洛谷保存站`;
}

const isViewingLatest = computed(() => route.query.version === undefined);

// An archived version's content comes from the history request.
const bodyLoading = computed(
    () => loading.value || (!isViewingLatest.value && historyLoading.value)
);

const versionError = computed(() => {
    const queryVersion = route.query.version;
    if (queryVersion === undefined) return '';
    const parsedVersion = parsePositiveIntId(queryVersion);
    if (parsedVersion === null) return '无效的版本号';
    if (loading.value || historyLoading.value) return '';
    if (historyError.value) return historyError.value;
    return versionHistory.value.some(version => version.version === parsedVersion)
        ? ''
        : '所选归档版本不存在';
});

const versionContent = computed(() => {
    if (article.value?.deleted || forbiddenReason.value || versionError.value) return '';
    if (isViewingLatest.value) return article.value?.content ?? '';
    return (
        versionHistory.value.find(version => version.version === selectedVersion.value)?.content ??
        ''
    );
});

const displayTitle = computed(() => {
    if (isViewingLatest.value) return article.value?.title ?? '';
    return (
        versionHistory.value.find(version => version.version === selectedVersion.value)?.title ??
        article.value?.title ??
        ''
    );
});

const displayTime = computed(() => {
    if (isViewingLatest.value) return article.value?.updatedAt ?? '';
    return (
        versionHistory.value.find(version => version.version === selectedVersion.value)
            ?.createdAt ?? ''
    );
});

const handleVersionClick = async (version: number) => {
    const query = { ...route.query };
    if (version === versionHistory.value[0]?.version) delete query.version;
    else query.version = String(version);
    await router.replace({ query });
};

const compareOpen = ref(false);
const compareLeftVersion = ref<number | null>(null);
const compareRightVersion = ref<number | null>(null);

const canCompareVersions = computed(
    () => versionHistory.value.length >= 2 && !article.value?.deleted && !forbiddenReason.value
);

const compareVersionOptions = computed<CompareVersionOption[]>(() =>
    versionHistory.value.map((ver, index) => ({
        value: ver.version,
        label: `版本 ${ver.version}${index === 0 ? '（最新）' : ''} · ${formatDate(ver.createdAt)}`
    }))
);

function buildArticleCompareContent(version: number | null): CompareSnapshotContent | null {
    if (version === null) return null;
    const found = versionHistory.value.find(item => item.version === version);
    if (!found) return null;
    return {
        fields: [{ label: '文章标题', before: found.title || '', after: found.title || '' }],
        textLabel: '文章正文（Markdown 源码）',
        text: found.content || ''
    };
}

const compareLeftContent = computed(() => buildArticleCompareContent(compareLeftVersion.value));
const compareRightContent = computed(() => buildArticleCompareContent(compareRightVersion.value));

const openVersionCompare = (left?: number, right?: number) => {
    if (!canCompareVersions.value) return;
    const latest = versionHistory.value[0]!.version;
    const previous = versionHistory.value[1]!.version;
    if (left !== undefined && right !== undefined) {
        compareLeftVersion.value = left;
        compareRightVersion.value = right;
    } else if (selectedVersion.value !== null && selectedVersion.value !== latest) {
        compareLeftVersion.value = selectedVersion.value;
        compareRightVersion.value = latest;
    } else {
        compareLeftVersion.value = previous;
        compareRightVersion.value = latest;
    }
    compareOpen.value = true;
};

const tocPending = computed(
    () =>
        !tocResolved.value &&
        versionContent.value.length > 0 &&
        hasMarkdownHeadings(versionContent.value)
);
const showTocRail = computed(() => tocItems.value.length > 0 || tocPending.value);

const handleRendered = (toc: TocItem[]) => {
    if (article.value?.deleted || forbiddenReason.value) return;
    tocItems.value = toc;
    tocResolved.value = true;
};

const triggerRefresh = () => {
    handleRefresh(loadData);
};

const loadRelevant = async (request: number) => {
    const id = ++relevantRequest;
    const isCurrent = () => !disposed && request === dataRequest && id === relevantRequest;
    recLoading.value = true;
    recError.value = '';
    try {
        const res = await getRelevant(articleId);
        if (!isCurrent()) return;
        if (res.code === 403) {
            handleArchiveUnavailable(res.code, res.message);
            return;
        }
        if (res.code !== 200) {
            recommended.value = [];
            recError.value = res.message || '获取相关推荐失败';
            return;
        }
        recommended.value = res.data || [];
    } catch (err) {
        if (!isCurrent()) return;
        recommended.value = [];
        recError.value = requestErrorMessage(err, '获取相关推荐失败');
    } finally {
        if (isCurrent()) recLoading.value = false;
    }
};

const retryRelevant = () => {
    void loadRelevant(dataRequest);
};

const loadHistory = async (request: number) => {
    historyLoading.value = true;
    historyError.value = '';
    try {
        const res = await getArticleHistory(articleId);
        if (disposed || request !== dataRequest) return;
        if (res.code === 403 || res.code === 404) {
            handleArchiveUnavailable(res.code, res.message);
            return;
        }
        if (res.code !== 200 || !res.data) {
            versionHistory.value = [];
            historyError.value = res.message || '历史版本加载失败';
            return;
        }
        versionHistory.value = res.data
            .map(history => ({
                version: history.version,
                createdAt: history.createdAt,
                title: history.title,
                content: history.content
            }))
            .sort((a, b) => b.version - a.version);
    } catch (err) {
        if (!disposed && request === dataRequest) {
            versionHistory.value = [];
            historyError.value = requestErrorMessage(err, '历史版本加载失败');
        }
    } finally {
        if (!disposed && request === dataRequest) historyLoading.value = false;
    }
};

// Recommendations and history load after the article is shown, each with its own loading state.
const loadArticleExtras = async (request: number) => {
    await Promise.all([loadRelevant(request), loadHistory(request)]);
};

let stopTaskListener: (() => void) | null = null;

const getSaveReportTaskId = (response: ApiResponse<CreateWorkflowTemplateResponse>) => {
    if (response.code !== 200 || !response.data?.reportTaskIds?.save) {
        throw new Error(response.message || '保存请求提交失败');
    }

    return response.data.reportTaskIds.save;
};

let pendingSaveCompleteText = '文章已保存';

const trackSaveTask = (taskId?: string, completeText = '文章已保存') => {
    if (!taskId) return;
    pendingSaveCompleteText = completeText;
    stopTaskListener?.();
    stopTaskListener = setupTaskUpdateListener(
        taskId,
        (_data, meta) => {
            stopTaskListener = null;
            updating.value = false;
            notifySaveCompleted(pendingSaveCompleteText);
            markStarPromptEligible();
            if (!meta?.alreadyRefreshed) {
                void loadData();
            }
        },
        (error: string) => {
            stopTaskListener = null;
            updating.value = false;
            const detail = error?.trim();
            const retryDialog = dialog.error({
                title: '保存失败',
                content: detail ? `文章保存失败：${detail}` : '文章保存失败，请重试。',
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

const submitSaveArticle = async (completeText = '文章已保存') => {
    const response = await saveArticle(articleId);
    trackSaveTask(getSaveReportTaskId(response), completeText);
    return response;
};

const handleRetrySave = async () => {
    try {
        const response = await requestSave(() => submitSaveArticle('文章已保存'));
        if (response !== null) notifyWorkflowSubmitted(response, '正在重试保存…');
    } catch (err) {
        message.error(requestErrorMessage(err, '重试请求提交失败'));
    }
};

const handleSaveMissing = async () => {
    if (isSaving.value) return;
    try {
        const response = await requestSave(async () => {
            isSaving.value = true;
            return await submitSaveArticle('文章已保存');
        });
        if (response !== null) notifyWorkflowSubmitted(response, '正在保存文章…');
    } catch (err) {
        isSaving.value = false;
        message.error(requestErrorMessage(err, '保存请求提交失败'));
    }
};

const loadData = async () => {
    const request = ++dataRequest;
    loading.value = true;
    article.value = null;
    forbiddenReason.value = '';
    notFound.value = false;
    articleError.value = '';
    historyError.value = '';
    versionHistory.value = [];
    recommended.value = [];
    recError.value = '';
    historyLoading.value = false;
    recLoading.value = false;
    tocItems.value = [];
    tocResolved.value = false;
    try {
        const res = await getArticleById(articleId);
        if (disposed || request !== dataRequest) return;
        if (res.code === 404) {
            notFound.value = true;
            document.title = '文章未收录 - 洛谷保存站';
            return;
        }
        if (res.code === 403) {
            handleArchiveUnavailable(res.code, res.message);
            return;
        }
        if (res.code !== 200 || !res.data) {
            articleError.value = res.message || '文章加载失败';
            return;
        }
        article.value = res.data.deleted ? { ...res.data, content: undefined } : res.data;
        document.title = `${article.value.deleted ? '[已删除] ' : ''}${article.value.title} - 洛谷保存站`;
        if (article.value.deleted) {
            selectedVersion.value = null;
            return;
        }
        void loadArticleExtras(request);
    } catch (err) {
        if (!disposed && request === dataRequest)
            articleError.value = requestErrorMessage(err, '文章加载失败');
    } finally {
        if (!disposed && request === dataRequest) loading.value = false;
    }
};

setupUpdateListener(
    `article_${articleId}`,
    `article:${articleId}:updated`,
    loadData,
    () => Boolean(article.value) && !notFound.value,
    `article:${articleId}:refresh-state`
);
const showSource = ref(false);
const openSource = () => {
    if (article.value?.deleted || forbiddenReason.value || versionError.value) return;
    showSource.value = true;
};

const updating = ref(false);
const isUpdating = computed(() => updating.value || isSaving.value || isRemoteRefreshing.value);

const handleUpdate = async () => {
    if (!articleId || isUpdating.value) return;
    updating.value = true;
    try {
        const response = await requestSave(async () => {
            router.replace({ query: {} });
            if (displayTitle.value) {
                document.title = `${displayTitle.value} - 洛谷保存站`;
            }
            return await submitSaveArticle('文章已更新');
        });
        if (response !== null) {
            notifyWorkflowSubmitted(response, '正在更新文章…');
        } else {
            updating.value = false;
        }
    } catch (err) {
        updating.value = false;
        message.error(requestErrorMessage(err, '更新请求提交失败'));
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
            onPositiveClick: () => startCpOAuthLogin(`/article/${articleId}`)
        });
        return;
    }
    showDeletionModal.value = true;
};

const handleRestore = () => {
    dialog.warning({
        title: '恢复文章',
        content: `确认恢复文章「${article.value?.title || articleId}」？恢复后所有用户都可以重新搜索和查看该文章。`,
        positiveText: '确认恢复',
        negativeText: '取消',
        onPositiveClick: async () => {
            restoring.value = true;
            try {
                const response = await restoreArticle(articleId);
                if (response.code !== 200) {
                    message.error(response.message || '恢复文章失败');
                    return;
                }
                message.success(response.data.restored ? '文章已恢复' : '文章已经处于可见状态');
                await loadData();
            } catch (error) {
                message.error(requestErrorMessage(error, '恢复文章失败'));
            } finally {
                restoring.value = false;
            }
        }
    });
};

const currentCategory = computed(() => {
    if (article.value?.category && ARTICLE_CATEGORIES[article.value.category]) {
        return ARTICLE_CATEGORIES[article.value.category] || UNKNOWN_CATEGORY;
    }
    return UNKNOWN_CATEGORY;
});

const goBack = () => {
    goBackIgnoringHash(router);
};

watch(
    () => [route.query.version, versionHistory.value] as const,
    ([nextQueryVersion], previous) => {
        const prevQueryVersion = previous?.[0];
        const previousContent = versionContent.value;
        selectedVersion.value =
            nextQueryVersion === undefined
                ? (versionHistory.value[0]?.version ?? null)
                : parsePositiveIntId(nextQueryVersion);
        // Only reset TOC when switching versions or displayed content actually changes;
        // background history hydration for the already-rendered latest article must not wipe TOC.
        if (nextQueryVersion !== prevQueryVersion || versionContent.value !== previousContent) {
            tocItems.value = [];
            tocResolved.value = false;
        }
        if (article.value)
            document.title = `${article.value.deleted ? '[已删除] ' : ''}${displayTitle.value} - 洛谷保存站`;
    },
    { immediate: true, flush: 'sync' }
);

const readingProgress = ref(0);
const showReadingProgress = ref(false);
let readingProgressRaf: number | null = null;
let readingScrollEl: HTMLElement | null = null;

const updateReadingProgress = () => {
    readingProgressRaf = null;
    const el = readingScrollEl ?? document.documentElement;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 200) {
        readingProgress.value = 0;
        showReadingProgress.value = false;
        return;
    }
    const scrollTop = el.scrollTop;
    showReadingProgress.value = scrollTop > 24;
    readingProgress.value = Math.min(1, Math.max(0, scrollTop / maxScroll));
};

const scheduleReadingProgress = () => {
    if (readingProgressRaf !== null) return;
    readingProgressRaf = window.requestAnimationFrame(updateReadingProgress);
};

onUnmounted(() => {
    disposed = true;
    dataRequest++;
    stopTaskListener?.();
    stopRevealCurtain?.();
    stopRevealCurtain = null;
    if (readingProgressRaf !== null) {
        window.cancelAnimationFrame(readingProgressRaf);
        readingProgressRaf = null;
    }
    readingScrollEl?.removeEventListener('scroll', scheduleReadingProgress);
    window.removeEventListener('resize', scheduleReadingProgress);
});

onMounted(() => {
    if (!handledByCardCurtain && !reducedMotion.value) {
        stopRevealCurtain = playArticleRevealCurtain(pendingTitle || undefined);
    }
    loadData();
    readingScrollEl = document.querySelector<HTMLElement>('.page-scroll-container');
    if (readingScrollEl && !route.hash) {
        readingScrollEl.scrollTop = 0;
    }
    readingScrollEl?.addEventListener('scroll', scheduleReadingProgress, { passive: true });
    window.addEventListener('resize', scheduleReadingProgress, { passive: true });
    scheduleReadingProgress();
});
</script>

<template>
    <div
        class="reading-progress-bar"
        :class="{
            'is-visible': showReadingProgress && article && !article.deleted && !forbiddenReason
        }"
        :style="{ transform: `scaleX(${readingProgress})` }"
        aria-hidden="true"
    />
    <n-spin :show="isSaving" description="正在保存并处理..." class="saving-spin">
        <div
            class="article-layout"
            :class="{
                'has-toc': showTocRail,
                'has-history':
                    loading || historyLoading || versionHistory.length > 0 || historyError
            }"
        >
            <aside v-if="showTocRail" class="sidebar-left">
                <TableOfContents :items="tocItems" :loading="tocPending" />
            </aside>
            <div class="center-column">
                <Card class="reading-sheet">
                    <div class="archive-article-header">
                        <CardTitle
                            :title="
                                loading
                                    ? pendingTitle || '正在加载文章…'
                                    : forbiddenReason
                                      ? unavailableTitle
                                      : notFound
                                        ? '文章未收录'
                                        : displayTitle || '文章'
                            "
                            :icon="Newspaper"
                        />
                        <LoadingSkeleton :loading="loading">
                            <template #skeleton>
                                <div class="reading-meta-skeleton">
                                    <n-skeleton circle size="small" />
                                    <n-skeleton text style="width: 96px" />
                                    <n-skeleton text style="width: 72px" />
                                    <n-skeleton text style="width: 148px" />
                                </div>
                            </template>

                            <template v-if="article">
                                <div class="reading-meta-bar">
                                    <span class="reading-meta-item">
                                        <UserLink :user="article.author" show-avatar />
                                    </span>
                                    <span class="meta-sep" aria-hidden="true" />
                                    <span class="reading-meta-item category-link">
                                        <NIcon
                                            :component="currentCategory.icon"
                                            :color="currentCategory.color"
                                        />
                                        <span :style="{ color: currentCategory.color }">
                                            {{ currentCategory.label }}
                                        </span>
                                    </span>
                                    <template v-if="displayTime">
                                        <span class="meta-sep" aria-hidden="true" />
                                        <span class="reading-meta-item reading-meta-time">
                                            <NIcon :component="CalendarDays" :size="14" />
                                            <span>
                                                {{
                                                    !isViewingLatest
                                                        ? `归档版本 ${selectedVersion} 本站记录于`
                                                        : '本站更新于'
                                                }}
                                                {{ formatDate(displayTime) }}
                                            </span>
                                        </span>
                                    </template>
                                    <n-tag
                                        v-if="article.deleted"
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
                                        <LuoguSourceButton :path="`/article/${article.id}`" />
                                        <n-button
                                            size="small"
                                            secondary
                                            :disabled="article.deleted || !!versionError"
                                            @click="openSource"
                                        >
                                            <template #icon>
                                                <NIcon :component="Copy" />
                                            </template>
                                            源码
                                        </n-button>
                                        <n-button
                                            v-if="!article.deleted"
                                            size="small"
                                            type="primary"
                                            :loading="isUpdating"
                                            :disabled="isUpdating"
                                            @click="handleUpdate"
                                        >
                                            <template #icon>
                                                <NIcon :component="RefreshCw" />
                                            </template>
                                            {{ isUpdating ? '更新中' : '更新' }}
                                        </n-button>
                                        <n-button
                                            v-if="!article.deleted"
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
                                            v-if="article.deleted && isAdmin"
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
                                    </n-space>
                                </div>
                            </template>
                            <div v-else-if="forbiddenReason" class="reading-body">
                                <n-result
                                    :status="unavailableCode === 404 ? '404' : '403'"
                                    :title="unavailableTitle"
                                    :description="forbiddenReason"
                                >
                                    <template #footer>
                                        <n-space justify="center">
                                            <n-button secondary @click="goBack">返回</n-button>
                                            <LuoguSourceButton
                                                :path="`/article/${articleId}`"
                                                size="medium"
                                            />
                                        </n-space>
                                    </template>
                                </n-result>
                            </div>
                            <div v-else-if="notFound" class="reading-body">
                                <n-result
                                    status="404"
                                    title="该文章尚未被收录"
                                    description="本站还没有归档这篇文章，可以立即提交保存。"
                                >
                                    <template #footer>
                                        <n-space justify="center">
                                            <n-button secondary @click="goBack">返回</n-button>
                                            <LuoguSourceButton
                                                :path="`/article/${articleId}`"
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
                            <div v-else-if="articleError" class="reading-body">
                                <n-alert type="error" title="文章加载失败">
                                    {{ articleError }}
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
                            !articleError &&
                            (loading || bodyLoading || article)
                        "
                        class="main-content reading-body"
                    >
                        <LoadingSkeleton :loading="bodyLoading">
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

                            <n-alert v-if="article?.deleted" type="warning" title="文章已删除">
                                该文章已删除。
                            </n-alert>
                            <template v-else-if="article">
                                <n-alert v-if="versionError" type="error" title="归档版本不可用">
                                    {{ versionError }}
                                    <div class="state-actions">
                                        <n-button @click="router.replace({ query: {} })"
                                            >回到当前版本</n-button
                                        >
                                        <n-button v-if="historyError" @click="loadData"
                                            >重试</n-button
                                        >
                                    </div>
                                </n-alert>
                                <MarkdownViewer
                                    v-else
                                    :key="
                                        isViewingLatest ? 'current' : (selectedVersion ?? 'invalid')
                                    "
                                    :content="versionContent"
                                    :heading-offset="1"
                                    @rendered="handleRendered"
                                />
                            </template>
                        </LoadingSkeleton>
                    </main>
                </Card>

                <template v-if="!loading && article && !article.deleted">
                    <section class="detail-section" aria-label="相关推荐">
                        <Card title="相关推荐">
                            <n-alert v-if="recError" type="error">
                                {{ recError }}
                                <div class="state-actions">
                                    <n-button @click="retryRelevant">重试</n-button>
                                </div>
                            </n-alert>
                            <div
                                v-else-if="recLoading"
                                class="article-list"
                                role="status"
                                aria-label="正在加载相关推荐"
                            >
                                <div v-for="i in 3" :key="i" class="article-item">
                                    <n-skeleton text :repeat="2" />
                                </div>
                            </div>
                            <ul v-else-if="recommended.length" class="article-list">
                                <li v-for="it in recommended" :key="it.id" class="article-item">
                                    <div class="article-item-heading">
                                        <NIcon
                                            :component="Newspaper"
                                            class="article-item-icon"
                                            aria-hidden="true"
                                        />
                                        <RouterLink
                                            class="article-item-title"
                                            :to="`/article/${it.id}`"
                                            >{{ it.title }}</RouterLink
                                        >
                                        <n-tag
                                            v-if="it.reason === 'title'"
                                            class="article-color-tag"
                                            :style="getTagStyle('var(--ui-orange-color)')"
                                            size="small"
                                        >
                                            标题相关
                                        </n-tag>
                                        <n-tag
                                            v-else-if="it.reason === 'vector'"
                                            class="article-color-tag"
                                            :style="getTagStyle('var(--ui-cyan-color)')"
                                            size="small"
                                        >
                                            相似文章
                                        </n-tag>
                                    </div>

                                    <p class="article-summary">
                                        {{ it.summary || '暂无预览...' }}
                                    </p>

                                    <div class="article-meta">
                                        <UserLink :user="it.author" show-avatar />
                                        <n-tag
                                            class="article-color-tag"
                                            :style="getCategoryTagStyle(it.category)"
                                            size="small"
                                        >
                                            <template #icon>
                                                <n-icon :component="getCategoryIcon(it.category)" />
                                            </template>
                                            {{ getCategoryLabel(it.category) }}
                                        </n-tag>
                                    </div>
                                </li>
                            </ul>
                            <n-empty v-else description="暂无相关推荐" />
                        </Card>
                    </section>
                    <div v-if="article" class="detail-section">
                        <ArticleComments :article-id="article.id" />
                    </div>
                </template>
            </div>

            <aside
                v-if="loading || historyLoading || versionHistory.length > 0 || historyError"
                class="sidebar-right"
            >
                <SidebarWidget
                    :title="
                        versionHistory.length ? `历史版本 (${versionHistory.length})` : '历史版本'
                    "
                    :icon="Clock3"
                    class="version-card"
                >
                    <template #header-extra>
                        <n-button
                            v-if="canCompareVersions"
                            size="tiny"
                            quaternary
                            @click="openVersionCompare()"
                        >
                            <template #icon>
                                <NIcon :component="GitCompareArrows" />
                            </template>
                            比对
                        </n-button>
                    </template>
                    <div v-if="loading || historyLoading" class="version-skeleton">
                        <n-skeleton text style="width: 80%" />
                        <n-skeleton text style="width: 60%" />
                        <n-skeleton text style="width: 70%" />
                    </div>
                    <n-alert v-else-if="historyError" type="error">
                        {{ historyError }}
                        <div class="state-actions">
                            <n-button @click="loadData">重试</n-button>
                        </div>
                    </n-alert>
                    <ul v-else class="version-list" aria-label="归档版本列表">
                        <li
                            v-for="(ver, index) in versionHistory"
                            :key="ver.version"
                            class="version-list-entry"
                        >
                            <div class="version-row-wrap">
                                <button
                                    type="button"
                                    class="version-item"
                                    :class="{ 'is-active': selectedVersion === ver.version }"
                                    :aria-current="
                                        selectedVersion === ver.version ? 'true' : undefined
                                    "
                                    @click="handleVersionClick(ver.version)"
                                >
                                    <span class="version-dot" aria-hidden="true"></span>
                                    <span class="version-item-top">
                                        <span class="version-item-heading">
                                            <span class="version-number"
                                                >版本 {{ ver.version }}</span
                                            >
                                            <span v-if="index === 0" class="version-latest-badge">
                                                最新
                                            </span>
                                        </span>
                                        <NIcon
                                            v-if="selectedVersion === ver.version"
                                            :component="Check"
                                            :size="14"
                                            class="version-active-icon"
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <span class="version-item-title">{{ ver.title }}</span>
                                    <time class="version-item-time" :datetime="ver.createdAt">
                                        {{ formatDate(ver.createdAt) }}
                                    </time>
                                </button>
                                <n-tooltip v-if="canCompareVersions && index > 0" :delay="150">
                                    <template #trigger>
                                        <button
                                            type="button"
                                            class="version-quick-compare"
                                            :aria-label="`将版本 ${ver.version} 与最新版本比对`"
                                            @click.stop="
                                                openVersionCompare(
                                                    ver.version,
                                                    versionHistory[0]!.version
                                                )
                                            "
                                        >
                                            <NIcon :component="GitCompareArrows" :size="14" />
                                        </button>
                                    </template>
                                    与最新比对
                                </n-tooltip>
                            </div>
                        </li>
                    </ul>
                </SidebarWidget>
            </aside>
        </div>
    </n-spin>

    <Transition name="ui-float-up">
        <div
            v-if="hasUpdate && article && !article.deleted && !forbiddenReason"
            class="update-floater"
        >
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
        v-if="article && !article.deleted && !forbiddenReason && !versionError"
        v-model:show="showSource"
        :source="versionContent"
    />
    <DeletionRequestModal
        v-model:show="showDeletionModal"
        target-type="article"
        :target-id="articleId"
    />
    <VersionCompareModal
        v-if="canCompareVersions"
        v-model:show="compareOpen"
        v-model:left-version="compareLeftVersion"
        v-model:right-version="compareRightVersion"
        title="文章版本比对"
        :options="compareVersionOptions"
        :left-content="compareLeftContent"
        :right-content="compareRightContent"
    />
</template>

<style scoped>
.sidebar-left,
.sidebar-right {
    display: block;
}

.article-layout {
    width: min(100%, 900px);
    max-width: none;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ui-space-5);
    align-items: start;
}

.article-layout.has-toc {
    width: min(100%, 1160px);
    grid-template-columns: 240px minmax(0, 1fr);
}

.article-layout.has-history {
    width: min(100%, 1160px);
    grid-template-columns: minmax(0, 1fr) 240px;
}

.article-layout.has-toc.has-history {
    width: min(100%, 1420px);
    grid-template-columns: 240px minmax(0, 1fr) 240px;
}
.center-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.archive-article-header {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.archive-article-header :deep(.page-hero) {
    padding: 0 0 var(--ui-space-2);
}

.archive-article-header :deep(.hero-title) {
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

.sidebar-left,
.sidebar-right {
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    align-self: start;
    max-height: calc(100dvh - var(--ui-page-padding) * 2);
    z-index: 1;
}

.main-content {
    min-width: 0;
}

.version-card {
    margin-top: 0;
    margin-bottom: 0;
    max-height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.version-card :deep(.widget-content) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
}
.header-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

@media (max-width: 1200px) {
    .article-layout,
    .article-layout.has-toc,
    .article-layout.has-history,
    .article-layout.has-toc.has-history {
        grid-template-columns: minmax(0, 1fr);
    }

    .sidebar-left,
    .sidebar-right {
        min-width: 0;
    }

    .sidebar-left,
    .sidebar-right,
    .version-card {
        position: static;
        margin-top: 0;
        max-height: none;
    }
}

.category-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.detail-section {
    margin-top: var(--ui-space-2);
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.article-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
}
.article-item {
    min-width: 0;
    padding: var(--ui-space-4) 0;
    border-bottom: 1px solid var(--ui-border-color);
}
.article-item:first-child {
    padding-top: 0;
}
.article-item:last-child {
    padding-bottom: 0;
    border-bottom: none;
}
.article-item-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}
.article-item-icon {
    flex: none;
    color: var(--ui-primary-color);
}
.article-item-title {
    min-width: 0;
    color: var(--ui-link-color);
    font-weight: 600;
    text-decoration: none;
    overflow-wrap: anywhere;
    border-radius: 2px;
}
.article-item-title:hover {
    color: var(--ui-link-hover-color);
    text-decoration: underline;
}
.article-item-title:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}
.article-summary {
    margin: var(--ui-space-2) 0;
    color: var(--ui-secondary-text-color);
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.version-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.article-meta {
    display: flex;
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

.reading-progress-bar {
    position: fixed;
    top: 0;
    left: var(--ui-sider-current-width, 0px);
    right: 0;
    z-index: 1050;
    height: 2px;
    background: var(--ui-primary-color);
    transform-origin: left center;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--ui-motion-fast) var(--ui-motion-ease-out);
}

.reading-progress-bar.is-visible {
    opacity: 0.9;
}

@media (max-width: 768px) {
    .reading-progress-bar {
        left: 0;
        top: calc(52px + env(safe-area-inset-top, 0px));
    }
}

.shadow-button {
    box-shadow: var(--ui-elevated-shadow);
}

.version-list {
    list-style: none;
    margin: 0;
    padding: 2px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.version-list-entry {
    position: relative;
    min-width: 0;
}

.version-list-entry:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 13px;
    top: 22px;
    bottom: -14px;
    width: 1px;
    background: var(--ui-border-color);
    pointer-events: none;
}

.version-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    min-height: 58px;
    padding: 8px 11px 8px 28px;
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

.version-item:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: -2px;
}

.version-dot {
    position: absolute;
    left: 9px;
    top: 13px;
    z-index: 1;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ui-control-border-hover-color);
    box-shadow: 0 0 0 2px var(--ui-card-color);
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        box-shadow var(--ui-motion-fast) var(--ui-motion-ease);
}

.version-item:hover .version-dot {
    background: var(--ui-primary-color);
    box-shadow: 0 0 0 2px var(--ui-panel-color);
}

.version-item.is-active .version-dot {
    background: var(--ui-primary-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary-color) 24%, transparent);
}

.version-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    min-height: 18px;
}

.version-item-heading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.version-number {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--ui-card-title-color);
    font-variant-numeric: tabular-nums;
}

.version-item.is-active .version-number {
    color: var(--ui-primary-color);
}

.version-latest-badge {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-alert-success-background-color);
    color: var(--ui-success-color);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
}

.version-active-icon {
    flex-shrink: 0;
    color: var(--ui-primary-color);
}

.version-item-title {
    font-size: 13px;
    line-height: 1.45;
    color: var(--ui-secondary-text-color);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
}

.version-item.is-active .version-item-title {
    color: var(--ui-text-color);
    font-weight: 500;
}

.version-item-time {
    margin-top: 1px;
    padding-right: 26px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.version-row-wrap {
    position: relative;
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
        color var(--ui-motion-fast) var(--ui-motion-ease);
}

.version-row-wrap:hover .version-quick-compare,
.version-row-wrap:focus-within .version-quick-compare {
    opacity: 1;
}

.version-quick-compare:hover {
    background: var(--ui-control-tag-color);
    color: var(--ui-primary-color);
}
/* noinspection CssUnusedSymbol */
.saving-spin :deep(.n-spin-body) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}
</style>
