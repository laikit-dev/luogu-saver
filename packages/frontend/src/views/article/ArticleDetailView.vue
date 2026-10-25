<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
    useMessage,
    NSpace,
    NButton,
    NIcon,
    NTag,
    NDivider,
    NSkeleton,
    NEmpty,
    NTimeline,
    NTimelineItem,
    NSpin,
    NResult,
    NAlert,
    useDialog
} from 'naive-ui';
import {
    ExternalLink,
    GitCompareArrows,
    Copy,
    RefreshCw,
    Trash2,
    ArrowLeft,
    Newspaper,
    CalendarDays,
    Clock3,
    Library,
    RotateCcw
} from 'lucide-vue-next';

import { useContentSaver } from '@/composables/useContentSaver';
import { getArticleById, getRelevant, getArticleHistory, saveArticle } from '@/api/article';
import { restoreArticle } from '@/api/admin';
import type { Article, PlazaArticle, TocItem } from '@/types/article';
import {
    getCategoryLabel,
    getCategoryIcon,
    getCategoryTagStyle,
    getTagStyle,
    generateTocAndProcessHtml
} from '@/utils/article';

import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import ArticleVersionCompare from '@/components/ArticleVersionCompare.vue';
import SaveArticleButton from '@/components/SaveArticleButton.vue';
import SidebarWidget from '@/components/SidebarWidget.vue';
import UserLink from '@/components/UserLink.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import ArticleComments from '@/components/ArticleComments.vue';
import LoadingSkeleton from '@/components/LoadingSkeleton.vue';
import DeletionRequestModal from '@/components/DeletionRequestModal.vue';
import ViewModeSwitch from '@/components/ViewModeSwitch.vue';
import FocusSidebar from '@/components/FocusSidebar.vue';
import TableOfContents from '@/components/TableOfContents.vue';
import { ARTICLE_CATEGORIES, CACHE_STORAGE_KEY, UNKNOWN_CATEGORY } from '@/utils/constants';
import { formatDate } from '@/utils/render';

