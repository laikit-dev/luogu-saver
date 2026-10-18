<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { NAlert, NSkeleton, NSpace, NEmpty, NButton, NIcon, useMessage } from 'naive-ui';
import { MessagesSquare, RefreshCw } from 'lucide-vue-next';

import { getArticleComments, refreshArticleComments } from '@/api/comment';
import socket from '@/utils/websocket';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request';
import type { ArticleComment } from '@/types/comment';
import type { User } from '@/types/user';

import Card from '@/components/Card.vue';
import UserLink from '@/components/UserLink.vue';

const props = defineProps<{
    articleId: string;
}>();

const LOAD_ERROR_MESSAGE = '评论加载失败，请重试。';
const REFRESH_ERROR_MESSAGE = '刷新评论请求失败，请重试。';

const message = useMessage();

const loading = ref(true);
const loadError = ref('');
const refreshing = ref(false);
const comments = ref<ArticleComment[]>([]);
const fetchedAt = ref<string | null>(null);

let disposed = false;
let loadRequest = 0;

function toUser(author: ArticleComment['author']): User {
    return {
        id: author.id,
        name: author.name,
        color: author.color,
        ccfLevel: author.ccfLevel,
        xcpcLevel: author.xcpcLevel,
        createdAt: 0,
        updatedAt: 0
    };
}

// Remember what was subscribed so detaching after an articleId change leaves the old room.
let attached: { room: string; event: string } | null = null;

function onCommentsUpdated() {
    void load(/* silent */ true);
}

function attachSocket() {
    if (attached || disposed) return;
    const room = `article_${props.articleId}`;
    const event = `article:${props.articleId}:comments-updated`;
    socket.joinRoom(room);
    socket.getInstance().on(event, onCommentsUpdated);
    attached = { room, event };
}

function detachSocket() {
    if (!attached) return;
    socket.getInstance().off(attached.event, onCommentsUpdated);
    socket.leaveRoom(attached.room);
    attached = null;
}

async function load(silent = false) {
    const request = ++loadRequest;
    if (!silent) {
        loading.value = true;
        loadError.value = '';
    }
    try {
        const res = await getArticleComments(props.articleId);
        if (disposed || request !== loadRequest) return;
        if (res.code !== 200 || !res.data) {
            // Only a visible load reports failure; a failed background update keeps what is shown.
            if (loading.value) loadError.value = LOAD_ERROR_MESSAGE;
            return;
        }
        comments.value = res.data.comments || [];
        fetchedAt.value = res.data.commentsFetchedAt;
        loadError.value = '';
    } catch (error) {
        if (disposed || request !== loadRequest) return;
        if (loading.value) loadError.value = requestErrorMessage(error, LOAD_ERROR_MESSAGE);
    } finally {
        if (!disposed && request === loadRequest) loading.value = false;
    }
}

async function handleRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        const res = await refreshArticleComments(props.articleId);
        if (disposed) return;
        if (res.code !== 200) {
            message.error(REFRESH_ERROR_MESSAGE);
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
        detachSocket();
        comments.value = [];
        fetchedAt.value = null;
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
    loadRequest++;
    detachSocket();
});
</script>

<template>
    <Card :icon="MessagesSquare" title="评论">
        <template #header-extra>
            <n-button size="small" secondary :loading="refreshing" @click="handleRefresh">
                <template #icon>
                    <n-icon><RefreshCw /></n-icon>
                </template>
                刷新
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

        <ul v-else class="comment-list">
            <li v-for="comment in comments" :key="comment.id" class="comment-item">
                <div class="comment-head">
                    <UserLink :user="toUser(comment.author)" :show-avatar="true" />
                    <span class="comment-time">{{ formatDate(comment.time * 1000) }}</span>
                </div>
                <div class="comment-content">{{ comment.content }}</div>
            </li>
        </ul>

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
.comments-empty {
    padding: var(--ui-space-3) 0;
}
.comments-state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}
.comment-source {
    margin: var(--ui-space-4) 0 0;
    color: var(--ui-muted-text-color);
    text-align: right;
}
</style>
