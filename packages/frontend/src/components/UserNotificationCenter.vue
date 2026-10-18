<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    NAlert,
    NBadge,
    NButton,
    NDrawer,
    NDrawerContent,
    NEmpty,
    NIcon,
    NSpin,
    useMessage
} from 'naive-ui';
import { Bell } from 'lucide-vue-next';
import {
    getUnreadNotificationCount,
    getUserNotifications,
    markAllUserNotificationsRead,
    markUserNotificationsRead,
    type UserNotificationItem
} from '@/api/user-notification';
import { authToken, isAuthenticated } from '@/utils/auth';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request.ts';

const UNREAD_POLL_INTERVAL_MS = 120_000;
const DRAWER_WIDTH = 'min(420px, calc(100vw - 32px))';
const LIST_ERROR_MESSAGE = '通知加载失败，请重试。';

const message = useMessage();

const drawerVisible = ref(false);
const notifications = ref<UserNotificationItem[]>([]);
const unreadCount = ref(0);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const listError = ref<{ message: string; append: boolean } | null>(null);
const markingAll = ref(false);
const pendingReadIds = new Set<number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Bumped whenever the account changes; responses captured under an older revision are discarded.
let authRevision = 0;
let listRequestId = 0;

const hasMore = computed(() => notifications.value.length < total.value);

async function refreshUnreadCount() {
    if (!isAuthenticated.value) return;
    const revision = authRevision;
    const response = await getUnreadNotificationCount().catch(() => null);
    if (revision !== authRevision) return;
    if (response?.code === 200) unreadCount.value = response.data.count;
}

async function loadNotifications(reset = true) {
    if (!isAuthenticated.value) return;
    // A reset supersedes any in-flight request; "load more" never stacks on another request.
    if (!reset && loading.value) return;
    const id = ++listRequestId;
    const revision = authRevision;
    loading.value = true;
    listError.value = null;
    try {
        const nextPage = reset ? 1 : page.value + 1;
        const response = await getUserNotifications(nextPage, pageSize);
        if (id !== listRequestId || revision !== authRevision) return;
        if (response.code !== 200) {
            listError.value = { message: LIST_ERROR_MESSAGE, append: !reset };
            return;
        }
        page.value = response.data.page;
        total.value = response.data.total;
        unreadCount.value = response.data.unreadCount;
        notifications.value = reset
            ? response.data.notifications
            : [...notifications.value, ...response.data.notifications];
    } catch (error) {
        if (id !== listRequestId || revision !== authRevision) return;
        listError.value = {
            message: requestErrorMessage(error, LIST_ERROR_MESSAGE),
            append: !reset
        };
    } finally {
        if (id === listRequestId) loading.value = false;
    }
}

function openDrawer() {
    drawerVisible.value = true;
    void loadNotifications(true);
}

async function handleItemClick(item: UserNotificationItem) {
    if (item.read || pendingReadIds.has(item.id)) return;
    const revision = authRevision;
    pendingReadIds.add(item.id);
    try {
        const response = await markUserNotificationsRead([item.id]);
        if (revision !== authRevision) return;
        if (response.code !== 200) {
            message.error('标记已读失败，请重试。');
            return;
        }
        // The list may have been reloaded meanwhile; update whichever object is current.
        const current = notifications.value.find(entry => entry.id === item.id) ?? item;
        current.read = true;
        unreadCount.value = Math.max(0, unreadCount.value - response.data.updated);
    } catch (error) {
        if (revision !== authRevision) return;
        message.error(requestErrorMessage(error, '标记已读失败，请重试。'));
    } finally {
        if (revision === authRevision) pendingReadIds.delete(item.id);
    }
}

async function handleMarkAllRead() {
    const revision = authRevision;
    markingAll.value = true;
    try {
        const response = await markAllUserNotificationsRead();
        if (revision !== authRevision) return;
        if (response.code !== 200) {
            message.error('全部标为已读失败，请重试。');
            return;
        }
        notifications.value.forEach(item => {
            item.read = true;
        });
        unreadCount.value = 0;
        message.success('已全部标为已读');
    } catch (error) {
        if (revision !== authRevision) return;
        message.error(requestErrorMessage(error, '全部标为已读失败，请重试。'));
    } finally {
        if (revision === authRevision) markingAll.value = false;
    }
}