import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { useViewMode } from '@/composables/useViewMode';
import { useBookmarks } from '@/composables/useBookmarks';
import { useBookmarkIcons } from '@/composables/useBookmarkIcons';
import { markStarPromptEligible } from '@/composables/useStarPrompt.ts';
import { currentRole, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { ROLE_ADMIN } from '@/utils/permissions.ts';
import { useKnowledgeBase } from '@/utils/knowledge-base.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { requestErrorMessage } from '@/utils/request';

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

const articleId = route.params.id as string;
const article = ref<Article | null>(null);
const loading = ref(true);
const knowledgeBase = useKnowledgeBase();
const { buildLuoguUrl } = useLuoguSource();

const recommended = ref<PlazaArticle[]>([]);
const recLoading = ref(false);
const recError = ref('');
const forbiddenReason = ref('');
const unavailableCode = ref(403);
const unavailableTitle = computed(() =>
    unavailableCode.value === 404 ? '文章不存在' : '文章不可查看'
);

const tocItems = ref<TocItem[]>([]);

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
const showComparison = ref(false);
const historyRefreshKey = ref(0);
const hasComparisonQuery = computed(
    () => route.query.compareFrom !== undefined || route.query.compareTo !== undefined
);
const comparisonVisible = computed(() => showComparison.value || hasComparisonQuery.value);
let dataRequest = 0;
let relevantRequest = 0;
let autoUpdatePending = false;
let disposed = false;

function handleArchiveUnavailable(code: number) {
    dataRequest++;
    article.value = null;
    tocItems.value = [];
    recommended.value = [];
    recError.value = '';
    versionHistory.value = [];
    selectedVersion.value = null;
    historyError.value = '';
    articleError.value = '';
    historyLoading.value = false;
    loading.value = false;
    recLoading.value = false;
    showComparison.value = false;
    unavailableCode.value = code === 404 ? 404 : 403;
    forbiddenReason.value = code === 404 ? '文章不存在或已不可用。' : '文章当前不可查看。';
    document.title = `${unavailableTitle.value} - 洛谷保存站`;
}

// View mode
const { viewMode, isFocus, setViewMode } = useViewMode();

// Bookmarks (only for articles)
const { bookmarks, toggleBookmark, removeBookmark, renameBookmark } = useBookmarks(
    'article',
    articleId
);

// Bookmark heading icons
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

const isViewingLatest = computed(() => route.query.version === undefined);

// An archived version's content comes from the history request.
const bodyLoading = computed(
    () => loading.value || (!isViewingLatest.value && historyLoading.value)
);

const versionError = computed(() => {
    const queryVersion = route.query.version;
    if (queryVersion === undefined) return '';
    if (
        typeof queryVersion !== 'string' ||
        !/^[1-9]\d*$/.test(queryVersion) ||
        Number(queryVersion) > 4294967295
    ) {
        return '归档版本号无效，请选择已有版本。';
    }
    if (loading.value || historyLoading.value) return '';
    if (historyError.value) return historyError.value;
    return versionHistory.value.some(version => version.version === Number(queryVersion))
        ? ''
        : '所选归档版本不存在，未显示当前正文。';
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
    showComparison.value = false;
    const query = { ...route.query };
    delete query.compareFrom;
    delete query.compareTo;
    if (version === versionHistory.value[0]?.version) delete query.version;
    else query.version = String(version);
    await router.replace({ query });
};

const handleRendered = (html: string) => {
    if (comparisonVisible.value || article.value?.deleted || forbiddenReason.value) return;
    const result = generateTocAndProcessHtml(html);
    tocItems.value = result.toc;
};

const triggerRefresh = () => {
    handleRefresh(loadData);
};

const lastUpdate = useLocalStorage(CACHE_STORAGE_KEY + `_article_${articleId}_updated_at`, 0);
const maybeAutoUpdateArticle = async () => {
    if (autoUpdatePending || Date.now() - (lastUpdate.value ?? 0) <= 60 * 60 * 1000) return;

    console.log('Auto update triggered for article', articleId);
    autoUpdatePending = true;
    try {
        const response = await saveArticle(articleId);
        if (response.code !== 200) {
            console.error('Auto update failed', response.code, response.message);
            return;
        }
        lastUpdate.value = Date.now();
    } catch (err) {
        console.error('Auto update failed', err);
    } finally {
        autoUpdatePending = false;
    }
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
            handleArchiveUnavailable(res.code);
            return;
        }
        if (res.code !== 200) {
            recommended.value = [];
            recError.value = '获取相关推荐失败，请重试。';
            return;
        }
        recommended.value = res.data || [];
    } catch (err) {
        if (!isCurrent()) return;
        recommended.value = [];
        recError.value = requestErrorMessage(err, '获取相关推荐失败，请重试。');
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
            handleArchiveUnavailable(res.code);
            return;
        }
        if (res.code !== 200 || !res.data) {
            versionHistory.value = [];
            historyError.value = '加载历史版本失败，请重试。';
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
            historyError.value = requestErrorMessage(err, '加载历史版本失败，请重试。');
        }
    } finally {
        if (!disposed && request === dataRequest) historyLoading.value = false;
    }
};

// Recommendations and history load after the article is shown, each with its own loading state.
const loadArticleExtras = async (request: number) => {
    await Promise.all([loadRelevant(request), loadHistory(request)]);
    if (disposed || request !== dataRequest) return;
    void maybeAutoUpdateArticle();
};

let stopTaskListener: (() => void) | null = null;

const getSaveReportTaskId = (response: Awaited<ReturnType<typeof saveArticle>>) => {
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
        () => {
            stopTaskListener = null;
            dialog.error({
                title: '保存失败',
                content: '文章保存过程中出现错误，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    try {
                        const response = await saveArticle(articleId);
                        trackSaveTask(getSaveReportTaskId(response));
                        notifyWorkflowSubmitted(response, '重试请求已提交');
                    } catch (err) {
                        message.error(requestErrorMessage(err, '重试请求提交失败，请重试。'));
                    }
                },
                maskClosable: false,
                closable: false,
                closeOnEsc: false
            });
        }
    );
};

const submitSaveArticle = async () => {
    const response = await saveArticle(articleId);
    trackSaveTask(getSaveReportTaskId(response));
    return response;
};

