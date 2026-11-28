<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isCancel } from 'axios';
import { NAlert, NSkeleton, NSpace, NEmpty, NButton, NIcon, useMessage } from 'naive-ui';
import { MessagesSquare, RefreshCw } from 'lucide-vue-next';

import { getArticleComments, refreshArticleComments } from '@/api/comment';
import {
    resolveLinksBatch,
    type ResolvedLinkArticle,
    type ResolvedLinkPaste,
    type ResolvedLinkUser
} from '@/api/links';
import socket from '@/utils/websocket';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request';
import {
    splitTextWithEnhancedLinks,
    type ParsedEnhancedLink,
    type TextLinkSegment
} from '@/utils/enhanced-links';
import type { ArticleComment } from '@/types/comment';

import Card from '@/components/Card.vue';
import LinkIcon from '@/components/LinkIcon.vue';
import UserLink from '@/components/UserLink.vue';

const props = defineProps<{
    articleId: string;
}>();

const COMMENTS_PAGE_LIMIT = 20;
const LOAD_ERROR_MESSAGE = '评论加载失败';
const REFRESH_ERROR_MESSAGE = '刷新评论失败';

const message = useMessage();

const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref('');
const loadMoreError = ref('');
const refreshing = ref(false);
const remoteRefreshing = ref(false);
const isRefreshing = computed(() => refreshing.value || remoteRefreshing.value);
const comments = ref<ArticleComment[]>([]);
const nextCursor = ref<string | null>(null);
const fetchedAt = ref<string | null>(null);

const resolvedUsers = ref<Record<string, ResolvedLinkUser>>({});
const resolvedArticles = ref<Record<string, ResolvedLinkArticle>>({});
const resolvedPastes = ref<Record<string, ResolvedLinkPaste>>({});

const parsedComments = computed(() =>
    comments.value.map(comment => ({
        comment,
        segments: splitTextWithEnhancedLinks(comment.content)
    }))
);

function getResolvedUser(seg: TextLinkSegment): ResolvedLinkUser | undefined {
    if (seg.type !== 'link' || seg.parsed?.kind !== 'user') return undefined;
    return resolvedUsers.value[seg.parsed.id];
}

function inSiteLinkLabel(seg: Extract<TextLinkSegment, { type: 'link' }>): string {
    const parsed = seg.parsed;
    if (!parsed) return seg.rawUrl;
    if (parsed.kind === 'article') {
        return resolvedArticles.value[parsed.id]?.title || seg.rawUrl;
    }
    if (parsed.kind === 'paste') {
        const paste = resolvedPastes.value[parsed.id];
        if (paste) {
            return paste.authorName ? `${paste.authorName} 的剪贴板` : `剪贴板 ${paste.id}`;
        }
        return seg.rawUrl;
    }
    return seg.rawUrl;
}

function linkTooltip(parsed: ParsedEnhancedLink): string {
    if (parsed.kind === 'article') {
        const article = resolvedArticles.value[parsed.id];
        if (article) {
            return article.authorName ? `${article.title} · ${article.authorName}` : article.title;
        }
    }
    if (parsed.kind === 'paste') {
        const paste = resolvedPastes.value[parsed.id];
        if (paste) {
            const meta = paste.authorName ? paste.authorName : `剪贴板 ${paste.id}`;
            return paste.preview ? `[剪贴板 ${paste.id}] ${meta}: ${paste.preview}` : meta;
        }
    }
    return parsed.inSitePath ? '站内打开' : parsed.canonicalHref;
}

async function resolveCommentLinks(list: ArticleComment[]) {
    const userIds = new Set<number>();
    const articleIds = new Set<string>();
    const pasteIds = new Set<string>();

    for (const c of list) {
        for (const seg of splitTextWithEnhancedLinks(c.content)) {
            if (seg.type !== 'link' || !seg.parsed) continue;
            if (seg.parsed.kind === 'user' && seg.parsed.numericId)
                userIds.add(seg.parsed.numericId);
            else if (seg.parsed.kind === 'article') articleIds.add(seg.parsed.id);
            else if (seg.parsed.kind === 'paste') pasteIds.add(seg.parsed.id);
        }
    }

    if (userIds.size === 0 && articleIds.size === 0 && pasteIds.size === 0) return;

    const currentArticleId = props.articleId;
    const resolved = await resolveLinksBatch({
        userIds: [...userIds],
        articleIds: [...articleIds],
        pasteIds: [...pasteIds]
    });
    if (disposed || props.articleId !== currentArticleId) return;

    if (Object.keys(resolved.users).length > 0) {
        resolvedUsers.value = { ...resolvedUsers.value, ...resolved.users };
    }
    if (Object.keys(resolved.articles).length > 0) {
        resolvedArticles.value = { ...resolvedArticles.value, ...resolved.articles };
    }
    if (Object.keys(resolved.pastes).length > 0) {
        resolvedPastes.value = { ...resolvedPastes.value, ...resolved.pastes };
    }
}

