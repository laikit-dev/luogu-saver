<script setup lang="ts">
import { computed, inject, onMounted, type Ref } from 'vue';
import {
    NAlert,
    NButton,
    NIcon,
    NInput,
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
    Navigation,
    Palette,
    RefreshCw,
    Settings,
    Trash2
} from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import LogoutButton from '@/components/LogoutButton.vue';
import ThemePresetGrid from '@/components/ThemePresetGrid.vue';
import TypographyPreviewCard from '@/components/TypographyPreviewCard.vue';
import {
    clearAuthToken,
    currentAuth,
    currentAuthState,
    isAuthenticated,
    startCpOAuthLogin
} from '@/utils/auth.ts';
import { ensureCurrentAuth, logoutCurrentSession } from '@/api/auth.ts';
import {
    CACHE_STORAGE_KEY,
    CONTENT_BOOKMARK_STORAGE_PREFIX,
    DEVICE_ID_STORAGE_KEY,
    JUDGEMENT_DISPLAY_OPTIONS_STORAGE_KEY
} from '@/utils/constants.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { generateDeviceId } from '@/utils/device-id.ts';
import { API_BASE_URL } from '@/utils/api-base-url.ts';
import { formatDate } from '@/utils/render.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { trackingAllowed, trackingConsent } from '@/utils/tracking-consent.ts';
import { useCodeFont } from '@/composables/useCodeFont.ts';
import { useMotionPreference } from '@/composables/useMotionPreference.ts';
import { useReadingFont } from '@/composables/useReadingFont.ts';
import { uiThemeModeKey, uiThemePresetKey } from '@/styles/theme/themeKeys.ts';
import { THEME_MODE_OPTIONS } from '@/styles/theme/presets.ts';

const message = useMessage();
const dialog = useDialog();
const uiThemePreset = inject(uiThemePresetKey)!;
const uiThemeMode = inject(uiThemeModeKey)!;
const themeModeOptions = [...THEME_MODE_OPTIONS];
const sidebarLogoNavEnabled = inject('sidebarLogoNavEnabled') as Ref<boolean | null>;
const logoNavEnabled = computed({
    get: () => sidebarLogoNavEnabled.value ?? true,
    set: val => {
        sidebarLogoNavEnabled.value = val;
    }
});
const { selectedSource, sourceBaseUrl, sourceOptions } = useLuoguSource();
const { motionPreference, motionPreferenceOptions } = useMotionPreference();
const { readingFont, readingFontSelectOptions, readingFontLoading } = useReadingFont();
const { codeFont, customCodeFont, codeFontOptions } = useCodeFont();

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

