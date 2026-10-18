<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    NAlert,
    NButton,
    NEmpty,
    NFormItem,
    NIcon,
    NInput,
    NSpace,
    NSpin,
    NSwitch,
    NTag,
    useDialog,
    useMessage
} from 'naive-ui';
import { Plus, ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import HtmlCodeEditor from '@/components/HtmlCodeEditor.vue';
import {
    getAdminAnnouncement,
    getAdminAdvertisements,
    getAdminNotifications,
    updateAdminAnnouncement,
    updateAdminAdvertisements,
    updateAdminNotifications,
    type AdminAdvertisement,
    type AdminSiteNotification
} from '@/api/admin.ts';
import type { Announcement } from '@/api/announcement.ts';
import type { NotificationChannel } from '@/api/notification.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const message = useMessage();
const dialog = useDialog();

// Every section stays read-only until its first successful load: saving the local defaults over a
// failed read would overwrite the announcement, and the list endpoints delete omitted items.
const loadingAnnouncement = ref(false);
const savingAnnouncement = ref(false);
const announcementLoaded = ref(false);
const announcementLoadError = ref<string | null>(null);
const loadingNotifications = ref(false);
const savingNotifications = ref(false);
const notificationsLoaded = ref(false);
const notificationsLoadError = ref<string | null>(null);
const loadingAdvertisements = ref(false);
const savingAdvertisements = ref(false);
const advertisementsLoaded = ref(false);
const advertisementsLoadError = ref<string | null>(null);
const announcementForm = ref({
    title: '公告',
    content: '',
    enabled: true
});

type NotificationDraft = AdminSiteNotification & { localId: string };
const notificationDrafts = ref<NotificationDraft[]>([]);
let persistedNotificationIds: number[] = [];
let nextNotificationDraftId = 0;

type AdvertisementDraft = Omit<AdminAdvertisement, 'targetUrl'> & {
    targetUrl: string;
    localId: string;
};
const advertisementDrafts = ref<AdvertisementDraft[]>([]);
let persistedAdvertisementIds: number[] = [];
let nextAdvertisementDraftId = 0;

const canManageAnnouncements = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_ANNOUNCEMENTS)
);
const bannerNotificationDrafts = computed(() => getNotificationDraftsByChannel('banner'));
const popupNotificationDrafts = computed(() => getNotificationDraftsByChannel('popup'));

function applyAnnouncement(announcement: Announcement) {
    announcementForm.value = {
        title: announcement.title,
        content: announcement.content,
        enabled: announcement.enabled
    };
}

function applyNotifications(items: AdminSiteNotification[]) {
    notificationDrafts.value = items.map(toNotificationDraft);
    persistedNotificationIds = collectPersistedIds(items);
}

function applyAdvertisements(items: AdminAdvertisement[]) {
    advertisementDrafts.value = items.map(toAdvertisementDraft);
    persistedAdvertisementIds = collectPersistedIds(items);
}

function collectPersistedIds(items: { id?: number }[]) {
    return items.flatMap(item => (item.id === undefined ? [] : [item.id]));
}

function countRemovedItems(persistedIds: number[], drafts: { id?: number }[]) {
    const keptIds = new Set(drafts.map(item => item.id));
    return persistedIds.filter(id => !keptIds.has(id)).length;
}

async function loadAnnouncement() {
    if (!canManageAnnouncements.value || loadingAnnouncement.value) return;
    loadingAnnouncement.value = true;
    try {
        const response = await getAdminAnnouncement();
        if (response.code !== 200) {
            announcementLoadError.value = '公告加载失败，请重试。';
            return;
        }
        applyAnnouncement(response.data);
        announcementLoaded.value = true;
        announcementLoadError.value = null;
    } catch (error) {
        announcementLoadError.value = requestErrorMessage(error, '公告加载失败，请重试。');
    } finally {
        loadingAnnouncement.value = false;
    }
}

async function loadNotifications() {
    if (!canManageAnnouncements.value || loadingNotifications.value) return;
    loadingNotifications.value = true;
    try {
        const response = await getAdminNotifications();
        if (response.code !== 200) {
            notificationsLoadError.value = '通知配置加载失败，请重试。';
            return;
        }
        applyNotifications(response.data.notifications);
        notificationsLoaded.value = true;
        notificationsLoadError.value = null;
    } catch (error) {
        notificationsLoadError.value = requestErrorMessage(error, '通知配置加载失败，请重试。');
    } finally {
        loadingNotifications.value = false;
    }
}

