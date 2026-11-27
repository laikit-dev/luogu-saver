<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NBadge, NIcon, NPopover, NSpin, NTooltip, useDialog, useMessage } from 'naive-ui';
import {
    AlertCircle,
    ArrowUpRight,
    Bell,
    ChevronRight,
    ChevronsUpDown,
    Info,
    LogIn,
    LogOut,
    Palette,
    PanelLeftClose,
    PanelLeftOpen,
    Settings,
    ShieldCheck,
    User,
    X
} from 'lucide-vue-next';
import LuoguLogo from '@/components/icons/LuoguLogo.vue';
import {
    isNavBranch,
    PRIMARY_NAV_GROUPS,
    type NavBranchItem,
    type NavLeafItem
} from '@/config/navigation.ts';
import {
    clearAuthToken,
    currentAuth,
    currentAuthState,
    isAuthenticated,
    startCpOAuthLogin
} from '@/utils/auth.ts';
import { logoutCurrentSession } from '@/api/auth.ts';

const props = withDefaults(
    defineProps<{
        collapsed?: boolean;
        mode?: 'desktop' | 'mobile';
        activeKey: string;
        unreadNotificationCount?: number;
        canShowAdmin?: boolean;
        sidebarLogoNavEnabled?: boolean;
    }>(),
    {
        collapsed: false,
        mode: 'desktop',
        unreadNotificationCount: 0,
        canShowAdmin: false,
        sidebarLogoNavEnabled: true
    }
);

const emit = defineEmits<{
    'toggle-collapse': [];
    'close-mobile': [];
    'open-theme': [];
    'open-notifications': [];
    'open-paintboard-dialog': [];
    navigate: [];
}>();

const route = useRoute();
const dialog = useDialog();
const message = useMessage();

const openSubmenus = reactive<Record<string, boolean>>({});
const openBranchPopovers = reactive<Record<string, boolean>>({});
const accountPopoverOpen = ref(false);
const avatarLoadFailed = ref(false);

const registeredUser = computed(() => currentAuth.value?.registeredUser ?? null);
const accountDisplayName = computed(
    () => registeredUser.value?.name || (currentAuth.value ? `用户 ${currentAuth.value.uid}` : '')
);
const accountInitial = computed(() => {
    const name = accountDisplayName.value.trim();
    return name ? name.slice(0, 1).toUpperCase() : 'U';
});
const accountAvatarUrl = computed(() =>
    !avatarLoadFailed.value && registeredUser.value?.avatarUrl
        ? registeredUser.value.avatarUrl
        : null
);
const accountIssue = computed(
    () => currentAuthState.value === 'expired' || currentAuthState.value === 'failed'
);

watch(
    () => registeredUser.value?.avatarUrl,
    () => {
        avatarLoadFailed.value = false;
    }
);

watch(
    () => props.collapsed,
    collapsed => {
        if (collapsed) {
            Object.keys(openBranchPopovers).forEach(key => {
                openBranchPopovers[key] = false;
            });
        }
        accountPopoverOpen.value = false;
    }
);

function isLeafActive(item: NavLeafItem) {
    return props.activeKey === item.key;
}

function isBranchActive(branch: NavBranchItem) {
    return branch.children.some(child => child.key === props.activeKey);
}

function toggleSubmenu(key: string) {
    openSubmenus[key] = !openSubmenus[key];
}

function handleLeafAction(item: NavLeafItem, parentBranchKey?: string) {
    if (parentBranchKey) openBranchPopovers[parentBranchKey] = false;
    if (item.action === 'paintboard-dialog') {
        emit('open-paintboard-dialog');
    }
    emit('navigate');
}

function handleExternalClick(parentBranchKey?: string) {
    if (parentBranchKey) openBranchPopovers[parentBranchKey] = false;
    emit('navigate');
}

function handleOpenTheme() {
    emit('open-theme');
    if (props.mode === 'mobile') emit('close-mobile');
}

function handleOpenNotifications() {
    emit('open-notifications');
    if (props.mode === 'mobile') emit('close-mobile');
}

