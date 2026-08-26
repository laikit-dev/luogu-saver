<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    useMessage,
    NSpace,
    NButton,
    NIcon,
    NTag,
    NDivider,
    NSkeleton,
    NTimeline,
    NTimelineItem,
    NSpin,
    NResult,
    useDialog
} from 'naive-ui';
import {
    Share2,
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
const forbiddenReason = ref('');

const tocItems = ref<TocItem[]>([]);

interface VersionItem {
    version: number;
    createdAt: string;
    title?: string;
    content: string;
}
const versionHistory = ref<VersionItem[]>([]);
const selectedVersion = ref<number | null>(null);

// View mode
const { viewMode, isFocus, setViewMode } = useViewMode();

// Bookmarks (only for articles)
const { bookmarks, toggleBookmark, removeBookmark, renameBookmark } = useBookmarks(articleId);

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

const isViewingLatest = computed(() => {
    return (
        selectedVersion.value == null || selectedVersion.value === versionHistory.value[0]?.version
    );
});

const versionContent = computed(() => {
    if (isViewingLatest.value) return article.value?.content ?? '';
    const ver = versionHistory.value.find(v => v.version === selectedVersion.value);
    return ver?.content ?? article.value?.content ?? '';
});

const displayTitle = computed(() => {
    if (isViewingLatest.value) return article.value?.title ?? '';
    const ver = versionHistory.value.find(v => v.version === selectedVersion.value);
    return ver?.title ?? article.value?.title ?? '';
});

const displayTime = computed(() => {
    if (isViewingLatest.value) return article.value?.updatedAt ?? '';
    const ver = versionHistory.value.find(v => v.version === selectedVersion.value);
    return ver?.createdAt ?? article.value?.updatedAt ?? '';
});

const handleVersionClick = async (version: number) => {
    selectedVersion.value = version;
    const isLatest = version === versionHistory.value[0]?.version;
    await router.replace({ query: isLatest ? {} : { version: String(version) } });
    const ver = versionHistory.value.find(v => v.version === version);
    const title = isLatest
        ? (article.value?.title ?? '')
        : (ver?.title ?? article.value?.title ?? '');
    document.title = `${title} - 洛谷保存站`;
};

const handleRendered = (html: string) => {
    const result = generateTocAndProcessHtml(html);
    tocItems.value = result.toc;
};

const triggerRefresh = () => {
    handleRefresh(loadData);
};

const lastUpdate = useLocalStorage(CACHE_STORAGE_KEY + `_article_${articleId}_updated_at`, 0);
const maybeAutoUpdateArticle = () => {
    if (Date.now() - (lastUpdate.value ?? 0) <= 60 * 60 * 1000) return;

    console.log('Auto update triggered for article', articleId);
    saveArticle(articleId).catch(err => console.error('Auto update failed', err));
    lastUpdate.value = Date.now();
};

const loadRelevant = async () => {
    if (!articleId) return;
    recLoading.value = true;
    try {
        const res = await getRelevant(articleId);
        if (res.code !== 200) {
            recommended.value = [];
            return;
        }
        const items: PlazaArticle[] = res.data;
        recommended.value = items || [];
    } catch (err: any) {
        console.error(err);
        message.error('获取相关推荐失败');
    } finally {
        recLoading.value = false;
    }
};

const loadHistory = async () => {
    if (!articleId) return;
    try {
        const res = await getArticleHistory(articleId);
        if (res.code !== 200) {
            versionHistory.value = [];
            return;
        }
        if (res.data) {
            versionHistory.value = res.data
                .map(h => ({
                    version: h.version,
                    createdAt: h.createdAt,
                    title: h.title,
                    content: h.content
                }))
                .sort((a, b) => b.version - a.version);
        }
    } catch (err) {
        console.error('Failed to load history', err);
    }
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
        error => {
            stopTaskListener = null;
            dialog.error({
                title: '保存失败',
                content: error || '文章保存过程中出现错误，请重试。',
                positiveText: '重试',
                negativeText: '取消',
                onPositiveClick: async () => {
                    const response = await saveArticle(articleId);
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

const submitSaveArticle = async () => {
    const response = await saveArticle(articleId);
    trackSaveTask(getSaveReportTaskId(response));
    return response;
};

const loadData = async () => {
    loading.value = true;
    forbiddenReason.value = '';
    try {
        const res = await getArticleById(articleId);
        if (res.code === 404) {
            handle404(submitSaveArticle);
            return;
        }
        if (res.code === 403) {
            article.value = null;
            tocItems.value = [];
            recommended.value = [];
            versionHistory.value = [];
            forbiddenReason.value = res.message || '文章已删除';
            document.title = '文章不可查看 - 洛谷保存站';
            return;
        }
        if (res.code !== 200 || !res.data) {
            message.error(res.message || '加载失败');
            return;
        }
        article.value = res.data;

        document.title = `${article.value.deleted ? '[已删除] ' : ''}${article.value.title} - 洛谷保存站`;

        if (article.value.deleted) {
            recommended.value = [];
            versionHistory.value = [];
            selectedVersion.value = null;
            return;
        }

        await Promise.all([loadRelevant(), loadHistory()]);
        const queryVersion = Number(route.query.version);
        const latestVersion = versionHistory.value[0]?.version;
        if (queryVersion && versionHistory.value.some(v => v.version === queryVersion)) {
            selectedVersion.value = queryVersion;
            const ver = versionHistory.value.find(v => v.version === queryVersion);
            if (ver?.title) {
                document.title = `${ver.title} - 洛谷保存站`;
            }
        } else if (latestVersion) {
            selectedVersion.value = latestVersion;
        }
        maybeAutoUpdateArticle();
    } catch (err: any) {
        message.error(err.message || '加载失败');
    } finally {
        loading.value = false;
    }
};

setupUpdateListener(`article_${articleId}`, `article:${articleId}:updated`, loadData);

const openArticle = (id: string) => {
    const route = router.resolve({ path: `/article/${id}` });
    const newWin = window.open(route.href, '_blank');
    if (newWin) newWin.opener = null;
};

const handleCopy = async () => {
    const content = isViewingLatest.value
        ? article.value?.content
        : versionHistory.value.find(v => v.version === selectedVersion.value)?.content;
    if (content) {
        try {
            await navigator.clipboard.writeText(content);
            message.success('源码已复制到剪贴板');
        } catch {
            message.error('复制失败');
        }
    }
};

const handleUpdate = async () => {
    if (!articleId) return;
    try {
        router.replace({ query: {} });
        if (displayTitle.value) {
            document.title = `${displayTitle.value} - 洛谷保存站`;
        }
        const response = await submitSaveArticle();
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
                    throw new Error(response.message || '恢复文章失败');
                }
                message.success(response.data.restored ? '文章已恢复' : '文章已经处于可见状态');
                await loadData();
            } catch (error) {
                message.error(error instanceof Error ? error.message : '恢复文章失败');
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
                'has-history': !isFocus && (loading || versionHistory.length > 0),
                'is-focus-mode': isFocus
            }"
        >
            <!-- Default mode sidebar-left (TOC) -->
            <aside v-if="!isFocus" class="sidebar-left">
                <TableOfContents :items="tocItems" />
            </aside>

            <div class="center-column" :class="{ 'focus-center': isFocus }">
                <div class="article-header">
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
                                        <div
                                            style="
                                                display: flex;
                                                align-items: center;
                                                gap: 8px;
                                                margin-top: 4px;
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
                                                gap: 8px;
                                                margin-top: 4px;
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
                            <Card
                                :title="displayTitle"
                                :icon="Newspaper"
                                :class="{ 'deleted-article-card': article.deleted }"
                            >
                                <template #title-extra>
                                    <n-tag
                                        v-if="article.deleted"
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
                                        {{
                                            !isViewingLatest
                                                ? `版本 ${selectedVersion} 创建于`
                                                : '更新于'
                                        }}
                                        {{ formatDate(displayTime) }}
                                    </n-tag>
                                </div>

                                <n-divider style="margin: 12px 0" />

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
                                            :href="buildLuoguUrl(`/article/${article.id}`)"
                                            target="_blank"
                                        >
                                            <template #icon>
                                                <NIcon :component="Share2" />
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
                                            v-if="!article.deleted"
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
                            </Card>
                        </div>
                        <Card v-else-if="forbiddenReason" title="文章不可查看" :icon="Newspaper">
                            <n-result
                                status="403"
                                title="文章不可查看"
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

                            <Card v-if="article">
                                <MarkdownViewer
                                    :content="versionContent"
                                    @rendered="handleRendered"
                                />
                            </Card>
                        </LoadingSkeleton>
                    </div>

                    <!-- Only show recommended/comments for active articles in default mode -->
                    <template v-if="!isFocus && !loading && article && !article.deleted">
                        <div style="margin-top: 20px">
                            <LoadingSkeleton :loading="recLoading">
                                <template #skeleton>
                                    <Card title="相关推荐">
                                        <div class="article-list">
                                            <div v-for="i in 3" :key="i" class="article-item">
                                                <n-skeleton text :repeat="2" />
                                            </div>
                                        </div>
                                    </Card>
                                </template>

                                <Card title="相关推荐">
                                    <div v-if="recommended.length" class="article-list">
                                        <div
                                            v-for="it in recommended"
                                            :key="it.id"
                                            class="article-item"
                                        >
                                            <Card
                                                :title="it.title"
                                                :icon="Newspaper"
                                                class="clickable-card"
                                                @click="openArticle(it.id)"
                                            >
                                                <template #title-extra>
                                                    <n-tag
                                                        v-if="it.reason === 'title'"
                                                        class="article-color-tag"
                                                        :style="
                                                            getTagStyle('var(--ui-orange-color)')
                                                        "
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
                                                </template>

                                                <div class="article-summary">
                                                    {{ it.summary || '暂无预览...' }}
                                                </div>

                                                <n-divider style="margin: 12px 0" />

                                                <div class="article-meta">
                                                    <div class="left">
                                                        <UserLink :user="it.author" show-avatar />
                                                        <n-tag
                                                            class="article-color-tag"
                                                            :style="
                                                                getCategoryTagStyle(it.category)
                                                            "
                                                            size="small"
                                                        >
                                                            <template #icon>
                                                                <n-icon
                                                                    :component="
                                                                        getCategoryIcon(it.category)
                                                                    "
                                                                />
                                                            </template>
                                                            {{ getCategoryLabel(it.category) }}
                                                        </n-tag>
                                                    </div>
                                                    <div class="right">
                                                        <n-button
                                                            text
                                                            size="small"
                                                            type="primary"
                                                            @click.stop="openArticle(it.id)"
                                                        >
                                                            阅读全文
                                                        </n-button>
                                                    </div>
                                                </div>
                                            </Card>
                                        </div>
                                    </div>
                                    <div v-else class="empty-recommendation">暂无相关推荐</div>
                                </Card>
                            </LoadingSkeleton>
                        </div>
                        <div v-if="article" style="margin-top: 20px">
                            <ArticleComments :article-id="article.id" />
                        </div>
                    </template>
                </main>
            </div>

            <!-- Default mode sidebar-right (version history) -->
            <aside v-if="!isFocus" class="sidebar-right">
                <SidebarWidget
                    v-if="loading || versionHistory.length > 0"
                    title="历史版本"
                    :icon="Clock3"
                    class="version-card"
                >
                    <div v-if="loading" class="version-skeleton">
                        <n-skeleton text style="width: 80%" />
                        <n-skeleton text style="width: 60%" />
                        <n-skeleton text style="width: 70%" />
                    </div>
                    <n-timeline v-else class="version-timeline">
                        <n-timeline-item
                            v-for="ver in versionHistory"
                            :key="ver.version"
                            :title="`版本 ${ver.version}`"
                            :content="ver.title"
                            :time="formatDate(ver.createdAt)"
                            :type="selectedVersion === ver.version ? 'success' : 'default'"
                            class="version-timeline-item"
                            @click="handleVersionClick(ver.version)"
                        />
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

    <div v-if="hasUpdate && !article?.deleted" class="update-floater">
        <n-button type="primary" circle size="large" class="shadow-button" @click="triggerRefresh">
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
    gap: 20px;
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
    top: 20px;
    margin-top: -28px;
    align-self: start;
}

.center-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
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

.deleted-article-card :deep(.card-title) {
    color: var(--ui-error-color) !important;
}

.version-card {
    position: sticky;
    top: 20px;
    margin-top: 0;
}

.header-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
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
    margin-bottom: 8px;
    display: flex;
    gap: 8px;
}

.info-item {
    background: linear-gradient(180deg, var(--ui-panel-color), var(--ui-body-gradient-end));
    padding: 10px 12px;
    border-radius: var(--ui-card-radius);
    border: 1px solid var(--ui-border-color);
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}

.label {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}

.category-link {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.article-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.article-item {
    margin-bottom: 0;
}
.clickable-card {
    cursor: pointer;
}
.article-summary {
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    line-height: 1.6;
    margin-bottom: 8px;
}

.empty-recommendation {
    color: var(--ui-muted-text-color);
    font-size: 14px;
}

.version-skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

@media (max-width: 640px) {
    .info-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

.article-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
}
.article-meta .left {
    display: flex;
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

.version-timeline-item {
    cursor: pointer;
}

/* noinspection CssUnusedSymbol */
.saving-spin :deep(.n-spin-body) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}
</style>
