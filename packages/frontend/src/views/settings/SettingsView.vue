<script setup lang="ts">
import { computed, inject, onMounted, type Ref } from 'vue';
import {
    NAlert,
    NButton,
    NIcon,
    NSelect,
    NSpace,
    NSpin,
    NSwitch,
    NTag,
    useDialog,
    useMessage
} from 'naive-ui';
import {
    ChartNoAxesCombined,
    Cloud,
    KeyRound,
    Library,
    Navigation,
    RefreshCw,
    Settings,
    Trash2
} from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import {
    clearAuthToken,
    currentAuth,
    currentAuthState,
    isAuthenticated,
    startCpOAuthLogin
} from '@/utils/auth.ts';
import { ensureCurrentAuth } from '@/api/auth.ts';
import {
    AUTH_TOKEN_STORAGE_KEY,
    CACHE_STORAGE_KEY,
    CONTENT_BOOKMARK_STORAGE_PREFIX,
    DEVICE_ID_STORAGE_KEY,
    JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY
} from '@/utils/constants.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { generateDeviceId } from '@/utils/device-id.ts';
import { API_BASE_URL } from '@/utils/api-base-url.ts';
import { formatDate } from '@/utils/render.ts';
import { useKnowledgeBase } from '@/utils/knowledge-base.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { trackingAllowed, trackingConsent } from '@/utils/tracking-consent.ts';

const message = useMessage();
const dialog = useDialog();
const sidebarLogoNavEnabled = inject('sidebarLogoNavEnabled') as Ref<boolean | null>;
const logoNavEnabled = computed({
    get: () => sidebarLogoNavEnabled.value ?? true,
    set: val => {
        sidebarLogoNavEnabled.value = val;
    }
});
const knowledgeBase = useKnowledgeBase();
const kbArticles = computed(() => knowledgeBase.getArticles());
const { selectedSource, sourceBaseUrl, sourceOptions } = useLuoguSource();

const trackingEnabled = computed({
    get: () => trackingAllowed.value,
    set: value => {
        trackingConsent.value = value ? 'allowed' : 'denied';
        message.success(value ? '数据追踪已开启' : '数据追踪已关闭');
    }
});

const deviceId = useLocalStorage(DEVICE_ID_STORAGE_KEY, '');
const authStatus = computed(() => (isAuthenticated.value ? '已登录' : '未登录'));
const authTagType = computed(() => (isAuthenticated.value ? 'success' : 'default'));
const registeredUser = computed(() => currentAuth.value?.registeredUser || null);
const accountLoadFailed = computed(
    () => currentAuthState.value === 'failed' || currentAuthState.value === 'expired'
);

function refreshAccount() {
    void ensureCurrentAuth({ force: true });
}

function handleLogout() {
    clearAuthToken();
    message.success('已退出登录');
}

function resetDeviceId() {
    deviceId.value = null;
    if (trackingEnabled.value) deviceId.value = generateDeviceId();
    message.success('设备 ID 已重置');
}

// Removes through the shared `useLocalStorage` refs so views opened later in this session do not
// keep (and re-persist) the in-memory copies of the removed values.
function removeStoredKeys(matches: (key: string) => boolean): number {
    const keys = Object.keys(localStorage).filter(matches);
    for (const key of keys) useLocalStorage<unknown>(key, null).value = null;
    return keys.length;
}

function clearSaveCache() {
    const count = removeStoredKeys(key => key.startsWith(CACHE_STORAGE_KEY));
    message.success(count ? `已清理 ${count} 项保存缓存` : '没有可清理的保存缓存');
}

function clearContentBookmarks() {
    dialog.warning({
        title: '删除全部段落收藏？',
        content: '这会删除所有文章和剪贴板内容的段落收藏，且无法恢复。',
        positiveText: '删除',
        negativeText: '取消',
        onPositiveClick: () => {
            const count = removeStoredKeys(key => key.startsWith(CONTENT_BOOKMARK_STORAGE_PREFIX));
            message.success(count ? `已删除 ${count} 项段落收藏数据` : '没有可删除的段落收藏');
        }
    });
}

