<script setup lang="ts">
import { NBadge, NIcon } from 'naive-ui';
import { Bell, Menu, Search } from 'lucide-vue-next';
import LuoguLogo from '@/components/icons/LuoguLogo.vue';
import { isAuthenticated } from '@/utils/auth.ts';

withDefaults(
    defineProps<{
        activeKey: string;
        drawerOpen: boolean;
        unreadNotificationCount?: number;
        sidebarLogoNavEnabled?: boolean;
    }>(),
    {
        unreadNotificationCount: 0,
        sidebarLogoNavEnabled: true
    }
);

const emit = defineEmits<{
    'open-drawer': [];
    'open-notifications': [];
}>();
</script>

<template>
    <header class="mobile-topbar">
        <div class="topbar-left">
            <button
                type="button"
                class="topbar-icon-btn"
                aria-label="打开导航菜单"
                :aria-expanded="drawerOpen"
                @click="emit('open-drawer')"
            >
                <n-icon :size="20" :component="Menu" />
            </button>

            <router-link
                v-if="sidebarLogoNavEnabled"
                to="/"
                class="topbar-brand topbar-brand-link"
                aria-label="返回首页"
            >
                <n-icon class="topbar-logo" :component="LuoguLogo" />
                <span class="topbar-title">洛谷保存站</span>
            </router-link>
            <div v-else class="topbar-brand">
                <n-icon class="topbar-logo" :component="LuoguLogo" />
                <span class="topbar-title">洛谷保存站</span>
            </div>
        </div>

        <div class="topbar-actions">
            <router-link
                to="/search"
                class="topbar-icon-btn"
                :class="{ 'is-active': activeKey === 'search' }"
                aria-label="搜索"
                :aria-current="activeKey === 'search' ? 'page' : undefined"
            >
                <n-icon :size="19" :component="Search" />
            </router-link>

            <button
                v-if="isAuthenticated"
                type="button"
                class="topbar-icon-btn"
                :aria-label="
                    unreadNotificationCount > 0
                        ? `站内通知（${unreadNotificationCount} 条未读）`
                        : '站内通知'
                "
                @click="emit('open-notifications')"
            >
                <n-badge
                    :value="unreadNotificationCount"
                    :max="99"
                    :show="unreadNotificationCount > 0"
                    :offset="[-2, 2]"
                >
                    <n-icon :size="19" :component="Bell" />
                </n-badge>
            </button>
        </div>
    </header>
</template>

<style scoped>
.mobile-topbar {
    display: none;
}

@media (max-width: 768px) {
    .mobile-topbar {
        position: fixed;
        inset: 0 0 auto 0;
        z-index: 1050;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ui-space-2);
        height: calc(52px + env(safe-area-inset-top, 0px));
        padding: env(safe-area-inset-top, 0px) var(--ui-space-2) 0;
        background: var(--ui-translucent-card-color);
        border-bottom: 1px solid var(--ui-border-color);
        backdrop-filter: blur(12px);
        box-sizing: border-box;
    }

    .topbar-left,
    .topbar-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
    }

    .topbar-brand {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        min-width: 0;
        padding: var(--ui-space-1) 6px;
        border-radius: var(--ui-button-radius);
        color: inherit;
        text-decoration: none;
    }

    .topbar-logo {
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
        color: var(--ui-icon-color);
        font-size: 24px;
    }

    .topbar-title {
        color: var(--ui-card-title-color);
        font-family: var(--ui-font-family-display);
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .topbar-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
        padding: 0;
        border: 0;
        border-radius: var(--ui-button-radius);
        background: transparent;
        color: var(--ui-text-color);
        text-decoration: none;
        cursor: pointer;
        transition:
            background-color var(--ui-motion-fast) var(--ui-motion-ease),
            color var(--ui-motion-fast) var(--ui-motion-ease);
    }

    .topbar-icon-btn:active {
        background: var(--ui-panel-color);
    }

    .topbar-icon-btn.is-active {
        color: var(--ui-primary-color);
        background: var(--ui-panel-color);
    }

    .topbar-icon-btn:focus-visible,
    .topbar-brand-link:focus-visible {
        outline: 2px solid var(--ui-primary-color);
        outline-offset: -2px;
    }
}
</style>