function handleLogin() {
    startCpOAuthLogin(route.fullPath || '/');
}

function handleAccountNavigate() {
    accountPopoverOpen.value = false;
    emit('navigate');
}

function handleLogoutClick() {
    accountPopoverOpen.value = false;
    dialog.warning({
        title: '退出当前账号？',
        content: '退出后会清除本地保存的登录状态，需要重新通过 CP OAuth 登录。',
        positiveText: '退出登录',
        negativeText: '取消',
        positiveButtonProps: { type: 'error' },
        onPositiveClick: async () => {
            try {
                await logoutCurrentSession();
            } catch {
                // Always clear local token even if server revocation fails.
            }
            clearAuthToken();
            message.success('已退出登录');
        }
    });
}
</script>

<template>
    <div
        class="sidebar-surface"
        :class="{ 'is-collapsed': collapsed, 'is-mobile': mode === 'mobile' }"
    >
        <!-- Brand Header -->
        <div class="sidebar-header">
            <router-link
                v-if="sidebarLogoNavEnabled"
                to="/"
                class="brand-lockup brand-link"
                aria-label="返回首页"
                @click="emit('navigate')"
            >
                <n-icon class="brand-logo" :component="LuoguLogo" />
                <span v-if="!collapsed" class="brand-text">洛谷保存站</span>
            </router-link>
            <div v-else class="brand-lockup">
                <n-icon class="brand-logo" :component="LuoguLogo" />
                <span v-if="!collapsed" class="brand-text">洛谷保存站</span>
            </div>

            <n-tooltip v-if="mode === 'desktop' && !collapsed" placement="right">
                <template #trigger>
                    <button
                        type="button"
                        class="header-icon-btn"
                        aria-label="收起侧边栏"
                        @click="emit('toggle-collapse')"
                    >
                        <n-icon :size="18" :component="PanelLeftClose" />
                    </button>
                </template>
                收起侧边栏 ([)
            </n-tooltip>

            <button
                v-if="mode === 'mobile'"
                type="button"
                class="header-icon-btn mobile-close-btn"
                aria-label="关闭导航菜单"
                @click="emit('close-mobile')"
            >
                <n-icon :size="20" :component="X" />
            </button>
        </div>

        <!-- Collapsed Desktop Expand Control -->
        <div v-if="mode === 'desktop' && collapsed" class="sidebar-top-controls">
            <n-tooltip placement="right">
                <template #trigger>
                    <button
                        type="button"
                        class="rail-control-btn"
                        aria-label="展开侧边栏"
                        @click="emit('toggle-collapse')"
                    >
                        <n-icon :size="18" :component="PanelLeftOpen" />
                    </button>
                </template>
                展开侧边栏 ([)
            </n-tooltip>
        </div>

        <!-- Scrollable Primary Navigation -->
        <nav class="sidebar-nav" aria-label="主导航">
            <div
                v-for="(group, groupIndex) in PRIMARY_NAV_GROUPS"
                :key="group.key"
                class="nav-group"
            >
                <div v-if="!collapsed" class="nav-group-label">{{ group.label }}</div>
                <div
                    v-else-if="groupIndex > 0"
                    class="rail-divider"
                    role="separator"
                    aria-hidden="true"
                ></div>

                <ul class="nav-list">
                    <li v-for="item in group.items" :key="item.key" class="nav-list-item">
                        <!-- Branch Item (e.g. Paintboard) -->
                        <template v-if="isNavBranch(item)">
                            <n-popover
                                v-if="collapsed"
                                v-model:show="openBranchPopovers[item.key]"
                                trigger="click"
                                placement="right-start"
                                :show-arrow="false"
                                raw
                            >
                                <template #trigger>
                                    <div>
                                        <n-tooltip placement="right">
                                            <template #trigger>
                                                <button
                                                    type="button"
                                                    class="nav-link nav-branch-btn"
                                                    :class="{ 'is-active': isBranchActive(item) }"
                                                    :aria-label="item.label"
                                                    :aria-expanded="
                                                        Boolean(openBranchPopovers[item.key])
                                                    "
                                                >
                                                    <n-icon
                                                        :size="18"
                                                        :component="item.icon"
                                                        class="nav-icon"
                                                    />
                                                </button>
                                            </template>
                                            {{ item.label }}
                                        </n-tooltip>
                                    </div>
                                </template>

                                <div class="floating-submenu" role="menu">
                                    <div class="floating-submenu-title">{{ item.label }}</div>
                                    <template v-for="child in item.children" :key="child.key">
                                        <a
                                            v-if="child.href"
                                            :href="child.href"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="floating-submenu-item"
                                            role="menuitem"
                                            @click="handleExternalClick(item.key)"
                                        >
                                            <n-icon
                                                :size="16"
                                                :component="child.icon"
                                                class="nav-icon"
                                            />
                                            <span class="nav-label">{{ child.label }}</span>
                                            <n-icon
                                                v-if="child.external"
                                                :size="13"
                                                :component="ArrowUpRight"
                                                class="external-icon"
                                            />
                                        </a>
                                        <button
                                            v-else
                                            type="button"
                                            class="floating-submenu-item"
                                            role="menuitem"
                                            @click="handleLeafAction(child, item.key)"
                                        >
                                            <n-icon
                                                :size="16"
                                                :component="child.icon"
                                                class="nav-icon"
                                            />
                                            <span class="nav-label">{{ child.label }}</span>
                                        </button>
                                    </template>
                                </div>
                            </n-popover>

                            <template v-else>
                                <button
                                    type="button"
                                    class="nav-link nav-branch-btn"
                                    :class="{
                                        'is-active': isBranchActive(item),
                                        'is-open': Boolean(openSubmenus[item.key])
                                    }"
                                    :aria-expanded="Boolean(openSubmenus[item.key])"
                                    @click="toggleSubmenu(item.key)"
                                >
                                    <n-icon :size="18" :component="item.icon" class="nav-icon" />
                                    <span class="nav-label">{{ item.label }}</span>
                                    <n-icon
                                        :size="15"
                                        :component="ChevronRight"
                                        class="branch-chevron"
                                    />
                                </button>

                                <div
                                    class="ui-collapse"
                                    :class="{ 'is-open': Boolean(openSubmenus[item.key]) }"
                                    :aria-hidden="!openSubmenus[item.key]"
                                    :inert="!openSubmenus[item.key]"
                                >
                                    <div class="ui-collapse-inner">
                                        <ul class="nav-sublist">
                                            <li v-for="child in item.children" :key="child.key">
                                                <a
                                                    v-if="child.href"
                                                    :href="child.href"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="nav-sublink"
                                                    @click="handleExternalClick()"
                                                >
                                                    <n-icon
                                                        :size="15"
                                                        :component="child.icon"
                                                        class="nav-icon"
                                                    />
                                                    <span class="nav-label">{{ child.label }}</span>
                                                    <n-icon
                                                        v-if="child.external"
                                                        :size="13"
                                                        :component="ArrowUpRight"
                                                        class="external-icon"
                                                    />
                                                </a>
                                                <button
                                                    v-else
                                                    type="button"
                                                    class="nav-sublink"
                                                    @click="handleLeafAction(child)"
                                                >
                                                    <n-icon
                                                        :size="15"
                                                        :component="child.icon"
                                                        class="nav-icon"
                                                    />
                                                    <span class="nav-label">{{ child.label }}</span>
                                                </button>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </template>
                        </template>

                        <!-- External Leaf -->
                        <n-tooltip v-else-if="item.href" placement="right" :disabled="!collapsed">
                            <template #trigger>
                                <a
                                    :href="item.href"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="nav-link"
                                    :aria-label="
                                        collapsed ? `${item.label}（站外链接）` : undefined
                                    "
                                    @click="handleExternalClick()"
                                >
                                    <n-icon :size="18" :component="item.icon" class="nav-icon" />
                                    <span v-if="!collapsed" class="nav-label">{{
                                        item.label
                                    }}</span>
                                    <n-icon
                                        v-if="!collapsed && item.external"
                                        :size="14"
                                        :component="ArrowUpRight"
                                        class="external-icon"
                                    />
                                </a>
                            </template>
                            {{ item.label }}（站外）
                        </n-tooltip>

                        <!-- Internal Route Leaf -->
                        <n-tooltip v-else-if="item.to" placement="right" :disabled="!collapsed">
                            <template #trigger>
                                <router-link
                                    :to="item.to"
                                    class="nav-link"
                                    :class="{ 'is-active': isLeafActive(item) }"
                                    :aria-label="collapsed ? item.label : undefined"
                                    :aria-current="isLeafActive(item) ? 'page' : undefined"
                                    @click="emit('navigate')"
                                >
                                    <n-icon :size="18" :component="item.icon" class="nav-icon" />
                                    <span v-if="!collapsed" class="nav-label">{{
                                        item.label
                                    }}</span>
                                    <kbd
                                        v-if="!collapsed && mode === 'desktop' && item.shortcut"
                                        class="shortcut-kbd"
                                        aria-hidden="true"
                                    >
                                        {{ item.shortcut }}
                                    </kbd>
                                </router-link>
                            </template>
                            {{ item.shortcut ? `${item.label} (${item.shortcut})` : item.label }}
                        </n-tooltip>
                    </li>
                </ul>
            </div>
        </nav>

        <!-- Sticky Footer: Admin, Utilities, Account -->
        <div class="sidebar-footer">
            <!-- Permission-Gated Admin Entry -->
            <n-tooltip v-if="canShowAdmin" placement="right" :disabled="!collapsed">
                <template #trigger>
                    <router-link
                        to="/admin"
                        class="nav-link admin-link"
                        :class="{ 'is-active': activeKey === 'admin' }"
                        :aria-label="collapsed ? '管理后台' : undefined"
                        :aria-current="activeKey === 'admin' ? 'page' : undefined"
                        @click="emit('navigate')"
                    >
                        <n-icon :size="18" :component="ShieldCheck" class="nav-icon" />
                        <span v-if="!collapsed" class="nav-label">管理后台</span>
                    </router-link>
                </template>
                管理后台
            </n-tooltip>

            <!-- Utility Actions -->
            <div
                class="utility-group"
                :class="{
                    'is-collapsed': collapsed,
                    'is-two-col': !collapsed && isAuthenticated,
                    'is-three-col': !collapsed && !isAuthenticated
                }"
            >
                <n-tooltip v-if="isAuthenticated" placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <button
                            type="button"
                            class="utility-btn"
                            :aria-label="
                                unreadNotificationCount > 0
                                    ? `站内通知（${unreadNotificationCount} 条未读）`
                                    : '站内通知'
                            "
                            @click="handleOpenNotifications"
                        >
                            <n-badge
                                v-if="collapsed"
                                :value="unreadNotificationCount"
                                :max="99"
                                :show="unreadNotificationCount > 0"
                                dot
                            >
                                <n-icon :size="17" :component="Bell" />
                            </n-badge>
                            <template v-else>
                                <n-icon :size="15" :component="Bell" class="utility-icon" />
                                <span class="utility-label">通知</span>
                                <span
                                    v-if="unreadNotificationCount > 0"
                                    class="utility-badge"
                                    aria-hidden="true"
                                >
                                    {{
                                        unreadNotificationCount > 99
                                            ? '99+'
                                            : unreadNotificationCount
                                    }}
                                </span>
                            </template>
                        </button>
                    </template>
                    {{
                        unreadNotificationCount > 0
                            ? `站内通知（${unreadNotificationCount} 未读）`
                            : '站内通知'
                    }}
                </n-tooltip>

                <n-tooltip placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <button
                            type="button"
                            class="utility-btn"
                            aria-label="主题编辑器"
                            @click="handleOpenTheme"
                        >
                            <n-icon
                                :size="collapsed ? 17 : 15"
                                :component="Palette"
                                class="utility-icon"
                            />
                            <span v-if="!collapsed" class="utility-label">主题</span>
                        </button>
                    </template>
                    主题编辑器
                </n-tooltip>

                <n-tooltip placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <router-link
                            to="/settings"
                            class="utility-btn"
                            :class="{ 'is-active': activeKey === 'settings' }"
                            :aria-label="collapsed ? '设置' : undefined"
                            :aria-current="activeKey === 'settings' ? 'page' : undefined"
                            @click="emit('navigate')"
                        >
                            <n-icon
                                :size="collapsed ? 17 : 15"
                                :component="Settings"
                                class="utility-icon"
                            />
                            <span v-if="!collapsed" class="utility-label">设置</span>
                        </router-link>
                    </template>
                    设置
                </n-tooltip>

                <n-tooltip placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <router-link
                            to="/about"
                            class="utility-btn"
                            :class="{ 'is-active': activeKey === 'about' }"
                            :aria-label="collapsed ? '关于' : undefined"
                            :aria-current="activeKey === 'about' ? 'page' : undefined"
                            @click="emit('navigate')"
                        >
                            <n-icon
                                :size="collapsed ? 17 : 15"
                                :component="Info"
                                class="utility-icon"
                            />
                            <span v-if="!collapsed" class="utility-label">关于</span>
                        </router-link>
                    </template>
                    关于
                </n-tooltip>
            </div>

            <!-- Account Area -->
            <div class="account-section">
                <!-- Unauthenticated -->
                <n-tooltip v-if="!isAuthenticated" placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <button
                            type="button"
                            class="account-login-btn"
                            :aria-label="collapsed ? '使用 CP OAuth 登录' : undefined"
                            @click="handleLogin"
                        >
                            <n-icon :size="17" :component="LogIn" />
                            <span v-if="!collapsed">CP OAuth 登录</span>
                        </button>
                    </template>
                    使用 CP OAuth 登录
                </n-tooltip>

                <!-- Auth Expired / Failed -->
                <n-tooltip v-else-if="accountIssue" placement="right" :disabled="!collapsed">
                    <template #trigger>
                        <router-link
                            to="/settings"
                            class="account-card is-warning"
                            :aria-label="
                                currentAuthState === 'expired'
                                    ? '登录已失效，前往设置重新登录'
                                    : '账号信息加载失败，前往设置处理'
                            "
                            @click="emit('navigate')"
                        >
                            <span class="account-avatar is-warning">
                                <n-icon :size="15" :component="AlertCircle" />
                            </span>
                            <span v-if="!collapsed" class="account-meta">
                                <span class="account-name">
                                    {{
                                        currentAuthState === 'expired'
                                            ? '登录已失效'
                                            : '账号加载失败'
                                    }}
                                </span>
                                <span class="account-sub">前往设置处理</span>
                            </span>
                        </router-link>
                    </template>
                    {{
                        currentAuthState === 'expired' ? '登录已失效，前往重新登录' : '账号加载失败'
                    }}
                </n-tooltip>

                <!-- Auth Ready -->
                <n-popover
                    v-else-if="currentAuthState === 'ready' && currentAuth"
                    v-model:show="accountPopoverOpen"
                    trigger="click"
                    :placement="collapsed ? 'right-end' : 'top-start'"
                    :show-arrow="false"
                    raw
                >
                    <template #trigger>
                        <div>
                            <n-tooltip placement="right" :disabled="!collapsed">
                                <template #trigger>
                                    <button
                                        type="button"
                                        class="account-card"
                                        :aria-label="collapsed ? accountDisplayName : '账号菜单'"
                                        :aria-expanded="accountPopoverOpen"
                                    >
                                        <span class="account-avatar">
                                            <img
                                                v-if="accountAvatarUrl"
                                                :src="accountAvatarUrl"
                                                :alt="accountDisplayName"
                                                class="account-avatar-img"
                                                @error="avatarLoadFailed = true"
                                            />
                                            <span v-else>{{ accountInitial }}</span>
                                        </span>
                                        <span v-if="!collapsed" class="account-meta">
                                            <span class="account-name">{{
                                                accountDisplayName
                                            }}</span>
                                            <span class="account-sub">
                                                {{
                                                    registeredUser?.luoguUid
                                                        ? `UID ${registeredUser.luoguUid}`
                                                        : '已登录'
                                                }}
                                            </span>
                                        </span>
                                        <n-icon
                                            v-if="!collapsed"
                                            :size="15"
                                            :component="ChevronsUpDown"
                                            class="account-chevron"
                                        />
                                    </button>
                                </template>
                                {{ accountDisplayName }}
                            </n-tooltip>
                        </div>
                    </template>

                    <div class="account-popover" role="menu">
                        <div class="account-popover-header">
                            <div class="account-popover-name">{{ accountDisplayName }}</div>
                            <div v-if="registeredUser?.luoguUid" class="account-popover-uid">
                                洛谷 UID {{ registeredUser.luoguUid }}
                            </div>
                        </div>

                        <router-link
                            v-if="registeredUser?.luoguUid"
                            :to="`/user/${registeredUser.luoguUid}`"
                            class="floating-submenu-item"
                            role="menuitem"
                            @click="handleAccountNavigate"
                        >
                            <n-icon :size="16" :component="User" class="nav-icon" />
                            <span>我的归档</span>
                        </router-link>

                        <router-link
                            to="/settings"
                            class="floating-submenu-item"
                            role="menuitem"
                            @click="handleAccountNavigate"
                        >
                            <n-icon :size="16" :component="Settings" class="nav-icon" />
                            <span>账号与设置</span>
                        </router-link>

                        <div class="popover-divider" role="separator"></div>

                        <button
                            type="button"
                            class="floating-submenu-item is-danger"
                            role="menuitem"
                            @click="handleLogoutClick"
                        >
                            <n-icon :size="16" :component="LogOut" class="nav-icon" />
                            <span>退出登录</span>
                        </button>
                    </div>
                </n-popover>

                <!-- Auth Loading -->
                <div v-else class="account-card is-loading" role="status">
                    <span class="account-avatar">
                        <n-spin :size="14" />
                    </span>
                    <span v-if="!collapsed" class="account-meta">
                        <span class="account-name">正在确认身份…</span>
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.sidebar-surface {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    color: var(--ui-text-color);
    background: var(--ui-card-color);
    user-select: none;
}

