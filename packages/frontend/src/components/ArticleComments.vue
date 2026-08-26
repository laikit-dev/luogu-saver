<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { NSkeleton, NSpace, NEmpty, NButton, NIcon, NTime, useMessage } from 'naive-ui';
import { MessagesSquare, RefreshCw } from 'lucide-vue-next';

import { getArticleComments, refreshArticleComments } from '@/api/comment';
import socket from '@/utils/websocket';
import type { ArticleComment } from '@/types/comment';
import type { User } from '@/types/user';

import Card from '@/components/Card.vue';
import UserLink from '@/components/UserLink.vue';

const props = defineProps<{
    articleId: string;
}>();

const message = useMessage();

const loading = ref(true);
const refreshing = ref(false);
const comments = ref<ArticleComment[]>([]);
const fetchedAt = ref<string | null>(null);

const room = computed(() => `article_${props.articleId}`);
const event = computed(() => `article:${props.articleId}:comments-updated`);

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

let listenerAttached = false;

function onCommentsUpdated() {
    void load(/* silent */ true);
}

function attachSocket() {
    if (listenerAttached) return;
    socket.joinRoom(room.value);
    socket.getInstance().on(event.value, onCommentsUpdated);
    listenerAttached = true;
}

function detachSocket() {
    if (!listenerAttached) return;
    socket.getInstance().off(event.value, onCommentsUpdated);
    socket.leaveRoom(room.value);
    listenerAttached = false;
}

async function load(silent = false) {
    if (!silent) loading.value = true;
    try {
        const res = await getArticleComments(props.articleId);
        if (res.code === 200 && res.data) {
            comments.value = res.data.comments || [];
            fetchedAt.value = res.data.commentsFetchedAt;
        }
    } catch {
        // non-fatal: leave whatever we have
    } finally {
        if (!silent) loading.value = false;
    }
}

async function handleRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        await refreshArticleComments(props.articleId);
        message.info('已请求刷新评论,稍后将自动更新');
    } catch {
        message.error('刷新失败');
    } finally {
        refreshing.value = false;
    }
}

watch(
    () => props.articleId,
    async () => {
        detachSocket();
        comments.value = [];
        await load();
        attachSocket();
    }
);

onMounted(async () => {
    await load();
    attachSocket();
});

onUnmounted(() => {
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

        <div v-else-if="comments.length === 0" class="comments-empty">
            <n-empty description="暂无评论" />
        </div>

        <ul v-else class="comment-list">
            <li v-for="comment in comments" :key="comment.id" class="comment-item">
                <div class="comment-head">
                    <UserLink :user="toUser(comment.author)" :show-avatar="true" />
                    <span class="comment-time">
                        <n-time :time="comment.time * 1000" type="datetime" />
                    </span>
                </div>
                <div class="comment-content">{{ comment.content }}</div>
            </li>
        </ul>

        <p v-if="fetchedAt && comments.length > 0" class="comment-source">
            评论来源于洛谷，最后同步于
            <n-time :time="new Date(fetchedAt)" type="relative" />
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
    gap: 16px;
}
.comment-item {
    border-bottom: 1px solid var(--ui-border-color);
    padding-bottom: 16px;
}
.comment-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
}
.comment-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}
.comment-time {
    font-size: 12px;
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
    padding: 12px 0;
}
.comment-source {
    margin: 16px 0 0;
    font-size: 12px;
    color: var(--ui-muted-text-color);
    text-align: right;
}
</style>