let disposed = false;
let loadRequest = 0;
let activeController: AbortController | null = null;

// Remember what was subscribed so detaching after an articleId change leaves the old room.
let attached: { room: string; event: string; refreshStateEvent: string } | null = null;

function onCommentsUpdated() {
    remoteRefreshing.value = false;
    void load(false, /* silent */ true);
}

function onCommentsRefreshState(payload?: { refreshing?: boolean }) {
    remoteRefreshing.value = Boolean(payload?.refreshing);
}

function attachSocket() {
    if (attached || disposed) return;
    const room = `article_${props.articleId}`;
    const event = `article:${props.articleId}:comments-updated`;
    const refreshStateEvent = `article:${props.articleId}:comments-refresh-state`;
    socket.getInstance().on(event, onCommentsUpdated);
    socket.getInstance().on(refreshStateEvent, onCommentsRefreshState);
    socket.joinRoom(room, true);
    attached = { room, event, refreshStateEvent };
}

function detachSocket() {
    if (!attached) return;
    socket.getInstance().off(attached.event, onCommentsUpdated);
    socket.getInstance().off(attached.refreshStateEvent, onCommentsRefreshState);
    remoteRefreshing.value = false;
    socket.leaveRoom(attached.room);
    attached = null;
}

async function load(append = false, silent = false) {
    if (append && (loadingMore.value || loading.value || !nextCursor.value)) return;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const request = ++loadRequest;
    const requestedCursor = append ? (nextCursor.value ?? undefined) : undefined;

    if (append) {
        loadingMore.value = true;
        loadMoreError.value = '';
    } else if (!silent) {
        loading.value = true;
        loadingMore.value = false;
        loadError.value = '';
        loadMoreError.value = '';
    }

    try {
        const res = await getArticleComments(
            props.articleId,
            { cursor: requestedCursor, limit: COMMENTS_PAGE_LIMIT },
            controller.signal
        );
        if (disposed || request !== loadRequest) return;
        if (res.code !== 200 || !res.data) {
            const msg = res.message || LOAD_ERROR_MESSAGE;
            if (append) loadMoreError.value = msg;
            else if (loading.value) loadError.value = msg;
            return;
        }
        const incoming = res.data.comments || [];
        if (append) {
            const existing = new Set(comments.value.map(item => item.id));
            const added = incoming.filter(item => !existing.has(item.id));
            comments.value.push(...added);
            loadMoreError.value = '';
            void resolveCommentLinks(added);
        } else {
            comments.value = incoming;
            loadError.value = '';
            loadMoreError.value = '';
            void resolveCommentLinks(incoming);
        }
        nextCursor.value = res.data.nextCursor ?? null;
        fetchedAt.value = res.data.commentsFetchedAt;
    } catch (error) {
        if (disposed || request !== loadRequest || isCancel(error)) return;
        const msg = requestErrorMessage(error, LOAD_ERROR_MESSAGE);
        if (append) loadMoreError.value = msg;
        else if (loading.value) loadError.value = msg;
    } finally {
        if (!disposed && request === loadRequest) {
            if (append) loadingMore.value = false;
            else loading.value = false;
        }
    }
}

async function handleRefresh() {
    if (isRefreshing.value) return;
    refreshing.value = true;
    try {
        const res = await refreshArticleComments(props.articleId);
        if (disposed) return;
        if (res.code !== 200) {
            message.error(res.message || REFRESH_ERROR_MESSAGE);
            return;
        }
        message.info('已请求刷新评论，稍后将自动更新');
    } catch (error) {
        if (!disposed) message.error(requestErrorMessage(error, REFRESH_ERROR_MESSAGE));
    } finally {
        refreshing.value = false;
    }
}

watch(
    () => props.articleId,
    async () => {
        activeController?.abort();
        loadRequest++;
        detachSocket();
        comments.value = [];
        nextCursor.value = null;
        fetchedAt.value = null;
        loadingMore.value = false;
        loadMoreError.value = '';
        await load();
        attachSocket();
    }
);

onMounted(async () => {
    await load();
    attachSocket();
});

onUnmounted(() => {
    disposed = true;
    activeController?.abort();
    loadRequest++;
    detachSocket();
});
</script>