.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-1);
    height: 56px;
    padding: 0 var(--ui-space-2);
    border-bottom: 1px solid var(--ui-border-color);
    flex-shrink: 0;
    box-sizing: border-box;
}

.sidebar-surface.is-collapsed .sidebar-header {
    justify-content: center;
    padding: 0 var(--ui-space-2);
}

.brand-lockup {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    height: 38px;
    padding: 0 var(--ui-space-3);
    min-width: 0;
    color: inherit;
    text-decoration: none;
    box-sizing: border-box;
}

.sidebar-surface.is-collapsed .brand-lockup {
    justify-content: center;
    width: 40px;
    padding: 0;
}

.brand-link {
    border-radius: var(--ui-card-radius);
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

@media (hover: hover) {
    .brand-link:hover {
        background: var(--ui-panel-color);
    }
}

.brand-link:focus-visible,
.header-icon-btn:focus-visible,
.rail-control-btn:focus-visible,
.nav-link:focus-visible,
.nav-sublink:focus-visible,
.utility-btn:focus-visible,
.account-login-btn:focus-visible,
.account-card:focus-visible,
.floating-submenu-item:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: -2px;
}

.brand-logo {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    color: var(--ui-icon-color);
    font-size: 22px;
}

.brand-text {
    color: var(--ui-card-title-color);
    font-family: var(--ui-font-family-display);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.header-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    padding: 0;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-secondary-text-color);
    cursor: pointer;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.header-icon-btn:active {
    transform: scale(0.95);
}

