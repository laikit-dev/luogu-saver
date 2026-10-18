<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NModal } from 'naive-ui';
import {
    getCurrentNotifications,
    markNotificationRead,
    type CurrentNotificationsResponse,
    type SiteNotificationItem
} from '@/api/notification';
import { authToken, isAuthenticated } from '@/utils/auth';
import { NOTIFICATION_READ_STORAGE_KEY } from '@/utils/constants';

type LocalReadState = Record<string, string>;

const notifications = ref<CurrentNotificationsResponse>({ banners: [], popups: [] });
const popupVisible = ref(false);
const activePopupIndex = ref(0);
// Bumped whenever a load starts or the account changes; stale responses and syncs are discarded.
let loadRevision = 0;

// Login-only items are re-checked at render time so a logout hides them before the reload lands.
function isVisible(item: SiteNotificationItem) {
    return !isRead(item) && (!item.loginOnly || isAuthenticated.value);
}

const visibleBanners = computed(() => notifications.value.banners.filter(isVisible));

const visiblePopups = computed(() => notifications.value.popups.filter(isVisible));

const visiblePopup = computed(() => {
    return visiblePopups.value[activePopupIndex.value] ?? visiblePopups.value[0] ?? null;
});

const popupPositionText = computed(() => {
    if (visiblePopups.value.length <= 1) return '';
    return `${activePopupIndex.value + 1} / ${visiblePopups.value.length}`;
});

function readLocalState(): LocalReadState {
    try {
        const raw = localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

// Persisting the dismissal is best-effort: unavailable storage (private mode, quota) must not
// keep a notification on screen.
function markLocalRead(item: SiteNotificationItem) {
    try {
        const state = readLocalState();
        state[String(item.id)] = item.updatedAt;
        localStorage.setItem(NOTIFICATION_READ_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Ignored: the reactive read flag already hides the item for this session.
    }
}

function isLocalRead(item: SiteNotificationItem) {
    return readLocalState()[String(item.id)] === item.updatedAt;
}

function isRead(item: SiteNotificationItem) {
    return item.read || isLocalRead(item);
}

async function syncLocalAndRemoteReadState(revision: number) {
    const items = [...notifications.value.banners, ...notifications.value.popups];

    for (const item of items) {
        if (revision !== loadRevision) return;
        if (item.read) {
            markLocalRead(item);
            continue;
        }

        if (isAuthenticated.value && isLocalRead(item)) {
            const response = await markNotificationRead(item.id, item.updatedAt).catch(() => null);
            if (revision !== loadRevision) return;
            if (response?.code === 200) {
                item.read = true;
                markLocalRead(item);
            }
        }
    }
}

// Each call supersedes the previous one, so an auth change always reloads for the new session.
// Failures stay silent: site notifications are optional chrome, not page content.
async function loadNotifications() {
    const revision = ++loadRevision;
    try {
        const response = await getCurrentNotifications();
        if (revision !== loadRevision) return;
        if (response.code !== 200 || !response.data) return;
        notifications.value = {
            banners: response.data.banners ?? [],
            popups: response.data.popups ?? []
        };
        await syncLocalAndRemoteReadState(revision);
        if (revision !== loadRevision) return;
        clampActivePopupIndex();
        popupVisible.value = visiblePopups.value.length > 0;
    } catch {
        // Keep whatever is currently shown; the next auth change or page load retries.
    }
}

function clampActivePopupIndex() {
    activePopupIndex.value = Math.min(
        activePopupIndex.value,
        Math.max(visiblePopups.value.length - 1, 0)
    );
}

function showPreviousPopup() {
    if (activePopupIndex.value <= 0) return;
    activePopupIndex.value -= 1;
}

function showNextPopup() {
    if (activePopupIndex.value >= visiblePopups.value.length - 1) return;
    activePopupIndex.value += 1;
}

async function dismissNotification(item: SiteNotificationItem) {
    item.read = true;
    if (item.channel === 'popup') {
        clampActivePopupIndex();
        popupVisible.value = visiblePopups.value.length > 0;
    }
    markLocalRead(item);

    if (!isAuthenticated.value) return;

    const revision = loadRevision;
    const response = await markNotificationRead(item.id, item.updatedAt).catch(() => null);
    if (response?.code === 409 && revision === loadRevision) {
        await loadNotifications();
    }
}

function handlePopupShowChange(show: boolean) {
    if (show) {
        popupVisible.value = true;
        return;
    }

    const item = visiblePopup.value;
    if (!item) {
        popupVisible.value = false;
        return;
    }

    void dismissNotification(item);
}

watch(authToken, () => {
    void loadNotifications();
});

watch(visiblePopups, () => {
    clampActivePopupIndex();
    if (popupVisible.value && visiblePopups.value.length === 0) {
        popupVisible.value = false;
    }
});

onMounted(() => {
    void loadNotifications();
});

onBeforeUnmount(() => {
    loadRevision++;
});
</script>

<template>
    <div v-if="visibleBanners.length > 0" class="site-notification-banners">
        <n-alert
            v-for="item in visibleBanners"
            :key="item.id"
            type="info"
            :title="item.title"
            :bordered="true"
            closable
            @close="dismissNotification(item)"
        >
            <!-- Admin-managed HTML notification content. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="notification-html" v-html="item.content"></div>
        </n-alert>
    </div>

    <n-modal :show="popupVisible" @update:show="handlePopupShowChange">
        <n-card
            v-if="visiblePopup"
            :bordered="false"
            role="dialog"
            aria-modal="true"
            :title="visiblePopup.title"
            :style="{ width: 'min(560px, calc(100vw - 32px))' }"
        >
            <!-- Admin-managed HTML notification content. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="notification-html popup-content" v-html="visiblePopup.content"></div>
            <template #footer>
                <div class="popup-actions">
                    <div v-if="visiblePopups.length > 1" class="popup-switcher">
                        <n-button
                            size="small"
                            :disabled="activePopupIndex === 0"
                            @click="showPreviousPopup"
                        >
                            上一条
                        </n-button>
                        <span class="popup-index">{{ popupPositionText }}</span>
                        <n-button
                            size="small"
                            :disabled="activePopupIndex >= visiblePopups.length - 1"
                            @click="showNextPopup"
                        >
                            下一条
                        </n-button>
                    </div>
                    <n-button type="primary" @click="dismissNotification(visiblePopup)">
                        知道了
                    </n-button>
                </div>
            </template>
        </n-card>
    </n-modal>
</template>

<style scoped>
.site-notification-banners {
    position: fixed;
    top: max(var(--ui-space-3), env(safe-area-inset-top));
    left: 50%;
    z-index: 1600;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    width: min(960px, calc(100vw - 32px));
    max-height: calc(100vh - 24px);
    overflow: auto;
    pointer-events: none;
    transform: translateX(-50%);
}

.site-notification-banners > :deep(.n-alert) {
    pointer-events: auto;
    box-shadow: var(--ui-elevated-shadow);
}

.notification-html {
    line-height: 1.7;
    color: var(--ui-text-color);
}

.notification-html :deep(p:first-child) {
    margin-top: 0;
}

.notification-html :deep(p:last-child) {
    margin-bottom: 0;
}

.notification-html :deep(a) {
    color: var(--ui-link-color);
    text-decoration: none;
}

.notification-html :deep(a:hover) {
    color: var(--ui-link-hover-color);
}

.popup-content {
    max-height: min(58vh, 520px);
    overflow: auto;
}

.popup-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
}

.popup-switcher {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
}

.popup-index {
    min-width: 48px;
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    text-align: center;
    white-space: nowrap;
}
</style>