const loadData = async () => {
    const request = ++dataRequest;
    loading.value = true;
    article.value = null;
    forbiddenReason.value = '';
    articleError.value = '';
    historyError.value = '';
    versionHistory.value = [];
    recommended.value = [];
    recError.value = '';
    historyLoading.value = false;
    recLoading.value = false;
    tocItems.value = [];
    try {
        const res = await getArticleById(articleId);
        if (disposed || request !== dataRequest) return;
        if (res.code === 404) {
            articleError.value = '文章尚未被本站收录或已不可用。';
            if (!hasComparisonQuery.value && route.query.version === undefined)
                handle404(submitSaveArticle);
            return;
        }
        if (res.code === 403) {
            handleArchiveUnavailable(res.code);
            return;
        }
        if (res.code !== 200 || !res.data) {
            articleError.value = '加载文章失败，请重试。';
            return;
        }
        article.value = res.data.deleted ? { ...res.data, content: undefined } : res.data;
        document.title = `${article.value.deleted ? '[已删除] ' : ''}${article.value.title} - 洛谷保存站`;
        if (article.value.deleted) {
            selectedVersion.value = null;
            showComparison.value = false;
            return;
        }
        historyRefreshKey.value++;
        void loadArticleExtras(request);
    } catch (err) {
        if (!disposed && request === dataRequest)
            articleError.value = requestErrorMessage(err, '加载文章失败，请重试。');
    } finally {
        if (!disposed && request === dataRequest) loading.value = false;
    }
};

setupUpdateListener(`article_${articleId}`, `article:${articleId}:updated`, loadData);
const handleCopy = async () => {
    if (
        comparisonVisible.value ||
        article.value?.deleted ||
        forbiddenReason.value ||
        versionError.value
    )
        return;
    try {
        await navigator.clipboard.writeText(versionContent.value);
        message.success('源码已复制到剪贴板');
    } catch {
        message.error('复制失败');
    }
};

const updating = ref(false);

const handleUpdate = async () => {
    if (!articleId || updating.value) return;
    updating.value = true;
    try {
        router.replace({ query: {} });
        if (displayTitle.value) {
            document.title = `${displayTitle.value} - 洛谷保存站`;
        }
        const response = await submitSaveArticle();
        notifyWorkflowSubmitted(response, '更新请求已提交');
    } catch (err) {
        message.error(requestErrorMessage(err, '更新请求提交失败，请重试。'));
    } finally {
        updating.value = false;
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
                    message.error('恢复文章失败，请重试。');
                    return;
                }
                message.success(response.data.restored ? '文章已恢复' : '文章已经处于可见状态');
                await loadData();
            } catch (error) {
                message.error(requestErrorMessage(error, '恢复文章失败，请重试。'));
            } finally {
                restoring.value = false;
            }
        }
    });
};

const isInKnowledgeBase = computed(() => knowledgeBase.hasArticle(articleId));

const handleKnowledgeBaseToggle = () => {
    if (!article.value) return;
    if (!isAuthenticated.value) {
        message.warning('请先登录后再管理知识库');
        startCpOAuthLogin(`/article/${articleId}`);
        return;
    }

    if (isInKnowledgeBase.value) {
        knowledgeBase.removeArticle(articleId);
        message.success('已从知识库移除');
        return;
    }

    const result = knowledgeBase.addArticle({ id: article.value.id, title: article.value.title });
    if (!result.ok && result.reason === 'limit') {
        message.warning('知识库最多存放 10 篇文章');
        return;
    }
    message.success(result.reason === 'exists' ? '文章已在知识库中' : '已加入知识库');
};

const currentCategory = computed(() => {
    if (article.value?.category && ARTICLE_CATEGORIES[article.value.category]) {
        return ARTICLE_CATEGORIES[article.value.category] || UNKNOWN_CATEGORY;
    }
    return UNKNOWN_CATEGORY;
});

watch(
    () => [route.query.version, versionHistory.value],
    () => {
        const queryVersion = route.query.version;
        selectedVersion.value =
            queryVersion === undefined
                ? (versionHistory.value[0]?.version ?? null)
                : typeof queryVersion === 'string' && /^[1-9]\d*$/.test(queryVersion)
                  ? Number(queryVersion)
                  : null;
        tocItems.value = [];
        if (article.value)
            document.title = `${article.value.deleted ? '[已删除] ' : ''}${displayTitle.value} - 洛谷保存站`;
    },
    { immediate: true, flush: 'sync' }
);