.mobile-close-btn {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
}

@media (hover: hover) {
    .header-icon-btn:hover {
        background: var(--ui-panel-color);
        color: var(--ui-text-color);
    }
}

.sidebar-top-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--ui-space-3) var(--ui-space-2) 0;
    flex-shrink: 0;
}

.rail-control-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-secondary-text-color);
    cursor: pointer;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.rail-control-btn:active {
    transform: scale(0.95);
}

@media (hover: hover) {
    .rail-control-btn:hover {
        background: var(--ui-panel-color);
        color: var(--ui-text-color);
    }
}
.shortcut-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid var(--ui-control-border-color);
    border-radius: 4px;
    background: var(--ui-card-color);
    color: var(--ui-muted-text-color);
    font-family: var(--ui-font-family-mono);
    font-size: 11px;
    line-height: 1;
}

.sidebar-nav {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--ui-space-3) var(--ui-space-2);
}

.nav-group + .nav-group {
    margin-top: var(--ui-space-3);
}

.sidebar-surface.is-collapsed .nav-group + .nav-group {
    margin-top: var(--ui-space-2);
}

.nav-group-label {
    padding: var(--ui-space-1) var(--ui-space-3);
    margin-bottom: 2px;
    color: var(--ui-muted-text-color);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
}

.rail-divider {
    width: 28px;
    height: 1px;
    margin: var(--ui-space-2) auto;
    background: var(--ui-border-color);
}