function clearJudgementDisplayOptions() {
    const count = removeStoredKeys(key => key === JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY);
    message.success(count ? '已删除陶片放逐内容显示偏好' : '没有可删除的陶片放逐内容显示偏好');
}

function removeKnowledgeBaseArticle(articleId: string) {
    knowledgeBase.removeArticle(articleId);
    message.success('已从知识库移除');
}

function clearKnowledgeBase() {
    dialog.warning({
        title: '清空 RAG 知识库？',
        content: `这会移除知识库中的全部 ${kbArticles.value.length} 篇文章，且无法恢复。文章归档本身不会被删除。`,
        positiveText: '清空',
        negativeText: '取消',
        onPositiveClick: () => {
            knowledgeBase.clearArticles();
            message.success('知识库已清空');
        }
    });
}

async function copyText(text: string, successText: string) {
    try {
        await navigator.clipboard.writeText(text);
        message.success(successText);
    } catch {
        message.error('复制失败');
    }
}

onMounted(() => {
    void ensureCurrentAuth();
});
</script>

<template>
    <div class="settings-page">
        <CardTitle title="设置" :icon="Settings">
            管理登录账号、隐私与数据追踪、本地数据和站点偏好。
        </CardTitle>

        <div class="settings-grid">
            <Card title="账号" :icon="KeyRound" class="settings-card">
                <n-space vertical size="large">
                    <template v-if="!isAuthenticated">
                        <div class="account-meta">使用 CP OAuth 登录，并绑定你的洛谷账号。</div>
                        <n-button type="primary" @click="startCpOAuthLogin('/settings')">
                            使用 CP OAuth 登录
                        </n-button>
                    </template>

                    <n-alert v-else-if="accountLoadFailed" type="error" title="账号信息加载失败">
                        {{
                            currentAuthState === 'expired'
                                ? '当前登录状态已失效，请重新登录。'
                                : '无法读取账号信息，请重试。'
                        }}
                        <div class="alert-actions">
                            <n-button @click="refreshAccount">重试</n-button>
                            <n-button
                                v-if="currentAuthState === 'expired'"
                                type="primary"
                                @click="startCpOAuthLogin('/settings')"
                            >
                                使用 CP OAuth 重新登录
                            </n-button>
                            <n-button secondary type="error" @click="handleLogout">
                                退出登录
                            </n-button>
                        </div>
                    </n-alert>

                    <template v-else-if="currentAuthState === 'ready' && currentAuth">
                        <div class="account-row">
                            <div>
                                <div class="account-name">
                                    {{ registeredUser?.name || `用户 ${currentAuth.uid}` }}
                                </div>
                                <div class="account-meta">
                                    洛谷 UID：{{ registeredUser?.luoguUid || '-' }}
                                </div>
                            </div>
                            <n-tag :type="authTagType">{{ authStatus }}</n-tag>
                        </div>

                        <div class="detail-list">
                            <div class="detail-row">
                                <span class="detail-label">权限值</span>
                                <span class="detail-value">{{ currentAuth.role }}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">绑定时间</span>
                                <span class="detail-value">
                                    {{
                                        registeredUser?.createdAt
                                            ? formatDate(registeredUser.createdAt)
                                            : '-'
                                    }}
                                </span>
                            </div>
                        </div>

                        <n-space>
                            <n-button secondary @click="refreshAccount">
                                <template #icon>
                                    <n-icon :component="RefreshCw" />
                                </template>
                                刷新账号信息
                            </n-button>
                            <n-button secondary type="error" @click="handleLogout"
                                >退出登录</n-button
                            >
                        </n-space>
                    </template>

                    <div v-else class="loading-state" role="status">
                        <n-spin size="small" />
                        <span>正在加载账号信息…</span>
                    </div>
                </n-space>
            </Card>

            <Card title="隐私与数据追踪" :icon="ChartNoAxesCombined" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div id="tracking-setting-title" class="setting-title">
                                允许推荐数据追踪
                            </div>
                            <div id="tracking-setting-desc" class="setting-desc">
                                开启后记录浏览的文章，用于文章广场推荐：未登录时关联设备
                                ID，登录后关联账号，登录前的记录会在登录后并入账号。关闭后不再记录，后续请求也不发送设备
                                ID。
                            </div>
                        </div>
                        <n-switch
                            v-model:value="trackingEnabled"
                            aria-labelledby="tracking-setting-title"
                            aria-describedby="tracking-setting-desc"
                        />
                    </div>

                    <div class="detail-list">
                        <div class="detail-row">
                            <span class="detail-label">状态</span>
                            <span class="detail-value">
                                <n-tag :type="trackingEnabled ? 'success' : 'default'">
                                    {{ trackingEnabled ? '已开启' : '已关闭' }}
                                </n-tag>
                            </span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">设备 ID</span>
                            <span class="detail-value mono-text">{{ deviceId ?? '未生成' }}</span>
                        </div>
                    </div>

                    <n-space>
                        <n-button secondary @click="resetDeviceId">重置设备 ID</n-button>
                        <n-button
                            secondary
                            :disabled="!deviceId"
                            @click="copyText(deviceId!, '设备 ID 已复制')"
                        >
                            复制设备 ID
                        </n-button>
                    </n-space>
                </n-space>
            </Card>

            <Card title="本地数据" :icon="Trash2" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div class="setting-title">保存缓存</div>
                            <div class="setting-desc">
                                清理文章自动更新与保存相关的本地时间戳缓存。
                            </div>
                        </div>
                        <n-button secondary type="warning" @click="clearSaveCache">
                            清理缓存
                        </n-button>
                    </div>

                    <div class="setting-row">
                        <div>
                            <div class="setting-title">文章段落收藏</div>
                            <div class="setting-desc">删除所有文章和剪贴板内容的段落收藏。</div>
                        </div>
                        <n-button secondary type="warning" @click="clearContentBookmarks">
                            删除收藏
                        </n-button>
                    </div>

                    <div class="setting-row">
                        <div>
                            <div class="setting-title">陶片放逐内容显示偏好</div>
                            <div class="setting-desc">删除已保存的表格字段显示选项。</div>
                        </div>
                        <n-button secondary type="warning" @click="clearJudgementDisplayOptions">
                            删除偏好
                        </n-button>
                    </div>

                    <div class="setting-row">
                        <div>
                            <div class="setting-title">登录 Token</div>
                            <div class="setting-desc">本地存储键：{{ AUTH_TOKEN_STORAGE_KEY }}</div>
                        </div>
                        <n-tag :type="isAuthenticated ? 'success' : 'default'">
                            {{ isAuthenticated ? '存在' : '不存在' }}
                        </n-tag>
                    </div>
                </n-space>
            </Card>

            <Card title="RAG 知识库" :icon="Library" class="settings-card compact-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div class="setting-title">
                                已保存 {{ kbArticles.length }} / 10 篇文章
                            </div>
                            <div class="setting-desc">RAG 问答可选择强制使用这些文章。</div>
                        </div>
                        <n-button
                            secondary
                            type="warning"
                            :disabled="kbArticles.length === 0"
                            @click="clearKnowledgeBase"
                        >
                            清空知识库
                        </n-button>
                    </div>

                    <div v-if="kbArticles.length" class="kb-list">
                        <div v-for="item in kbArticles" :key="item.id" class="kb-item">
                            <div class="kb-main">
                                <div class="kb-title">{{ item.title }}</div>
                                <div class="kb-meta">
                                    {{ item.id }} · 加入于 {{ formatDate(item.addedAt) }}
                                </div>
                            </div>
                            <n-space>
                                <router-link
                                    v-slot="{ href, navigate }"
                                    :to="`/article/${item.id}`"
                                    custom
                                >
                                    <n-button
                                        secondary
                                        size="small"
                                        tag="a"
                                        :href="href"
                                        @click="navigate"
                                    >
                                        查看
                                    </n-button>
                                </router-link>
                                <n-button
                                    secondary
                                    size="small"
                                    type="error"
                                    @click="removeKnowledgeBaseArticle(item.id)"
                                >
                                    移除
                                </n-button>
                            </n-space>
                        </div>
                    </div>
                    <div v-else class="setting-desc">浏览文章时点击“加入知识库”即可添加。</div>
                </n-space>
            </Card>

            <Card title="导航" :icon="Navigation" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div id="logo-nav-setting-title" class="setting-title">
                                侧边栏 Logo 点击导航
                            </div>
                            <div id="logo-nav-setting-desc" class="setting-desc">
                                启用后点击侧边栏 Logo 会跳转到首页
                            </div>
                        </div>
                        <n-switch
                            v-model:value="logoNavEnabled"
                            aria-labelledby="logo-nav-setting-title"
                            aria-describedby="logo-nav-setting-desc"
                        />
                    </div>
                </n-space>
            </Card>

            <Card title="连接信息" :icon="Cloud" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div class="setting-title">原站地址</div>
                            <div class="setting-desc">原站按钮会打开当前选择的洛谷域名。</div>
                        </div>
                        <n-select
                            v-model:value="selectedSource"
                            :options="sourceOptions"
                            class="source-select"
                        />
                    </div>

                    <div class="detail-list">
                        <div class="detail-row">
                            <span class="detail-label">原站地址</span>
                            <span class="detail-value mono-text">{{ sourceBaseUrl }}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">API 地址</span>
                            <span class="detail-value mono-text">{{ API_BASE_URL }}</span>
                        </div>
                    </div>

                    <n-space>
                        <n-button secondary @click="copyText(API_BASE_URL, 'API 地址已复制')">
                            复制 API 地址
                        </n-button>
                    </n-space>
                </n-space>
            </Card>
        </div>
    </div>