watch(
    hasComparisonQuery,
    present => {
        if (!present) showComparison.value = false;
    },
    { flush: 'sync' }
);

watch(
    comparisonVisible,
    () => {
        tocItems.value = [];
    },
    { flush: 'sync' }
);

onUnmounted(() => {
    disposed = true;
    dataRequest++;
    stopTaskListener?.();
});

onMounted(() => {
    loadData();
});
</script>

<template>
    <n-spin :show="isSaving" description="正在保存并处理..." class="saving-spin">
        <div
            class="article-layout"
            :class="{
                'has-toc': !isFocus && tocItems.length > 0,
                'has-history':
                    !isFocus &&
                    (loading || historyLoading || versionHistory.length > 0 || historyError),
                'is-focus-mode': isFocus
            }"
        >
            <!-- Default mode sidebar-left (TOC) -->
            <aside v-if="!isFocus" class="sidebar-left">
                <TableOfContents :items="tocItems" />
            </aside>

            <div class="center-column" :class="{ 'focus-center': isFocus }">
                <div class="archive-article-header">
                    <CardTitle
                        :title="
                            loading
                                ? '正在加载文章…'
                                : forbiddenReason
                                  ? unavailableTitle
                                  : displayTitle || '文章'
                        "
                        :icon="Newspaper"
                    />
                    <LoadingSkeleton :loading="loading">
                        <template #skeleton>
                            <Card>
                                <div style="margin-bottom: var(--ui-space-2)">
                                    <n-skeleton
                                        text
                                        style="
                                            width: 40%;
                                            height: 28px;
                                            margin-bottom: var(--ui-space-2);
                                        "
                                    />
                                </div>
                                <n-divider style="margin: var(--ui-space-3) 0" />
                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="label">作者</span>
                                        <div
                                            style="
                                                display: flex;
                                                align-items: center;
                                                gap: var(--ui-space-2);
                                                margin-top: var(--ui-space-1);
                                            "
                                        >
                                            <n-skeleton circle size="small" />
                                            <n-skeleton text style="width: 80px" />
                                        </div>
                                    </div>
                                    <div class="info-item">
                                        <span class="label">分类</span>
                                        <div
                                            style="
                                                display: flex;
                                                align-items: center;
                                                gap: var(--ui-space-2);
                                                margin-top: var(--ui-space-1);
                                            "
                                        >
                                            <n-skeleton width="18px" height="18px" />
                                            <n-skeleton text style="width: 60px" />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </template>

                        <div v-if="article">
                            <Card>
                                <div class="meta-row">
                                    <n-tag
                                        v-if="article.deleted"
                                        type="error"
                                        size="small"
                                        :bordered="false"
                                        >已删除</n-tag
                                    >
                                    <n-tag v-if="displayTime" :bordered="false" size="small">
                                        <template #icon>
                                            <NIcon :component="CalendarDays" />
                                        </template>
                                        {{
                                            !isViewingLatest
                                                ? `归档版本 ${selectedVersion} 本站记录于`
                                                : '本站更新于'
                                        }}
                                        {{ formatDate(displayTime) }}
                                    </n-tag>
                                </div>

                                <n-divider style="margin: var(--ui-space-3) 0" />

                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="label">作者</span>
                                        <UserLink :user="article.author" show-avatar />
                                    </div>
                                    <div class="info-item">
                                        <span class="label">分类</span>
                                        <div class="category-link">
                                            <NIcon
                                                :component="currentCategory.icon"
                                                :color="currentCategory.color"
                                            />
                                            <span
                                                :style="{
                                                    color: currentCategory.color
                                                }"
                                                >{{ currentCategory.label }}</span
                                            >
                                        </div>
                                    </div>
                                </div>

                                <n-divider style="margin: var(--ui-space-3) 0" />

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
                                            :href="buildLuoguUrl(`/article/${article.id}`)"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <template #icon>
                                                <NIcon :component="ExternalLink" />
                                            </template>
                                            原站
                                        </n-button>
                                        <n-button
                                            size="small"
                                            secondary
                                            :disabled="
                                                comparisonVisible ||
                                                article.deleted ||
                                                !!versionError
                                            "
                                            @click="handleCopy"
                                        >
                                            <template #icon>
                                                <NIcon :component="Copy" />
                                            </template>
                                            源码
                                        </n-button>
                                        <n-button
                                            v-if="!article.deleted"
                                            size="small"
                                            secondary
                                            :type="comparisonVisible ? 'primary' : 'default'"
                                            @click="showComparison = true"
                                        >
                                            <template #icon>
                                                <NIcon :component="GitCompareArrows" />
                                            </template>
                                            版本对比
                                        </n-button>
                                        <SaveArticleButton
                                            v-if="!article.deleted"
                                            :article-id="articleId"
                                            size="small"
                                            :show-library-link="false"
                                        />
                                        <n-button
                                            v-if="!article.deleted"
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
                                            v-if="!article.deleted"
                                            size="small"
                                            secondary
                                            :type="isInKnowledgeBase ? 'warning' : 'info'"
                                            @click="handleKnowledgeBaseToggle"
                                        >
                                            <template #icon>
                                                <NIcon :component="Library" />
                                            </template>
                                            {{ isInKnowledgeBase ? '移出知识库' : '加入知识库' }}
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
                                        <ViewModeSwitch
                                            :model-value="viewMode"
                                            @update:model-value="setViewMode"
                                        />
                                    </n-space>
                                </div>
                                <n-alert v-if="isFocus && historyError" type="error">
                                    {{ historyError }}
                                    <div class="state-actions">
                                        <n-button @click="loadData">重试</n-button>
                                    </div>
                                </n-alert>
                            </Card>
                        </div>
                        <Card v-else-if="forbiddenReason">
                            <n-result
                                :status="unavailableCode === 404 ? '404' : '403'"
                                :title="unavailableTitle"
                                :description="forbiddenReason"
                            >
                                <template #footer>
                                    <n-space justify="center">
                                        <n-button secondary @click="router.go(-1)"> 返回 </n-button>
                                        <n-button
                                            secondary
                                            tag="a"
                                            :href="buildLuoguUrl(`/article/${articleId}`)"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            原站
                                        </n-button>
                                    </n-space>
                                </template>
                            </n-result>
                        </Card>
                        <Card v-else-if="articleError">
                            <n-alert type="error" title="文章不可读取">
                                {{ articleError }}
                                <div class="state-actions">
                                    <n-button @click="loadData">重试</n-button>
                                </div>
                            </n-alert>
                        </Card>
                    </LoadingSkeleton>
                </div>

                <main v-if="!forbiddenReason" class="main-content">
                    <div>
                        <LoadingSkeleton :loading="bodyLoading">
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

                            <ArticleVersionCompare
                                v-if="article && !article.deleted && comparisonVisible"
                                :article-id="articleId"
                                :refresh-key="historyRefreshKey"
                                @close="showComparison = false"
                                @unavailable="handleArchiveUnavailable"
                            />
                            <Card v-else-if="article?.deleted">
                                <n-alert type="warning" title="文章已删除"
                                    >该文章当前不可查看，未加载历史正文。</n-alert
                                >
                            </Card>
                            <Card v-else-if="article">
                                <n-alert v-if="versionError" type="error" title="归档版本不可查看">
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
                            </Card>
                        </LoadingSkeleton>
                    </div>

                    <!-- Keep recommendations and comments outside comparison mode. -->
                    <template
                        v-if="
                            !comparisonVisible &&
                            !isFocus &&
                            !loading &&
                            article &&
                            !article.deleted
                        "
                    >
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
                                                    <n-icon
                                                        :component="getCategoryIcon(it.category)"
                                                    />
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
                </main>
            </div>

            <!-- Default mode sidebar-right (version history) -->
            <aside v-if="!isFocus" class="sidebar-right">
                <SidebarWidget
                    v-if="loading || historyLoading || versionHistory.length > 0 || historyError"
                    title="历史版本"
                    :icon="Clock3"
                    class="version-card"
                >
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
                    <n-timeline v-else class="version-timeline">
                        <n-timeline-item
                            v-for="ver in versionHistory"
                            :key="ver.version"
                            :time="formatDate(ver.createdAt)"
                            :type="selectedVersion === ver.version ? 'success' : 'default'"
                        >
                            <template #header>
                                <button
                                    type="button"
                                    class="version-timeline-button"
                                    :aria-current="
                                        selectedVersion === ver.version ? 'true' : undefined
                                    "
                                    @click="handleVersionClick(ver.version)"
                                >
                                    版本 {{ ver.version }}
                                </button>
                            </template>
                            {{ ver.title }}
                        </n-timeline-item>
                    </n-timeline>
                </SidebarWidget>
            </aside>

            <!-- Focus mode sidebar-right (TOC + Bookmarks + Version popover) -->
            <aside v-if="isFocus" class="sidebar-right focus-sidebar-right">
                <FocusSidebar
                    :toc-items="tocItems"
                    :bookmarks="bookmarks"
                    :version-history="versionHistory"
                    :selected-version="selectedVersion"
                    @select-version="handleVersionClick"
                    @remove-bookmark="removeBookmark"
                    @rename-bookmark="
                        (bookmarkId: string, newName: string) => renameBookmark(bookmarkId, newName)
                    "
                />
            </aside>
        </div>
    </n-spin>

    <div v-if="hasUpdate && article && !article.deleted && !forbiddenReason" class="update-floater">
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

    <DeletionRequestModal
        v-model:show="showDeletionModal"
        target-type="article"
        :target-id="articleId"
    />