.nav-list,
.nav-sublist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.nav-list-item {
    min-width: 0;
}

.nav-link {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    width: 100%;
    height: 38px;
    padding: 0 var(--ui-space-3);
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.3;
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.sidebar-surface.is-mobile .nav-link {
    height: 44px;
}

.sidebar-surface.is-collapsed .nav-link {
    justify-content: center;
    width: 40px;
    height: 38px;
    margin: 0 auto;
    padding: 0;
}

.nav-link.is-active {
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
    font-weight: 600;
}

.nav-link.is-active::before {
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    content: '';
    background: var(--ui-primary-color);
    transform-origin: center;
    animation: nav-indicator-in var(--ui-motion-normal) var(--ui-motion-ease-out);
}

@keyframes nav-indicator-in {
    from {
        opacity: 0;
        transform: scaleY(0.35);
    }
    to {
        opacity: 1;
        transform: scaleY(1);
    }
}

.nav-link:active,
.nav-sublink:active {
    transform: scale(0.985);
}

.sidebar-surface.is-collapsed .nav-link.is-active::before {
    left: -10px;
}

@media (hover: hover) {
    .nav-link:hover {
        background: var(--ui-panel-color);
        color: var(--ui-text-color);
    }

    .nav-link.is-active:hover {
        color: var(--ui-primary-color);
    }
}

.nav-icon {
    flex-shrink: 0;
}

.nav-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.external-icon {
    flex-shrink: 0;
    color: var(--ui-muted-text-color);
}

.branch-chevron {
    flex-shrink: 0;
    color: var(--ui-muted-text-color);
    transition: transform var(--ui-motion-fast) var(--ui-motion-ease);
}

.nav-branch-btn.is-open .branch-chevron {
    transform: rotate(90deg);
}

.nav-sublist {
    margin: 2px 0 4px 20px;
    padding-left: 10px;
    border-left: 1px solid var(--ui-border-color);
}

.nav-sublink {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.sidebar-surface.is-mobile .nav-sublink {
    height: 40px;
    font-size: 14px;
}

@media (hover: hover) {
    .nav-sublink:hover {
        background: var(--ui-panel-color);
        color: var(--ui-text-color);
    }
}

/* Sticky Footer */
.sidebar-footer {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: var(--ui-space-2) var(--ui-space-2)
        calc(var(--ui-space-3) + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--ui-border-color);
    background: var(--ui-card-color);
    flex-shrink: 0;
}

.admin-link {
    height: 36px;
}

.utility-group {
    display: grid;
    gap: 6px;
}

.utility-group.is-two-col {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.utility-group.is-three-col {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.utility-group.is-collapsed {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

.utility-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 34px;
    padding: 0 6px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    min-width: 0;
    box-sizing: border-box;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        border-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.utility-btn:active {
    transform: scale(0.96);
}

.sidebar-surface.is-mobile .utility-btn {
    height: 40px;
    font-size: 14px;
}

.utility-group.is-collapsed .utility-btn {
    width: 40px;
    height: 36px;
    padding: 0;
    border-color: transparent;
}

.utility-btn.is-active {
    background: var(--ui-panel-color);
    border-color: var(--ui-control-border-hover-color);
    color: var(--ui-primary-color);
    font-weight: 600;
}

@media (hover: hover) {
    .utility-btn:hover {
        background: var(--ui-panel-color);
        color: var(--ui-text-color);
    }

    .utility-btn.is-active:hover {
        color: var(--ui-primary-color);
    }
}

.utility-icon {
    flex-shrink: 0;
}

.utility-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.utility-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-error-color);
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
}

.account-section {
    padding-top: 2px;
}

.account-login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ui-space-2);
    width: 100%;
    height: 38px;
    padding: 0 var(--ui-space-3);
    border: 1px solid var(--ui-control-border-color);
    border-radius: var(--ui-button-radius);
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-sizing: border-box;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        border-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.account-login-btn:active {
    transform: scale(0.98);
}

.sidebar-surface.is-mobile .account-login-btn {
    height: 44px;
    font-size: 14px;
}

.sidebar-surface.is-collapsed .account-login-btn {
    width: 40px;
    height: 38px;
    margin: 0 auto;
    padding: 0;
}

@media (hover: hover) {
    .account-login-btn:hover {
        border-color: var(--ui-primary-color);
        color: var(--ui-primary-color-hover);
    }
}

.account-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-text-color);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        border-color var(--ui-motion-fast) var(--ui-motion-ease);
}