</template>

<style scoped>
.settings-page {
    max-width: 1220px;
    margin: 0 auto;
    width: 100%;
}

.settings-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-section-gap);
    margin-top: var(--ui-section-gap);
}

.settings-card {
    flex: 1 1 420px;
    min-height: 100%;
    min-width: 0;
    overflow: hidden;
}

.compact-card {
    flex-basis: 100%;
}

.loading-state,
.account-row,
.setting-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
}

.loading-state {
    color: var(--ui-secondary-text-color);
}

.alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.kb-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.kb-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    padding: 10px var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.kb-main {
    min-width: 0;
}

.kb-title {
    color: var(--ui-card-title-color);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.kb-meta {
    color: var(--ui-muted-text-color);
}

.account-row,
.setting-row {
    justify-content: space-between;
}

.account-row,
.setting-row {
    align-items: flex-start;
}

.detail-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    min-width: 0;
}

.detail-row {
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr);
    gap: var(--ui-space-3);
    align-items: start;
}

.detail-label {
    color: var(--ui-muted-text-color);
    white-space: nowrap;
}

.detail-value {
    min-width: 0;
    color: var(--ui-secondary-text-color);
    word-break: break-word;
}

.account-name,
.setting-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.account-meta,
.setting-desc {
    color: var(--ui-muted-text-color);
    line-height: 1.6;
}

.mono-text {
    display: inline-block;
    max-width: 100%;
    font-family: 'Fira Code', monospace;
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}

.source-select {
    width: 180px;
    flex: 0 0 auto;
}

@media (max-width: 768px) {
    .settings-grid {
        flex-direction: column;
    }

    .settings-card {
        flex-basis: auto;
    }

    .setting-row,
    .account-row,
    .kb-item {
        align-items: flex-start;
        flex-direction: column;
    }

    .setting-row > :first-child,
    .kb-main {
        width: 100%;
        min-width: 0;
    }

    .source-select {
        width: 100%;
    }
}

@media (max-width: 520px) {
    .detail-row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--ui-space-1);
    }
}
</style>