async function loadAdvertisements() {
    if (!canManageAnnouncements.value || loadingAdvertisements.value) return;
    loadingAdvertisements.value = true;
    try {
        const response = await getAdminAdvertisements();
        if (response.code !== 200) {
            advertisementsLoadError.value = '广告配置加载失败，请重试。';
            return;
        }
        applyAdvertisements(response.data.advertisements);
        advertisementsLoaded.value = true;
        advertisementsLoadError.value = null;
    } catch (error) {
        advertisementsLoadError.value = requestErrorMessage(error, '广告配置加载失败，请重试。');
    } finally {
        loadingAdvertisements.value = false;
    }
}

function getNotificationDraftsByChannel(channel: NotificationChannel) {
    return notificationDrafts.value
        .filter(item => item.channel === channel)
        .sort((a, b) => a.sortOrder - b.sortOrder || getDraftStableId(a) - getDraftStableId(b));
}

function getDraftStableId(item: NotificationDraft) {
    return item.id ?? Number(item.localId.replace('draft-', ''));
}

function toNotificationDraft(item: AdminSiteNotification): NotificationDraft {
    return {
        ...item,
        content: item.content ?? '',
        localId: `draft-${++nextNotificationDraftId}`
    };
}

function createNotificationDraft(channel: NotificationChannel): NotificationDraft {
    const channelItems = getNotificationDraftsByChannel(channel);
    return {
        localId: `draft-${++nextNotificationDraftId}`,
        channel,
        title: channel === 'banner' ? 'Banner 通知' : 'Popup 通知',
        content: '',
        enabled: true,
        loginOnly: false,
        sortOrder: channelItems.length * 10
    };
}

function addNotification(channel: NotificationChannel) {
    notificationDrafts.value.push(createNotificationDraft(channel));
    renumberNotificationOrder(channel);
}

function removeNotification(localId: string) {
    const item = notificationDrafts.value.find(draft => draft.localId === localId);
    notificationDrafts.value = notificationDrafts.value.filter(draft => draft.localId !== localId);
    if (item) renumberNotificationOrder(item.channel);
}

function moveNotification(localId: string, direction: -1 | 1) {
    const item = notificationDrafts.value.find(draft => draft.localId === localId);
    if (!item) return;

    const channelItems = getNotificationDraftsByChannel(item.channel);
    const index = channelItems.findIndex(draft => draft.localId === localId);
    const swap = channelItems[index + direction];
    if (!swap) return;

    const sortOrder = item.sortOrder;
    item.sortOrder = swap.sortOrder;
    swap.sortOrder = sortOrder;
    renumberNotificationOrder(item.channel);
}

function renumberNotificationOrder(channel: NotificationChannel) {
    getNotificationDraftsByChannel(channel).forEach((item, index) => {
        item.sortOrder = index * 10;
    });
}

function buildNotificationPayload() {
    renumberNotificationOrder('banner');
    renumberNotificationOrder('popup');
    return notificationDrafts.value.map(item => ({
        id: item.id,
        channel: item.channel,
        title: item.title,
        content: item.content,
        enabled: item.enabled,
        loginOnly: item.loginOnly,
        sortOrder: item.sortOrder
    }));
}

function toAdvertisementDraft(item: AdminAdvertisement): AdvertisementDraft {
    return {
        ...item,
        targetUrl: item.targetUrl ?? '',
        localId: `advertisement-draft-${++nextAdvertisementDraftId}`
    };
}

function addAdvertisement() {
    if (advertisementDrafts.value.length >= 10) return;
    advertisementDrafts.value.push({
        localId: `advertisement-draft-${++nextAdvertisementDraftId}`,
        imageUrl: '',
        altText: '',
        targetUrl: '',
        enabled: true,
        sortOrder: advertisementDrafts.value.length * 10
    });
}

function removeAdvertisement(index: number) {
    advertisementDrafts.value.splice(index, 1);
}

function moveAdvertisement(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= advertisementDrafts.value.length) return;
    const [item] = advertisementDrafts.value.splice(index, 1);
    if (!item) return;
    advertisementDrafts.value.splice(targetIndex, 0, item);
}