</template>

<style scoped>
.sidebar-left,
.sidebar-right {
    display: block;
}

.article-layout {
    width: min(100%, 1600px);
    max-width: none;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 280px;
    gap: var(--ui-space-5);
    align-items: start;
}

.article-layout.has-history {
    grid-template-columns: 280px minmax(0, 1fr) 280px;
}

/* Focus mode: wider content, sidebar on right only */
.article-layout.is-focus-mode {
    grid-template-columns: minmax(0, 1fr) 280px;
}

.article-layout.is-focus-mode .focus-sidebar-right {
    min-width: 0;
    position: sticky;
    top: var(--ui-space-5);
    margin-top: -28px;
    align-self: start;
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
    gap: var(--ui-space-4);
}

.archive-article-header :deep(.hero-title) {
    overflow-wrap: anywhere;
}

.sidebar-left {
    min-width: 0;
    position: sticky;
    top: 0;
    align-self: start;
    max-height: calc(100vh - 130px);
    z-index: 1;
}

.sidebar-right {
    min-width: 0;
    align-self: start;
}

.main-content {
    min-width: 0;
}

.version-card {
    position: sticky;
    top: var(--ui-space-5);
    margin-top: 0;
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
    .article-layout.has-toc.has-history,
    .article-layout.is-focus-mode {
        grid-template-columns: minmax(0, 1fr);
    }

    .sidebar-left,
    .sidebar-right,
    .focus-sidebar-right {
        min-width: 0;
    }

    .sidebar-left,
    .version-card,
    .focus-sidebar-right {
        position: static;
        margin-top: 0;
        max-height: none;
    }
}

.meta-row {
    margin-bottom: var(--ui-space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.info-item {
    background: linear-gradient(180deg, var(--ui-panel-color), var(--ui-body-gradient-end));
    padding: 10px var(--ui-space-3);
    border-radius: var(--ui-card-radius);
    border: 1px solid var(--ui-border-color);
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-1);
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
}

.label {
    color: var(--ui-muted-text-color);
}

.category-link {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.detail-section {
    margin-top: var(--ui-section-gap);
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

@media (max-width: 640px) {
    .info-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

.article-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

.update-floater {
    position: fixed;
    bottom: var(--ui-space-8);
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

.version-timeline-button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}

.version-timeline-button:hover {
    color: var(--ui-primary-color);
}

.version-timeline-button:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
    border-radius: var(--ui-card-radius);
}

/* noinspection CssUnusedSymbol */
.saving-spin :deep(.n-spin-body) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}
</style>