function startPolling() {
    stopPolling();
    if (!isAuthenticated.value) return;
    void refreshUnreadCount();
    pollTimer = setInterval(() => void refreshUnreadCount(), UNREAD_POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

watch(authToken, () => {
    authRevision++;
    listRequestId++;
    loading.value = false;
    listError.value = null;
    markingAll.value = false;
    pendingReadIds.clear();
    notifications.value = [];
    unreadCount.value = 0;
    total.value = 0;
    page.value = 1;
    startPolling();
    if (drawerVisible.value) void loadNotifications(true);
});

onMounted(() => {
    startPolling();
});

onBeforeUnmount(() => {
    stopPolling();
    authRevision++;
    listRequestId++;
});
</script>

<template>
    <template v-if="isAuthenticated">
        <div class="notification-bell-shell">
            <n-badge :value="unreadCount" :max="99" :show="unreadCount > 0">
                <n-button
                    circle
                    secondary
                    class="app-floating-control notification-bell"
                    aria-label="站内通知"
                    @click="openDrawer"
                >
                    <template #icon>
                        <n-icon :component="Bell" />
                    </template>
                </n-button>
            </n-badge>
        </div>

        <n-drawer v-model:show="drawerVisible" :width="DRAWER_WIDTH">
            <n-drawer-content title="站内通知" closable>
                <template #footer>
                    <div class="drawer-footer">
                        <n-button
                            size="small"
                            secondary
                            :disabled="unreadCount === 0"
                            :loading="markingAll"
                            @click="handleMarkAllRead"
                        >
                            全部已读
                        </n-button>
                        <n-button size="small" secondary @click="loadNotifications(true)">
                            刷新
                        </n-button>
                    </div>
                </template>

                <n-spin :show="loading">
                    <n-alert v-if="listError && !listError.append" type="error" class="list-error">
                        {{ listError.message }}
                        <div class="state-actions">
                            <n-button :disabled="loading" @click="loadNotifications(true)">
                                重试
                            </n-button>
                        </div>
                    </n-alert>
                    <div
                        v-if="loading && notifications.length === 0"
                        class="loading-placeholder"
                    ></div>
                    <n-empty
                        v-else-if="!listError && notifications.length === 0"
                        description="暂无通知"
                        class="empty-state"
                    />
                    <div v-else-if="notifications.length > 0" class="notification-list">
                        <div
                            v-for="item in notifications"
                            :key="item.id"
                            class="notification-item"
                            :class="{ unread: !item.read }"
                        >
                            <component
                                :is="item.read ? 'div' : 'button'"
                                :type="item.read ? undefined : 'button'"
                                class="notification-main"
                                @click="handleItemClick(item)"
                            >
                                <span class="item-header">
                                    <span class="item-title">{{ item.title }}</span>
                                    <span
                                        v-if="!item.read"
                                        class="unread-dot"
                                        aria-hidden="true"
                                    ></span>
                                    <span v-if="!item.read" class="sr-only"
                                        >未读，点击标为已读</span
                                    >
                                </span>
                                <span v-if="item.content" class="item-content">{{
                                    item.content
                                }}</span>
                                <span class="item-time">{{ formatDate(item.createdAt) }}</span>
                            </component>
                            <router-link
                                v-if="item.metadata?.kind === 'archive_digest'"
                                to="/library?tab=feed"
                                class="archive-digest-link"
                                @click="
                                    handleItemClick(item);
                                    drawerVisible = false;
                                "
                            >
                                查看关注动态
                            </router-link>
                        </div>

                        <n-alert v-if="listError?.append" type="error">
                            {{ listError.message }}
                            <div class="state-actions">
                                <n-button :disabled="loading" @click="loadNotifications(false)">
                                    重试
                                </n-button>
                            </div>
                        </n-alert>
                        <n-button
                            v-else-if="hasMore"
                            class="load-more"
                            size="small"
                            secondary
                            block
                            :loading="loading"
                            @click="loadNotifications(false)"
                        >
                            加载更多
                        </n-button>
                    </div>
                </n-spin>
            </n-drawer-content>
        </n-drawer>
    </template>
</template>

<style scoped>
.notification-bell-shell {
    position: fixed;
    top: var(--ui-floating-control-inset);
    right: var(--ui-floating-control-inset);
    z-index: 1100;
}

.notification-bell {
    box-shadow: var(--ui-elevated-shadow);
}

.empty-state {
    margin-top: var(--ui-space-12);
}

.loading-placeholder {
    min-height: 160px;
}

.list-error {
    margin-bottom: var(--ui-control-gap);
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.notification-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-control-gap);
}

.notification-item {
    padding: var(--ui-space-3) var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
    transition: background-color 0.2s ease;
}

.notification-item.unread {
    background: var(--ui-panel-color);
}

.notification-main {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
}

button.notification-main {
    cursor: pointer;
}

button.notification-main:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
    .notification-item {
        transition: none;
    }
}

.item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-inline-gap);
}

.item-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.unread-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ui-primary-color);
}

.item-content {
    display: block;
    margin: 6px 0 0;
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
}

.item-time {
    display: block;
    margin-top: 6px;
    color: var(--ui-muted-text-color);
    font-size: 14px;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.load-more {
    margin-top: var(--ui-space-1);
}

.archive-digest-link {
    display: inline-block;
    margin-top: var(--ui-space-2);
    color: var(--ui-link-color);
    overflow-wrap: anywhere;
}

.archive-digest-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}
</style>