function buildAdvertisementPayload(): AdminAdvertisement[] {
    return advertisementDrafts.value.map((item, index) => ({
        id: item.id,
        imageUrl: item.imageUrl,
        altText: item.altText,
        targetUrl: item.targetUrl,
        enabled: item.enabled,
        sortOrder: index * 10
    }));
}

async function handleAnnouncementSave() {
    if (!canManageAnnouncements.value || !announcementLoaded.value) return;
    savingAnnouncement.value = true;
    try {
        const response = await updateAdminAnnouncement(announcementForm.value);
        if (response.code !== 200) {
            message.error('公告保存失败，请重试。');
            return;
        }
        applyAnnouncement(response.data);
        message.success('公告已保存');
    } catch (error) {
        message.error(requestErrorMessage(error, '公告保存失败，请重试。'));
    } finally {
        savingAnnouncement.value = false;
    }
}

function handleNotificationsSave() {
    if (!canManageAnnouncements.value || !notificationsLoaded.value) return;
    const removedCount = countRemovedItems(persistedNotificationIds, notificationDrafts.value);
    if (removedCount === 0) {
        void saveNotifications();
        return;
    }
    dialog.warning({
        title: '删除已保存的通知？',
        content: `保存后将永久删除 ${removedCount} 条已保存的通知，无法撤销。确认保存吗？`,
        positiveText: '删除并保存',
        negativeText: '取消',
        onPositiveClick: () => {
            void saveNotifications();
        }
    });
}

async function saveNotifications() {
    savingNotifications.value = true;
    try {
        const response = await updateAdminNotifications(buildNotificationPayload());
        if (response.code !== 200) {
            message.error('通知配置保存失败，请重试。');
            return;
        }
        applyNotifications(response.data.notifications);
        message.success('通知配置已保存');
    } catch (error) {
        message.error(requestErrorMessage(error, '通知配置保存失败，请重试。'));
    } finally {
        savingNotifications.value = false;
    }
}

function handleAdvertisementsSave() {
    if (!canManageAnnouncements.value || !advertisementsLoaded.value) return;
    const removedCount = countRemovedItems(persistedAdvertisementIds, advertisementDrafts.value);
    if (removedCount === 0) {
        void saveAdvertisements();
        return;
    }
    dialog.warning({
        title: '删除已保存的广告？',
        content: `保存后将永久删除 ${removedCount} 条已保存的广告，无法撤销。确认保存吗？`,
        positiveText: '删除并保存',
        negativeText: '取消',
        onPositiveClick: () => {
            void saveAdvertisements();
        }
    });
}

async function saveAdvertisements() {
    savingAdvertisements.value = true;
    try {
        const response = await updateAdminAdvertisements(buildAdvertisementPayload());
        if (response.code !== 200) {
            // The backend reports invalid image/target URLs and alt text as code 400.
            message.error(
                response.code === 400
                    ? '广告配置保存失败，请检查图片地址、跳转地址和替代文本。'
                    : '广告配置保存失败，请重试。'
            );
            return;
        }
        applyAdvertisements(response.data.advertisements);
        message.success('广告配置已保存');
    } catch (error) {
        message.error(requestErrorMessage(error, '广告配置保存失败，请重试。'));
    } finally {
        savingAdvertisements.value = false;
    }
}

onMounted(async () => {
    await Promise.all([loadAnnouncement(), loadNotifications(), loadAdvertisements()]);
});
</script>

