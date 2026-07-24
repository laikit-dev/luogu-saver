<script setup lang="ts">
import { computed, inject, onMounted, ref, type Ref } from 'vue';
import {
    NAlert,
    NButton,
    NIcon,
    NSelect,
    NSpace,
    NSpin,
    NSwitch,
    NTag,
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
    isAuthenticated,
    setCurrentAuth,
    startCpOAuthLogin
} from '@/utils/auth.ts';
import { getCurrentUser, type AuthMeResponse } from '@/api/auth.ts';
import {
    AUTH_TOKEN_STORAGE_KEY,
    CACHE_STORAGE_KEY,
    CONSENT_TRACKING_STORAGE_KEY,
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

const message = useMessage();
const loading = ref(false);
const currentUser = ref<AuthMeResponse | null>(null);
const errorMessage = ref('');
const trackingStorage = useLocalStorage(CONSENT_TRACKING_STORAGE_KEY, 'denied');
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
    get: () => trackingStorage.value === 'allowed',
    set: value => {
        trackingStorage.value = value ? 'allowed' : 'denied';
        message.success(value ? '数据追踪已开启' : '数据追踪已关闭');
    }
});

const deviceId = useLocalStorage(DEVICE_ID_STORAGE_KEY, '');
const authStatus = computed(() => (isAuthenticated.value ? '已登录' : '未登录'));
const authTagType = computed(() => (isAuthenticated.value ? 'success' : 'default'));
const registeredUser = computed(() => currentUser.value?.registeredUser || null);

async function loadCurrentUser() {
    if (!isAuthenticated.value) return;

    loading.value = true;
    errorMessage.value = '';
    try {
        const response = await getCurrentUser();
        if (response.code === 200) {
            currentUser.value = response.data;
            setCurrentAuth(response.data);
        } else {
            errorMessage.value = response.message;
        }
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '加载用户信息失败';
    } finally {
        loading.value = false;
    }
}

function handleLogout() {
    clearAuthToken();
    currentUser.value = null;
    message.success('已退出登录');
}

function resetDeviceId() {
    deviceId.value = null;
    if (trackingEnabled.value) deviceId.value = generateDeviceId();
    message.success('设备 ID 已重置');
}

function clearSaveCache() {
    let count = 0;
    for (const key of Object.keys(localStorage)) {
        if (key.startsWith(CACHE_STORAGE_KEY)) {
            localStorage.removeItem(key);
            count += 1;
        }
    }
    message.success(count ? `已清理 ${count} 项保存缓存` : '没有可清理的保存缓存');
}

function clearContentBookmarks() {
    let count = 0;
    for (const key of Object.keys(localStorage)) {
        if (key.startsWith(CONTENT_BOOKMARK_STORAGE_PREFIX)) {
            localStorage.removeItem(key);
            count += 1;
        }
    }
    message.success(count ? `已删除 ${count} 项段落收藏数据` : '没有可删除的段落收藏');
}

function clearJudgementDisplayOptions() {
    if (localStorage.getItem(JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY) === null) {
        message.success('没有可删除的陶片放逐内容显示偏好');
        return;
    }
    localStorage.removeItem(JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY);
    message.success('已删除陶片放逐内容显示偏好');
}

function removeKnowledgeBaseArticle(articleId: string) {
    knowledgeBase.removeArticle(articleId);
    message.success('已从知识库移除');
}

function clearKnowledgeBase() {
    knowledgeBase.clearArticles();
    message.success('知识库已清空');
}

async function copyText(text: string, successText: string) {
    try {
        await navigator.clipboard.writeText(text);
        message.success(successText);
    } catch {
        message.error('复制失败');
    }
}

onMounted(loadCurrentUser);
</script>

<template>
    <div class="settings-page">
        <CardTitle title="设置" :icon="Settings"> ACCOUNT AND LOCAL SETTINGS </CardTitle>

        <div class="settings-grid">
            <Card title="账号" :icon="KeyRound" class="settings-card">
                <n-space vertical size="large">
                    <n-alert v-if="errorMessage" type="warning" title="账号状态">
                        {{ errorMessage }}
                    </n-alert>

                    <div v-if="loading" class="loading-state">
                        <n-spin size="small" />
                        <span>正在加载账号信息...</span>
                    </div>

                    <template v-else-if="isAuthenticated && currentUser">
                        <div class="account-row">
                            <div>
                                <div class="account-name">
                                    {{ registeredUser?.name || `用户 ${currentUser.uid}` }}
                                </div>
                                <div class="account-meta">
                                    Luogu UID: {{ registeredUser?.luoguUid || '-' }}
                                </div>
                            </div>
                            <n-tag :type="authTagType">{{ authStatus }}</n-tag>
                        </div>

                        <div class="detail-list">
                            <div class="detail-row">
                                <span class="detail-label">权限值</span>
                                <span class="detail-value">{{ currentUser.role }}</span>
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
                            <n-button secondary @click="loadCurrentUser">
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

                    <template v-else>
                        <div class="account-meta">使用 CP OAuth 登录，并绑定你的洛谷账号。</div>
                        <n-button type="primary" @click="startCpOAuthLogin('/settings')">
                            使用 CP OAuth 登录
                        </n-button>
                    </template>
                </n-space>
            </Card>

            <Card title="隐私与数据追踪" :icon="ChartNoAxesCombined" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div class="setting-title">允许匿名数据追踪</div>
                            <div class="setting-desc">
                                开启后用于匿名推荐；关闭后后续请求不会发送设备 ID。
                            </div>
                        </div>
                        <n-switch v-model:value="trackingEnabled" />
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
                                <n-button
                                    secondary
                                    size="small"
                                    tag="a"
                                    :href="`/article/${item.id}`"
                                >
                                    查看
                                </n-button>
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
                            <div class="setting-title">侧边栏 Logo 点击导航</div>
                            <div class="setting-desc">启用后点击侧边栏 Logo 会跳转到首页</div>
                        </div>
                        <n-switch v-model:value="logoNavEnabled" />
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
    gap: 20px;
    margin-top: 16px;
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
.setting-row,
.status-item {
    display: flex;
    align-items: center;
    gap: 12px;
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
    gap: 12px;
    padding: 10px 12px;
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
    font-size: 12px;
}

.account-row,
.setting-row,
.status-item {
    justify-content: space-between;
}

.account-row,
.setting-row {
    align-items: flex-start;
}

.detail-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}

.detail-row {
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr);
    gap: 12px;
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
    font-size: 12px;
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}

.source-select {
    width: 180px;
    flex: 0 0 auto;
}

.status-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}

.status-item {
    padding: 10px 12px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

@media (max-width: 900px) {
    .status-list {
        grid-template-columns: minmax(0, 1fr);
    }

    .settings-grid {
        flex-direction: column;
    }

    .settings-card {
        flex-basis: auto;
        width: 100%;
    }

    .setting-row,
    .status-item,
    .account-row,
    .kb-item {
        align-items: flex-start;
        flex-direction: column;
    }

    .source-select {
        width: 100%;
    }
}

@media (max-width: 520px) {
    .detail-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
    }
}
</style>