async function handleLogout() {
    try {
        await logoutCurrentSession();
    } catch {
        // Always clear local token even if server revocation fails.
    }
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
        <CardTitle title="设置" :icon="Settings" />

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
                            <LogoutButton @confirm="handleLogout" />
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
                            <LogoutButton @confirm="handleLogout" />
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
                                开启后会记录浏览的文章和设备 ID，用于文章广场推荐。
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
                            <span class="detail-value mono-text">{{ deviceId || '未生成' }}</span>
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
                <div class="setting-list">
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
                            <div class="setting-desc">删除已保存的显示方式和内容显示选项。</div>
                        </div>
                        <n-button secondary type="warning" @click="clearJudgementDisplayOptions">
                            删除偏好
                        </n-button>
                    </div>
                </div>
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

            <Card title="外观" :icon="Palette" class="settings-card">
                <div class="setting-list">
                    <div class="setting-block">
                        <div>
                            <div id="theme-preset-setting-title" class="setting-title">
                                主题预设
                            </div>
                            <div id="theme-preset-setting-desc" class="setting-desc">
                                选择站点整体配色风格，支持与浅色或深色模式组合使用。
                            </div>
                        </div>
                        <ThemePresetGrid
                            v-model="uiThemePreset"
                            :mode="uiThemeMode"
                            layout="wide"
                            aria-labelledby="theme-preset-setting-title"
                            aria-describedby="theme-preset-setting-desc"
                        />
                    </div>

                    <div class="setting-row">
                        <div>
                            <div id="theme-mode-setting-title" class="setting-title">配色模式</div>
                            <div id="theme-mode-setting-desc" class="setting-desc">
                                默认跟随系统自动切换浅色与深色，也可固定为浅色或深色。
                            </div>
                        </div>
                        <n-select
                            v-model:value="uiThemeMode"
                            :options="themeModeOptions"
                            class="source-select"
                            aria-labelledby="theme-mode-setting-title"
                            aria-describedby="theme-mode-setting-desc"
                        />
                    </div>

                    <div class="setting-row">
                        <div>
                            <div id="reading-font-setting-title" class="setting-title">
                                文章阅读字体
                            </div>
                            <div id="reading-font-setting-desc" class="setting-desc">
                                选择文章正文与题解阅读时使用的中英文字体。
                            </div>
                        </div>
                        <n-select
                            v-model:value="readingFont"
                            :options="readingFontSelectOptions"
                            :loading="readingFontLoading"
                            class="source-select"
                            aria-labelledby="reading-font-setting-title"
                            aria-describedby="reading-font-setting-desc"
                        />
                    </div>

                    <div class="setting-row">
                        <div>
                            <div id="code-font-setting-title" class="setting-title">代码字体</div>
                            <div id="code-font-setting-desc" class="setting-desc">
                                选择代码块与行内代码使用的等宽字体，支持自定义系统字体栈。
                            </div>
                        </div>
                        <n-select
                            v-model:value="codeFont"
                            :options="codeFontOptions"
                            class="source-select"
                            aria-labelledby="code-font-setting-title"
                            aria-describedby="code-font-setting-desc"
                        />
                    </div>

                    <div v-if="codeFont === 'custom'" class="setting-row">
                        <div>
                            <div id="custom-code-font-setting-title" class="setting-title">
                                自定义代码字体
                            </div>
                            <div id="custom-code-font-setting-desc" class="setting-desc">
                                输入本地已安装的字体名称或字体栈，多个字体请用逗号分隔。
                            </div>
                        </div>
                        <n-input
                            v-model:value="customCodeFont"
                            placeholder="例如：Maple Mono, Sarasa Mono SC"
                            clearable
                            class="source-select"
                            aria-labelledby="custom-code-font-setting-title"
                            aria-describedby="custom-code-font-setting-desc"
                        />
                    </div>

                    <div class="setting-block">
                        <TypographyPreviewCard />
                    </div>

                    <div class="setting-row">
                        <div>
                            <div id="motion-preference-setting-title" class="setting-title">
                                界面动效
                            </div>
                            <div id="motion-preference-setting-desc" class="setting-desc">
                                默认跟随系统减弱动态效果偏好，也可手动开启标准动效或减少动效。
                            </div>
                        </div>
                        <n-select
                            v-model:value="motionPreference"
                            :options="motionPreferenceOptions"
                            class="source-select"
                            aria-labelledby="motion-preference-setting-title"
                            aria-describedby="motion-preference-setting-desc"
                        />
                    </div>
                </div>
            </Card>

            <Card title="连接信息" :icon="Cloud" class="settings-card">
                <n-space vertical size="large">
                    <div class="setting-row">
                        <div>
                            <div class="setting-title">原站地址</div>
                            <div class="setting-desc">
                                原站按钮会打开当前选择的洛谷域名（陶片放逐页除外）。
                            </div>
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
    box-sizing: border-box;
    max-width: 780px;
    margin: 0 auto;
    width: 100%;
    min-width: 0;
}

.settings-grid {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    margin-top: var(--ui-space-2);
}

.settings-card {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    overflow: hidden;
}

.settings-card :deep(.n-space),
.settings-card :deep(.n-space > div) {
    min-width: 0;
    max-width: 100%;
}

.setting-list {
    display: flex;
    flex-direction: column;
}

.setting-list > .setting-row {
    align-items: center;
    padding: var(--ui-space-3) 0;
}

.setting-block {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    min-width: 0;
    max-width: 100%;
    padding: var(--ui-space-3) 0;
}

.setting-list > :first-child {
    padding-top: 0;
}

.setting-list > :last-child {
    padding-bottom: 0;
}

.setting-list > :is(.setting-row, .setting-block) + :is(.setting-row, .setting-block) {
    border-top: 1px solid var(--ui-border-color);
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
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.account-meta,
.setting-desc {
    margin-top: 2px;
    color: var(--ui-muted-text-color);
    font-size: 13px;
    line-height: 1.55;
}
.mono-text {
    display: inline-block;
    max-width: 100%;
    font-family: var(--ui-font-family-mono);
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

    .setting-list > .setting-row,
    .setting-row,
    .account-row {
        align-items: flex-start;
        flex-direction: column;
    }

    .setting-row > :first-child {
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