<template>
    <div>
        <Card title="公告管理" class="announcement-card">
            <n-spin :show="loadingAnnouncement">
                <n-alert v-if="canManageAnnouncements && announcementLoadError" type="error">
                    {{ announcementLoadError }}
                    <div class="state-actions">
                        <n-button :disabled="loadingAnnouncement" @click="loadAnnouncement">
                            重试
                        </n-button>
                    </div>
                </n-alert>
                <n-space v-else-if="canManageAnnouncements" vertical size="large">
                    <n-space align="center" justify="space-between" class="announcement-toolbar">
                        <n-form-item
                            label="标题"
                            label-placement="left"
                            :show-feedback="false"
                            class="announcement-title-field"
                        >
                            <n-input v-model:value="announcementForm.title" />
                        </n-form-item>
                        <n-form-item
                            label="启用"
                            label-placement="left"
                            :show-feedback="false"
                            class="announcement-enabled-field"
                        >
                            <n-switch v-model:value="announcementForm.enabled" />
                        </n-form-item>
                    </n-space>

                    <HtmlCodeEditor v-model:value="announcementForm.content" />

                    <div class="announcement-preview-shell">
                        <div class="muted">预览</div>
                        <div class="announcement-preview" v-html="announcementForm.content"></div>
                    </div>

                    <n-space justify="end">
                        <n-button
                            type="primary"
                            :disabled="!announcementLoaded"
                            :loading="savingAnnouncement"
                            @click="handleAnnouncementSave"
                        >
                            保存公告
                        </n-button>
                    </n-space>
                </n-space>
                <n-alert v-else type="warning" title="缺少 MANAGE_ANNOUNCEMENTS">
                    你没有公告管理权限。
                </n-alert>
            </n-spin>
        </Card>

        <Card title="通知管理" class="announcement-card">
            <n-spin :show="loadingNotifications">
                <n-alert v-if="canManageAnnouncements && notificationsLoadError" type="error">
                    {{ notificationsLoadError }}
                    <div class="state-actions">
                        <n-button :disabled="loadingNotifications" @click="loadNotifications">
                            重试
                        </n-button>
                    </div>
                </n-alert>
                <n-space v-else-if="canManageAnnouncements" vertical size="large">
                    <section class="notification-editor-section">
                        <div class="notification-editor-heading">
                            <div>
                                <strong>顶部 Banner</strong>
                                <p class="muted">显示在页面内容顶部，可被用户关闭。</p>
                            </div>
                            <n-button
                                secondary
                                :disabled="!notificationsLoaded"
                                @click="addNotification('banner')"
                            >
                                新增 Banner
                            </n-button>
                        </div>

                        <n-alert
                            v-if="notificationsLoaded && bannerNotificationDrafts.length === 0"
                            type="info"
                            title="暂无 Banner"
                        >
                            当前没有顶部 Banner 通知。
                        </n-alert>

                        <div
                            v-for="(item, index) in bannerNotificationDrafts"
                            :key="item.localId"
                            class="notification-item-editor"
                        >
                            <div class="notification-item-toolbar">
                                <n-space align="center">
                                    <n-tag type="info">Banner #{{ index + 1 }}</n-tag>
                                    <n-form-item
                                        label="启用"
                                        label-placement="left"
                                        :show-feedback="false"
                                        class="announcement-enabled-field"
                                    >
                                        <n-switch v-model:value="item.enabled" />
                                    </n-form-item>
                                    <n-form-item
                                        label="仅登录可见"
                                        label-placement="left"
                                        :show-feedback="false"
                                        class="announcement-enabled-field"
                                    >
                                        <n-switch v-model:value="item.loginOnly" />
                                    </n-form-item>
                                </n-space>
                                <n-space>
                                    <n-button
                                        size="small"
                                        :disabled="index === 0"
                                        @click="moveNotification(item.localId, -1)"
                                    >
                                        上移
                                    </n-button>
                                    <n-button
                                        size="small"
                                        :disabled="index === bannerNotificationDrafts.length - 1"
                                        @click="moveNotification(item.localId, 1)"
                                    >
                                        下移
                                    </n-button>
                                    <n-button
                                        size="small"
                                        type="error"
                                        secondary
                                        @click="removeNotification(item.localId)"
                                    >
                                        删除
                                    </n-button>
                                </n-space>
                            </div>

                            <n-form-item label="标题" :show-feedback="false">
                                <n-input v-model:value="item.title" />
                            </n-form-item>

                            <HtmlCodeEditor v-model:value="item.content" />

                            <div class="announcement-preview-shell">
                                <div class="muted">Banner 预览</div>
                                <div class="announcement-preview" v-html="item.content"></div>
                            </div>
                        </div>
                    </section>

                    <section class="notification-editor-section">
                        <div class="notification-editor-heading">
                            <div>
                                <strong>Popup 弹窗</strong>
                                <p class="muted">页面加载后弹出，可选择仅对登录用户显示。</p>
                            </div>
                            <n-button
                                secondary
                                :disabled="!notificationsLoaded"
                                @click="addNotification('popup')"
                            >
                                新增 Popup
                            </n-button>
                        </div>

                        <n-alert
                            v-if="notificationsLoaded && popupNotificationDrafts.length === 0"
                            type="info"
                            title="暂无 Popup"
                        >
                            当前没有弹窗通知。
                        </n-alert>

                        <div
                            v-for="(item, index) in popupNotificationDrafts"
                            :key="item.localId"
                            class="notification-item-editor"
                        >
                            <div class="notification-item-toolbar">
                                <n-space align="center">
                                    <n-tag type="warning">Popup #{{ index + 1 }}</n-tag>
                                    <n-form-item
                                        label="启用"
                                        label-placement="left"
                                        :show-feedback="false"
                                        class="announcement-enabled-field"
                                    >
                                        <n-switch v-model:value="item.enabled" />
                                    </n-form-item>
                                    <n-form-item
                                        label="仅登录可见"
                                        label-placement="left"
                                        :show-feedback="false"
                                        class="announcement-enabled-field"
                                    >
                                        <n-switch v-model:value="item.loginOnly" />
                                    </n-form-item>
                                </n-space>
                                <n-space>
                                    <n-button
                                        size="small"
                                        :disabled="index === 0"
                                        @click="moveNotification(item.localId, -1)"
                                    >
                                        上移
                                    </n-button>
                                    <n-button
                                        size="small"
                                        :disabled="index === popupNotificationDrafts.length - 1"
                                        @click="moveNotification(item.localId, 1)"
                                    >
                                        下移
                                    </n-button>
                                    <n-button
                                        size="small"
                                        type="error"
                                        secondary
                                        @click="removeNotification(item.localId)"
                                    >
                                        删除
                                    </n-button>
                                </n-space>
                            </div>

                            <n-form-item label="标题" :show-feedback="false">
                                <n-input v-model:value="item.title" />
                            </n-form-item>

                            <HtmlCodeEditor v-model:value="item.content" />

                            <div class="announcement-preview-shell">
                                <div class="muted">Popup 预览</div>
                                <div class="announcement-preview" v-html="item.content"></div>
                            </div>
                        </div>
                    </section>

                    <n-space justify="end">
                        <n-button
                            type="primary"
                            :disabled="!notificationsLoaded"
                            :loading="savingNotifications"
                            @click="handleNotificationsSave"
                        >
                            保存通知配置
                        </n-button>
                    </n-space>
                </n-space>
                <n-alert v-else type="warning" title="缺少 MANAGE_ANNOUNCEMENTS">
                    你没有公告管理权限。
                </n-alert>
            </n-spin>
        </Card>

        <Card title="广告轮播" class="announcement-card">
            <n-spin :show="loadingAdvertisements">
                <n-alert v-if="canManageAnnouncements && advertisementsLoadError" type="error">
                    {{ advertisementsLoadError }}
                    <div class="state-actions">
                        <n-button :disabled="loadingAdvertisements" @click="loadAdvertisements">
                            重试
                        </n-button>
                    </div>
                </n-alert>
                <div v-else-if="canManageAnnouncements" class="advertisement-editor">
                    <div class="advertisement-editor-heading">
                        <n-tag type="info">{{ advertisementDrafts.length }} / 10</n-tag>
                        <n-button
                            secondary
                            :disabled="!advertisementsLoaded || advertisementDrafts.length >= 10"
                            @click="addAdvertisement"
                        >
                            <template #icon><n-icon :component="Plus" /></template>
                            新增广告
                        </n-button>
                    </div>

                    <n-alert
                        v-if="advertisementsLoaded && advertisementDrafts.length === 0"
                        type="info"
                        title="暂无广告"
                    >
                        保存空列表后，主页不会显示广告轮播。
                    </n-alert>

                    <div
                        v-for="(item, index) in advertisementDrafts"
                        :key="item.localId"
                        class="advertisement-item-editor"
                    >
                        <div class="advertisement-item-toolbar">
                            <n-space align="center">
                                <n-tag>广告 #{{ index + 1 }}</n-tag>
                                <n-form-item
                                    label="启用"
                                    label-placement="left"
                                    :show-feedback="false"
                                    class="announcement-enabled-field"
                                >
                                    <n-switch v-model:value="item.enabled" />
                                </n-form-item>
                            </n-space>
                            <n-space size="small">
                                <n-button
                                    circle
                                    size="small"
                                    :disabled="index === 0"
                                    aria-label="上移广告"
                                    title="上移"
                                    @click="moveAdvertisement(index, -1)"
                                >
                                    <template #icon><n-icon :component="ArrowUp" /></template>
                                </n-button>
                                <n-button
                                    circle
                                    size="small"
                                    :disabled="index === advertisementDrafts.length - 1"
                                    aria-label="下移广告"
                                    title="下移"
                                    @click="moveAdvertisement(index, 1)"
                                >
                                    <template #icon><n-icon :component="ArrowDown" /></template>
                                </n-button>
                                <n-button
                                    circle
                                    size="small"
                                    type="error"
                                    secondary
                                    aria-label="删除广告"
                                    title="删除"
                                    @click="removeAdvertisement(index)"
                                >
                                    <template #icon><n-icon :component="Trash2" /></template>
                                </n-button>
                            </n-space>
                        </div>

                        <div class="advertisement-fields">
                            <n-form-item label="图片地址" :show-feedback="false">
                                <n-input
                                    v-model:value="item.imageUrl"
                                    placeholder="https://example.com/banner.webp"
                                />
                            </n-form-item>
                            <n-form-item label="跳转地址（可选）" :show-feedback="false">
                                <n-input
                                    v-model:value="item.targetUrl"
                                    placeholder="https://example.com"
                                />
                            </n-form-item>
                        </div>

                        <n-form-item label="替代文本" :show-feedback="false">
                            <n-input
                                v-model:value="item.altText"
                                maxlength="255"
                                show-count
                                placeholder="描述广告图片内容"
                            />
                        </n-form-item>

                        <div class="advertisement-preview">
                            <img
                                v-if="item.imageUrl.trim()"
                                :src="item.imageUrl"
                                :alt="item.altText || `广告 ${index + 1} 预览`"
                            />
                            <n-empty v-else description="暂无预览" size="small" />
                        </div>
                    </div>

                    <n-space justify="end">
                        <n-button
                            type="primary"
                            :disabled="!advertisementsLoaded"
                            :loading="savingAdvertisements"
                            @click="handleAdvertisementsSave"
                        >
                            <template #icon><n-icon :component="Save" /></template>
                            保存广告配置
                        </n-button>
                    </n-space>
                </div>
                <n-alert v-else type="warning" title="缺少 MANAGE_ANNOUNCEMENTS">
                    你没有广告管理权限。
                </n-alert>
            </n-spin>
        </Card>
    </div>