<template>
    <Card :icon="MessagesSquare" title="评论">
        <template #header-extra>
            <n-button
                size="small"
                secondary
                :loading="isRefreshing"
                :disabled="isRefreshing"
                @click="handleRefresh"
            >
                <template #icon>
                    <n-icon><RefreshCw /></n-icon>
                </template>
                {{ isRefreshing ? '刷新中' : '刷新' }}
            </n-button>
        </template>

        <n-space v-if="loading" vertical>
            <n-skeleton text :repeat="3" />
            <n-skeleton text style="width: 60%" />
        </n-space>

        <n-alert v-else-if="loadError" type="error">
            {{ loadError }}
            <div class="comments-state-actions">
                <n-button @click="load()">重试</n-button>
            </div>
        </n-alert>

        <div v-else-if="comments.length === 0" class="comments-empty">
            <n-empty description="暂无评论" />
        </div>

        <template v-else>
            <ul class="comment-list">
                <li
                    v-for="{ comment, segments } in parsedComments"
                    :key="comment.id"
                    class="comment-item"
                >
                    <div class="comment-head">
                        <UserLink :user="comment.author" :show-avatar="true" />
                        <span class="comment-time">{{ formatDate(comment.time * 1000) }}</span>
                    </div>
                    <div class="comment-content">
                        <template v-for="(seg, idx) in segments" :key="idx">
                            <template v-if="seg.type === 'text'">{{ seg.text }}</template>
                            <template v-else>
                                <UserLink
                                    v-if="getResolvedUser(seg)"
                                    :user="getResolvedUser(seg)"
                                />
                                <router-link
                                    v-else-if="seg.parsed?.inSitePath"
                                    :to="seg.parsed.inSitePath"
                                    class="lgs-link"
                                    :title="linkTooltip(seg.parsed)"
                                >
                                    <LinkIcon :group="seg.parsed.iconGroup" />{{
                                        inSiteLinkLabel(seg)
                                    }}
                                </router-link>
                                <a
                                    v-else-if="seg.parsed"
                                    :href="seg.parsed.canonicalHref"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="lgs-link"
                                    :title="seg.parsed.canonicalHref"
                                >
                                    <LinkIcon :group="seg.parsed.iconGroup" />{{
                                        seg.parsed.parsedLabel || seg.rawUrl
                                    }}
                                </a>
                                <a
                                    v-else
                                    :href="seg.rawUrl"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="lgs-link"
                                >
                                    <LinkIcon group="external" />{{ seg.rawUrl }} </a
                                >{{ seg.trailing }}
                            </template>
                        </template>
                    </div>
                </li>
            </ul>

            <n-alert v-if="loadMoreError" type="error" class="comments-load-more-error">
                {{ loadMoreError }}
                <div class="comments-state-actions">
                    <n-button :disabled="loadingMore" @click="load(true)">重试</n-button>
                </div>
            </n-alert>

            <div v-if="nextCursor" class="comments-load-more">
                <n-button :loading="loadingMore" :disabled="loadingMore" @click="load(true)"
                    >加载更多</n-button
                >
            </div>
            <p v-else-if="!loadMoreError" class="comments-end">已加载全部</p>
        </template>

        <p v-if="!loading && !loadError && fetchedAt && comments.length > 0" class="comment-source">
            评论来源于洛谷，最后同步于 {{ formatDate(fetchedAt) }}
        </p>
    </Card>
</template>

<style scoped>
.comment-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}
.comment-item {
    border-bottom: 1px solid var(--ui-border-color);
    padding-bottom: var(--ui-space-4);
}
.comment-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
}
.comment-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    flex-wrap: wrap;
}
.comment-time {
    color: var(--ui-muted-text-color);
    flex-shrink: 0;
}
.comment-content {
    margin-top: 6px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--ui-text-color);
    /* preserve newlines from plain-text comments; wrap long content */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.comment-plain-link {
    color: var(--ui-link-color);
    text-decoration: underline;
    text-underline-offset: 2px;
}
.comment-plain-link:hover {
    color: var(--ui-link-hover-color);
}
.comments-empty {
    padding: var(--ui-space-3) 0;
}
.comments-state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}
.comments-load-more-error {
    margin-top: var(--ui-space-4);
}
.comments-load-more {
    display: flex;
    justify-content: center;
    margin-top: var(--ui-space-4);
}
.comments-end {
    margin: var(--ui-space-4) 0 0;
    color: var(--ui-secondary-text-color);
    text-align: center;
}
.comment-source {
    margin: var(--ui-space-4) 0 0;
    color: var(--ui-muted-text-color);
    text-align: right;
}
</style>