.sidebar-surface.is-collapsed .account-card {
    justify-content: center;
    width: 40px;
    min-height: 40px;
    margin: 0 auto;
    padding: 0;
    border-color: transparent;
}

.account-card.is-loading {
    cursor: default;
}

.account-card.is-warning {
    border-color: var(--ui-warning-color);
    background: var(--ui-alert-warning-background-color);
}

@media (hover: hover) {
    .account-card:not(.is-loading):hover {
        background: var(--ui-panel-color);
        border-color: var(--ui-control-border-hover-color);
    }
}

.account-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
}

.account-avatar.is-warning {
    color: var(--ui-warning-color);
}

.account-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.account-meta {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.account-name {
    color: var(--ui-text-color);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.account-sub {
    color: var(--ui-muted-text-color);
    font-size: 12px;
    line-height: 1.3;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.account-chevron {
    flex-shrink: 0;
    color: var(--ui-muted-text-color);
}

/* Floating Popover Menus (Collapsed Branch & Account) */
.floating-submenu,
.account-popover {
    min-width: 184px;
    padding: 6px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
    box-shadow: var(--ui-elevated-shadow);
    color: var(--ui-text-color);
}

.floating-submenu-title {
    padding: 6px 10px 4px;
    color: var(--ui-muted-text-color);
    font-size: 12px;
    font-weight: 600;
}

.account-popover-header {
    padding: 6px 10px 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--ui-border-color);
}

.account-popover-name {
    color: var(--ui-card-title-color);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
}

.account-popover-uid {
    margin-top: 2px;
    color: var(--ui-muted-text-color);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.floating-submenu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--ui-button-radius);
    background: transparent;
    color: var(--ui-text-color);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    transition: background-color var(--ui-motion-fast) var(--ui-motion-ease);
}

@media (hover: hover) {
    .floating-submenu-item:hover {
        background: var(--ui-panel-color);
    }
}

.floating-submenu-item.is-danger {
    color: var(--ui-error-color);
}

.popover-divider {
    height: 1px;
    margin: 4px 0;
    background: var(--ui-border-color);
}
</style>