</template>

<style scoped>
.announcement-card {
    margin-bottom: var(--ui-space-4);
}

.muted {
    color: var(--ui-muted-text-color);
}

.announcement-toolbar {
    align-items: flex-start;
}

.announcement-title-field {
    flex: 1;
    margin-bottom: 0;
}

.announcement-enabled-field {
    margin-bottom: 0;
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.notification-editor-section {
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.notification-editor-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--ui-space-4);
    margin-bottom: var(--ui-space-3);
}

.notification-editor-heading strong {
    color: var(--ui-card-title-color);
    font-size: 15px;
}

.notification-editor-heading p {
    margin: var(--ui-space-1) 0 0;
    font-size: 14px;
}

.notification-item-editor {
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
}

.notification-item-editor + .notification-item-editor {
    margin-top: var(--ui-space-3);
}

.notification-item-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--ui-space-4);
    margin-bottom: var(--ui-space-3);
}

.announcement-preview-shell {
    margin-top: var(--ui-space-2);
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.announcement-preview {
    min-height: 120px;
    padding: var(--ui-space-4);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
    border: 1px solid var(--ui-border-color);
    color: var(--ui-secondary-text-color);
    line-height: 1.7;
}

.announcement-preview :deep(a) {
    color: var(--ui-link-color);
    text-decoration: none;
    transition: color 0.2s;
}

.announcement-preview :deep(a:hover) {
    color: var(--ui-link-hover-color) !important;
}

.advertisement-editor {
    display: grid;
    gap: var(--ui-space-4);
}

.advertisement-editor-heading,
.advertisement-item-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-4);
}

.advertisement-item-editor {
    display: grid;
    gap: var(--ui-space-4);
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.advertisement-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

.advertisement-item-editor :deep(.n-form-item) {
    margin-bottom: 0;
}

.advertisement-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(100%, 520px);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
}

.advertisement-preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

@media (max-width: 768px) {
    .advertisement-fields {
        grid-template-columns: minmax(0, 1fr);
    }

    .advertisement-item-toolbar {
        align-items: flex-start;
    }
}
</style>
