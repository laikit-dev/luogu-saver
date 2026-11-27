<template>
    <n-config-provider
        :theme="naiveTheme"
        :locale="zhCN"
        :date-locale="dateZhCN"
        :theme-overrides="themeOverrides"
    >
        <n-message-provider :theme-overrides="themeOverrides.Message">
            <n-dialog-provider :theme-overrides="themeOverrides.Dialog">
                <n-layout
                    class="app-shell"
                    :class="{ 'is-mobile-shell': isMobile }"
                    :style="shellStyle"
                    :data-ui-code-theme="uiThemeVars.codeTheme"
                >
                    <div
                        class="route-progress-bar"
                        :class="{
                            'is-visible': routeProgressVisible,
                            'is-finishing': routeProgressFinishing
                        }"
                        :style="{ transform: `scaleX(${routeProgress})` }"
                        aria-hidden="true"
                    />
                    <aside
                        v-if="!isMobile"
                        class="desktop-sider"
                        :class="{
                            'is-collapsed': effectiveDesktopCollapsed,
                            'is-overlay': isDesktopOverlayOpen
                        }"
                        aria-label="站点侧边栏"
                    >
                        <AppSidebarContent
                            mode="desktop"
                            :collapsed="effectiveDesktopCollapsed"
                            :active-key="activeKey"
                            :unread-notification-count="unreadNotificationCount"
                            :can-show-admin="canShowAdminMenu"
                            :sidebar-logo-nav-enabled="sidebarLogoNavEnabled"
                            @toggle-collapse="handleDesktopToggle"
                            @open-theme="openThemeEditor"
                            @open-notifications="openNotifications"
                            @open-paintboard-dialog="openPaintboardDialog"
                            @navigate="handleDesktopNavigate"
                        />
                    </aside>

                    <Transition name="sider-backdrop">
                        <button
                            v-if="isDesktopOverlayOpen"
                            type="button"
                            class="sider-overlay-backdrop"
                            aria-label="收起侧边栏"
                            @click="overlayExpanded = false"
                        ></button>
                    </Transition>

                    <template v-if="isMobile">
                        <MobileTopBar
                            :active-key="activeKey"
                            :drawer-open="mobileDrawerOpen"
                            :unread-notification-count="unreadNotificationCount"
                            :sidebar-logo-nav-enabled="sidebarLogoNavEnabled"
                            @open-drawer="mobileDrawerOpen = true"
                            @open-notifications="openNotifications"
                        />

                        <n-drawer
                            v-model:show="mobileDrawerOpen"
                            placement="left"
                            width="min(84vw, 280px)"
                            :auto-focus="true"
                            class="mobile-nav-drawer"
                        >
                            <AppSidebarContent
                                mode="mobile"
                                :collapsed="false"
                                :active-key="activeKey"
                                :unread-notification-count="unreadNotificationCount"
                                :can-show-admin="canShowAdminMenu"
                                :sidebar-logo-nav-enabled="sidebarLogoNavEnabled"
                                @close-mobile="mobileDrawerOpen = false"
                                @open-theme="openThemeEditor"
                                @open-notifications="openNotifications"
                                @open-paintboard-dialog="openPaintboardDialog"
                                @navigate="mobileDrawerOpen = false"
                            />
                        </n-drawer>
                    </template>

                    <n-layout class="app-main" :native-scrollbar="false">
                        <n-layout-content
                            content-class="page-scroll-container"
                            content-style="padding: var(--ui-page-padding);"
                        >
                            <div class="router-view">
                                <SiteNotificationCenter />
                                <UserNotificationCenter
                                    ref="notificationCenterRef"
                                    @update:unread-count="unreadNotificationCount = $event"
                                />
                                <n-back-top
                                    class="app-floating-control back-top-action"
                                    aria-label="返回顶部"
                                    :listen-to="getPageScrollElement"
                                    @click.capture="handleBackTopClick"
                                />
                                <router-view :key="routeViewKey" class="route-page" />
                            </div>
                            <n-layout-footer bordered class="app-footer">
                                <n-grid class="footer-grid" cols="1 s:2" responsive="screen">
                                    <n-gi>
                                        <p class="footer-element">
                                            <a
                                                href="https://github.com/laikit-dev/luogu-saver"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="footer-link"
                                            >
                                                <Github :size="14" />
                                                <span> GitHub </span>
                                            </a>
                                            <a
                                                href="https://laikit.dev"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="footer-link"
                                            >
                                                <BookOpen :size="14" />
                                                <span> 帮助文档 </span>
                                            </a>
                                            <a
                                                href="https://github.com/laikit-dev/luogu-saver/graphs/contributors"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="footer-link"
                                            >
                                                <Users :size="14" />
                                                <span> 项目贡献者 </span>
                                            </a>
                                        </p>
                                    </n-gi>
                                    <n-gi>
                                        <p class="footer-element right-aligned">
                                            <a
                                                href="https://qm.qq.com/q/QVM9YFEb26"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="footer-link"
                                            >
                                                <MessagesSquare :size="14" />
                                                <span
                                                    >洛谷保存站用户群：1017248143（点击加入）</span
                                                >
                                            </a>
                                        </p>
                                    </n-gi>
                                    <n-gi>
                                        <p class="footer-element">
                                            <Clock3 :size="14" />
                                            <SiteUptime />
                                        </p>
                                    </n-gi>
                                    <n-gi>
                                        <p class="footer-element right-aligned">
                                            <a
                                                href="https://www.rainyun.com/federico_?s=saver"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="footer-link"
                                            >
                                                <Server :size="14" />
                                                <span>本站由雨云提供支持</span>
                                            </a>
                                        </p>
                                    </n-gi>
                                    <n-gi class="footer-copyright">
                                        <p class="footer-element">
                                            <Copyright :size="14" />
                                            <span> 2025-2026 洛谷保存站 </span>
                                        </p>
                                    </n-gi>
                                    <n-gi class="footer-legal">
                                        <p class="footer-element right-aligned">
                                            <router-link to="/privacy" class="footer-link">
                                                <ShieldUser :size="14" />
                                                <span>隐私协议</span>
                                            </router-link>
                                            <router-link to="/disclaimer" class="footer-link">
                                                <CircleAlert :size="14" />
                                                <span>免责声明</span>
                                            </router-link>
                                            <router-link to="/deletion" class="footer-link">
                                                <Trash2 :size="14" />
                                                <span>数据移除政策</span>
                                            </router-link>
                                        </p>
                                    </n-gi>
                                </n-grid>
                            </n-layout-footer>
                        </n-layout-content>
                    </n-layout>

                    <ThemeEditor v-if="themeEditorMounted" v-model:show="themeEditorOpen" />
                    <StarPrompt :blocked="trackingConsentBlocking" />
                    <TrackingConsent @update:blocking="trackingConsentBlocking = $event" />
                </n-layout>
            </n-dialog-provider>
        </n-message-provider>
    </n-config-provider>
</template>

<script setup lang="ts">
import {
    computed,
    defineAsyncComponent,
    h,
    nextTick,
    onBeforeUnmount,
    provide,
    ref,
    watch
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReducedMotion } from '@/composables/useReducedMotion';
import {
    createDiscreteApi,
    darkTheme,
    dateZhCN,
    NBackTop,
    NConfigProvider,
    NDialogProvider,
    NDrawer,
    NGi,
    NGrid,
    NLayout,
    NLayoutContent,
    NLayoutFooter,
    NMessageProvider,
    zhCN,
    type GlobalThemeOverrides
} from 'naive-ui';

import {
    BookOpen,
    CircleAlert,
    Clock3,
    Copyright,
    Github,
    MessagesSquare,
    Server,
    ShieldUser,
    Trash2,
    Users
} from 'lucide-vue-next';

import {
    uiThemeKey,
    uiThemeModeKey,
    uiThemePresetKey,
    type UiThemeMode,
    type UiThemePresetName,
    type UiThemeVars
} from '@/styles/theme/themeKeys.ts';
import {
    resolveEffectiveColorScheme,
    resolvePresetThemeVars,
    resolveStoredThemeSelection,
    shouldClearLegacyThemeOverrides
} from '@/styles/theme/presets.ts';
import { PAINTBOARD_ANNOUNCEMENT_URL } from '@/config/navigation.ts';
import AppSidebarContent from '@/components/AppSidebarContent.vue';
import MobileTopBar from '@/components/MobileTopBar.vue';
import TrackingConsent from '@/components/TrackingConsent.vue';
import StarPrompt from '@/components/StarPrompt.vue';
import SiteNotificationCenter from '@/components/SiteNotificationCenter.vue';
import UserNotificationCenter from '@/components/UserNotificationCenter.vue';
import SiteUptime from '@/components/SiteUptime.vue';
import { authToken, currentRole } from '@/utils/auth.ts';
import { hasRole, UserRole } from '@/utils/permissions.ts';
import { ensureCurrentAuth } from '@/api/auth.ts';
import {
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    SIDEBAR_LOGO_NAV_STORAGE_KEY,
    THEME_MODE_STORAGE_KEY,
    THEME_PRESET_STORAGE_KEY,
    THEME_STORAGE_KEY
} from '@/utils/constants.ts';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';

const ThemeEditor = defineAsyncComponent(() => import('@/components/ThemeEditor.vue'));
const router = useRouter();
const route = useRoute();

// These views read their route id once during setup, so a new id needs a fresh instance.
const ID_KEYED_ROUTES = ['article-detail', 'paste-detail', 'workflow-tracker'];
const routeViewKey = computed(() =>
    ID_KEYED_ROUTES.includes(String(route.name))
        ? `${String(route.name)}:${String(route.params.id)}`
        : undefined
);

const activeKey = computed(() =>
    typeof route.meta.activeMenu === 'string'
        ? route.meta.activeMenu
        : (route.path as string).slice(1)
);

const mobileMedia = window.matchMedia('(max-width: 768px)');
const wideDesktopMedia = window.matchMedia('(min-width: 1280px)');
const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const isMobile = ref(mobileMedia.matches);
const isWideDesktop = ref(wideDesktopMedia.matches);
const systemPrefersDark = ref(colorSchemeMedia.matches);
const sidebarCollapsedStorage = useLocalStorage<boolean>(SIDEBAR_COLLAPSED_STORAGE_KEY, false);
const sidebarCollapsed = computed({
    get: () => sidebarCollapsedStorage.value ?? false,
    set: value => {
        sidebarCollapsedStorage.value = value;
    }
});
const overlayExpanded = ref(false);
const mobileDrawerOpen = ref(false);
const themeEditorMounted = ref(false);
const themeEditorOpen = ref(false);
const unreadNotificationCount = ref(0);
const notificationCenterRef = ref<InstanceType<typeof UserNotificationCenter> | null>(null);

const reducedMotion = useReducedMotion();
const routeProgress = ref(0);
const routeProgressVisible = ref(false);
const routeProgressFinishing = ref(false);
let routeProgressDelayTimer: number | null = null;
let routeProgressTrickleTimer: number | null = null;
let routeProgressHideTimer: number | null = null;

const clearRouteProgressTimers = () => {
    if (routeProgressDelayTimer !== null) {
        window.clearTimeout(routeProgressDelayTimer);
        routeProgressDelayTimer = null;
    }
    if (routeProgressTrickleTimer !== null) {
        window.clearInterval(routeProgressTrickleTimer);
        routeProgressTrickleTimer = null;
    }
    if (routeProgressHideTimer !== null) {
        window.clearTimeout(routeProgressHideTimer);
        routeProgressHideTimer = null;
    }
};

const startRouteProgress = () => {
    clearRouteProgressTimers();
    routeProgressFinishing.value = false;
    routeProgress.value = 0;
    // Delay showing so instant route transitions never flash a progress bar.
    routeProgressDelayTimer = window.setTimeout(() => {
        routeProgressDelayTimer = null;
        routeProgressVisible.value = true;
        routeProgress.value = 0.24;
        routeProgressTrickleTimer = window.setInterval(() => {
            if (routeProgress.value < 0.86) {
                routeProgress.value = Math.min(
                    0.86,
                    routeProgress.value + (0.86 - routeProgress.value) * 0.22
                );
            }
        }, 160);
    }, 120);
};

const finishRouteProgress = () => {
    if (routeProgressDelayTimer !== null) {
        clearRouteProgressTimers();
        routeProgressVisible.value = false;
        routeProgress.value = 0;
        return;
    }
    if (!routeProgressVisible.value) return;
    if (routeProgressTrickleTimer !== null) {
        window.clearInterval(routeProgressTrickleTimer);
        routeProgressTrickleTimer = null;
    }
    routeProgressFinishing.value = true;
    routeProgress.value = 1;
    routeProgressHideTimer = window.setTimeout(
        () => {
            routeProgressHideTimer = null;
            routeProgressVisible.value = false;
            routeProgressFinishing.value = false;
            routeProgress.value = 0;
        },
        reducedMotion.value ? 0 : 200
    );
};

const removeBeforeEachGuard = router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) startRouteProgress();
});
const removeAfterEachGuard = router.afterEach(() => {
    finishRouteProgress();
});
const removeErrorHandler = router.onError(() => {
    finishRouteProgress();
});
onBeforeUnmount(() => {
    clearRouteProgressTimers();
    removeBeforeEachGuard();
    removeAfterEachGuard();
    removeErrorHandler();
});
const trackingConsentBlocking = ref(true);
const sidebarLogoNavEnabledStorage = useLocalStorage<boolean>(SIDEBAR_LOGO_NAV_STORAGE_KEY, true);
const sidebarLogoNavEnabled = computed(() => sidebarLogoNavEnabledStorage.value ?? true);
provide('sidebarLogoNavEnabled', sidebarLogoNavEnabledStorage);

const isDesktopOverlayOpen = computed(
    () => !isMobile.value && !isWideDesktop.value && overlayExpanded.value
);
const effectiveDesktopCollapsed = computed(() =>
    isWideDesktop.value ? sidebarCollapsed.value : !overlayExpanded.value
);
const desktopReservedWidth = computed(() => {
    if (isMobile.value) return '0px';
    if (isWideDesktop.value) return sidebarCollapsed.value ? '64px' : '220px';
    return '64px';
});

const handleMediaChange = () => {
    const nextMobile = mobileMedia.matches;
    const nextWideDesktop = wideDesktopMedia.matches;
    isMobile.value = nextMobile;
    isWideDesktop.value = nextWideDesktop;
    if (nextMobile) {
        overlayExpanded.value = false;
    } else {
        mobileDrawerOpen.value = false;
    }
    if (nextWideDesktop) {
        overlayExpanded.value = false;
    }
};
const handleColorSchemeChange = (event: MediaQueryListEvent) => {
    systemPrefersDark.value = event.matches;
};

let lastPointerPoint: { x: number; y: number; time: number } | null = null;
const handlePointerDown = (event: PointerEvent) => {
    lastPointerPoint = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now()
    };
};

mobileMedia.addEventListener('change', handleMediaChange);
wideDesktopMedia.addEventListener('change', handleMediaChange);
colorSchemeMedia.addEventListener('change', handleColorSchemeChange);
window.addEventListener('pointerdown', handlePointerDown, { passive: true });
onBeforeUnmount(() => {
    mobileMedia.removeEventListener('change', handleMediaChange);
    wideDesktopMedia.removeEventListener('change', handleMediaChange);
    colorSchemeMedia.removeEventListener('change', handleColorSchemeChange);
    window.removeEventListener('pointerdown', handlePointerDown);
});

watch(
    () => route.fullPath,
    () => {
        mobileDrawerOpen.value = false;
        overlayExpanded.value = false;
    }
);

const handleDesktopToggle = () => {
    if (isMobile.value) return;
    if (isWideDesktop.value) {
        sidebarCollapsed.value = !sidebarCollapsed.value;
    } else {
        overlayExpanded.value = !overlayExpanded.value;
    }
};

const handleDesktopNavigate = () => {
    if (overlayExpanded.value) overlayExpanded.value = false;
};

const openThemeEditor = () => {
    themeEditorMounted.value = true;
    themeEditorOpen.value = true;
};

const openNotifications = () => {
    notificationCenterRef.value?.openDrawer();
};

const getPageScrollElement = () =>
    document.querySelector<HTMLElement>('.page-scroll-container') ?? document.documentElement;
const handleBackTopClick = (event: MouseEvent) => {
    if (!reducedMotion.value) return;
    // BackTop hardcodes smooth scrolling, so capture reduced-motion clicks before its handler.
    event.stopImmediatePropagation();
    getPageScrollElement().scrollTo({ top: 0, behavior: 'instant' });
};

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target.closest('.cm-editor')) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const focusOrNavigateSearch = () => {
    const existingInput = document.querySelector<HTMLInputElement>(
        '.search-stage input, .search-bar input, .search-input input, input[type="search"]'
    );
    if (existingInput && existingInput.offsetParent !== null) {
        existingInput.focus();
        existingInput.select();
        return;
    }
    void router.push('/search');
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
        if (mobileDrawerOpen.value) mobileDrawerOpen.value = false;
        if (overlayExpanded.value) overlayExpanded.value = false;
        return;
    }

    if (isEditableTarget(event.target)) return;

    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        if (!isMobile.value) {
            event.preventDefault();
            handleDesktopToggle();
        }
        return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === '[' && !isMobile.value) {
        event.preventDefault();
        handleDesktopToggle();
    } else if (event.key === '/') {
        event.preventDefault();
        focusOrNavigateSearch();
    }
};
window.addEventListener('keydown', handleGlobalKeydown);
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));

const canShowAdminMenu = computed(() => hasRole(currentRole.value, UserRole.MODERATOR));
const resolveThemeBase = (presetName: UiThemePresetName, mode: UiThemeMode): UiThemeVars =>
    resolvePresetThemeVars(presetName, mode, systemPrefersDark.value);

const applyUserOverrides = (base: UiThemeVars, stored: Partial<UiThemeVars> | null): UiThemeVars =>
    stored ? { ...base, ...stored } : base;

const themePresetStorage = useLocalStorage<string>(THEME_PRESET_STORAGE_KEY, 'default');
const themeModeStorage = useLocalStorage<string | null>(THEME_MODE_STORAGE_KEY, null);
const themeStorage = useLocalStorage<Partial<UiThemeVars> | null>(THEME_STORAGE_KEY, null);

const hadStoredThemeMode = themeModeStorage.value !== null;
const initialThemeSelection = resolveStoredThemeSelection(
    themePresetStorage.value,
    themeModeStorage.value
);
if (
    shouldClearLegacyThemeOverrides(
        themePresetStorage.value,
        hadStoredThemeMode,
        resolveEffectiveColorScheme(initialThemeSelection.mode, systemPrefersDark.value)
    )
) {
    themeStorage.value = null;
}
if (themePresetStorage.value !== initialThemeSelection.preset) {
    themePresetStorage.value = initialThemeSelection.preset;
}
if (themeModeStorage.value !== initialThemeSelection.mode) {
    themeModeStorage.value = initialThemeSelection.mode;
}
const uiThemePreset = ref<UiThemePresetName>(initialThemeSelection.preset);
const uiThemeMode = ref<UiThemeMode>(initialThemeSelection.mode);
const effectiveColorScheme = computed(() =>
    resolveEffectiveColorScheme(uiThemeMode.value, systemPrefersDark.value)
);
const uiThemeVars = ref<UiThemeVars>(
    applyUserOverrides(resolveThemeBase(uiThemePreset.value, uiThemeMode.value), themeStorage.value)
);
const isDarkTheme = computed(() => effectiveColorScheme.value === 'dark');
const naiveTheme = computed(() => (isDarkTheme.value ? darkTheme : null));
provide(uiThemeKey, uiThemeVars);
provide(uiThemeModeKey, uiThemeMode);
provide(uiThemePresetKey, uiThemePreset);
watch(authToken, () => void ensureCurrentAuth(), { immediate: true });

let themePersistTimer: number | null = null;

const persistThemeDiff = (newVal: UiThemeVars) => {
    const base = resolveThemeBase(uiThemePreset.value, uiThemeMode.value);
    const diffs: Record<string, unknown> = {};
    for (const key of Object.keys(newVal) as Array<keyof UiThemeVars>) {
        if (newVal[key] !== base[key]) {
            diffs[key] = newVal[key];
        }
    }
    const keys = Object.keys(diffs);
    if (keys.length === 0) {
        themeStorage.value = null;
    } else {
        themeStorage.value = diffs as Partial<UiThemeVars>;
    }
};

watch(
    uiThemeVars,
    newVal => {
        if (themePersistTimer !== null) {
            window.clearTimeout(themePersistTimer);
        }
        // Defer diff + localStorage serialization off the theme-transition snapshot frame.
        themePersistTimer = window.setTimeout(() => {
            themePersistTimer = null;
            persistThemeDiff(newVal);
        }, 120);
    },
    { deep: true }
);

onBeforeUnmount(() => {
    if (themePersistTimer !== null) {
        window.clearTimeout(themePersistTimer);
        themePersistTimer = null;
    }
});

interface ViewTransitionHandle {
    ready?: Promise<void>;
    finished?: Promise<void>;
}

const prefersLightweightThemeTransition = () =>
    window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;

const applyThemeWithTransition = (update: () => void) => {
    const startViewTransition = (
        document as Document & {
            startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionHandle;
        }
    ).startViewTransition;

    if (
        typeof startViewTransition !== 'function' ||
        reducedMotion.value ||
        document.visibilityState !== 'visible'
    ) {
        update();
        return;
    }

    const root = document.documentElement;
    const lightweight = prefersLightweightThemeTransition();
    const now = performance.now();
    const x =
        lastPointerPoint && now - lastPointerPoint.time <= 1200
            ? lastPointerPoint.x
            : window.innerWidth / 2;
    const y = lastPointerPoint && now - lastPointerPoint.time <= 1200 ? lastPointerPoint.y : 0;
    const endRadius = lightweight
        ? 0
        : Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    try {
        root.classList.add('is-theme-transitioning');
        const transition = startViewTransition.call(document, async () => {
            update();
            await nextTick();
        });
        if (transition?.ready) {
            void transition.ready
                .then(() => {
                    if (lightweight) {
                        // Coarse/mobile GPUs rasterize full-screen clip-path masks poorly; use compositor opacity instead.
                        root.animate(
                            { opacity: [0, 1] },
                            {
                                duration: 200,
                                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                                pseudoElement: '::view-transition-new(root)'
                            }
                        );
                        return;
                    }
                    root.animate(
                        {
                            clipPath: [
                                `circle(0px at ${x}px ${y}px)`,
                                `circle(${endRadius}px at ${x}px ${y}px)`
                            ]
                        },
                        {
                            duration: 320,
                            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                            pseudoElement: '::view-transition-new(root)'
                        }
                    );
                })
                .catch(() => {});
        }
        if (transition?.finished) {
            void transition.finished.finally(() => {
                root.classList.remove('is-theme-transitioning');
            });
        } else {
            root.classList.remove('is-theme-transitioning');
        }
    } catch {
        root.classList.remove('is-theme-transitioning');
        update();
    }
};

watch(uiThemePreset, newPreset => {
    applyThemeWithTransition(() => {
        themePresetStorage.value = newPreset;
        themeStorage.value = null;
        uiThemeVars.value = resolveThemeBase(newPreset, uiThemeMode.value);
    });
});

watch(uiThemeMode, newMode => {
    applyThemeWithTransition(() => {
        themeModeStorage.value = newMode;
        themeStorage.value = null;
        uiThemeVars.value = resolveThemeBase(uiThemePreset.value, newMode);
    });
});

watch(systemPrefersDark, () => {
    if (uiThemeMode.value !== 'auto') return;
    applyThemeWithTransition(() => {
        themeStorage.value = null;
        uiThemeVars.value = resolveThemeBase(uiThemePreset.value, 'auto');
    });
});

const mixThemeColor = (color: string, colorRatio: number, base: string) => {
    return `color-mix(in srgb, ${color} ${colorRatio}%, ${base})`;
};

const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const vars = uiThemeVars.value;

    return {
        common: {
            fontFamily: 'var(--ui-font-family)',
            fontFamilyMono: 'var(--ui-font-family-mono)',
            borderRadius: vars.cardRadius,
            bodyColor: vars.bodyColor,
            primaryColor: vars.primaryColor,
            primaryColorHover: vars.primaryColorHover,
            primaryColorPressed: vars.primaryColorPressed,
            primaryColorSuppl: vars.primaryColorSuppl,
            infoColor: vars.infoColor,
            infoColorHover: mixThemeColor(vars.infoColor, 82, vars.cardColor),
            infoColorPressed: mixThemeColor(vars.infoColor, 82, '#000000'),
            infoColorSuppl: mixThemeColor(vars.infoColor, 35, vars.cardColor),
            successColor: vars.successColor,
            successColorHover: mixThemeColor(vars.successColor, 82, vars.cardColor),
            successColorPressed: mixThemeColor(vars.successColor, 82, '#000000'),
            successColorSuppl: mixThemeColor(vars.successColor, 35, vars.cardColor),
            warningColor: vars.warningColor,
            warningColorHover: mixThemeColor(vars.warningColor, 82, vars.cardColor),
            warningColorPressed: mixThemeColor(vars.warningColor, 82, '#000000'),
            warningColorSuppl: mixThemeColor(vars.warningColor, 35, vars.cardColor),
            errorColor: vars.errorColor,
            errorColorHover: mixThemeColor(vars.errorColor, 82, vars.cardColor),
            errorColorPressed: mixThemeColor(vars.errorColor, 82, '#000000'),
            errorColorSuppl: mixThemeColor(vars.errorColor, 35, vars.cardColor),
            cardColor: vars.cardColor,
            popoverColor: vars.cardColor,
            modalColor: vars.cardColor,
            textColor1: vars.textColor,
            textColor2: vars.secondaryTextColor,
            textColor3: vars.mutedTextColor,
            placeholderColor: vars.controlPlaceholderColor,
            dividerColor: vars.borderColor,
            borderColor: vars.controlBorderColor
        },
        Layout: {
            color: uiThemeVars.value.bodyColor,
            siderColor: uiThemeVars.value.cardColor
        },
        Menu: {
            itemTextColorActive: uiThemeVars.value.primaryColor,
            itemIconColorActive: uiThemeVars.value.primaryColor,
            itemColorActive: uiThemeVars.value.panelColor,
            itemColorActiveHover: uiThemeVars.value.panelColor,
            itemColorHover: uiThemeVars.value.panelColor,
            borderRadius: uiThemeVars.value.cardRadius
        },
        Input: {
            color: uiThemeVars.value.controlColor,
            colorFocus: uiThemeVars.value.controlColorFocus,
            colorDisabled: uiThemeVars.value.controlColorDisabled,
            textColor: uiThemeVars.value.controlTextColor,
            textColorDisabled: uiThemeVars.value.mutedTextColor,
            placeholderColor: uiThemeVars.value.controlPlaceholderColor,
            placeholderColorDisabled: uiThemeVars.value.mutedTextColor,
            border: `1px solid ${uiThemeVars.value.controlBorderColor}`,
            borderHover: `1px solid ${uiThemeVars.value.controlBorderHoverColor}`,
            borderFocus: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            borderDisabled: `1px solid ${uiThemeVars.value.borderColor}`,
            boxShadowFocus: uiThemeVars.value.focusRingShadow,
            caretColor: uiThemeVars.value.primaryColor,
            iconColor: uiThemeVars.value.iconColor,
            iconColorHover: uiThemeVars.value.primaryColorHover,
            iconColorPressed: uiThemeVars.value.primaryColorPressed,
            suffixTextColor: uiThemeVars.value.secondaryTextColor
        },
        InternalSelection: {
            color: uiThemeVars.value.controlColor,
            colorActive: uiThemeVars.value.controlColorFocus,
            colorDisabled: uiThemeVars.value.controlColorDisabled,
            textColor: uiThemeVars.value.controlTextColor,
            textColorDisabled: uiThemeVars.value.mutedTextColor,
            placeholderColor: uiThemeVars.value.controlPlaceholderColor,
            placeholderColorDisabled: uiThemeVars.value.mutedTextColor,
            border: `1px solid ${uiThemeVars.value.controlBorderColor}`,
            borderHover: `1px solid ${uiThemeVars.value.controlBorderHoverColor}`,
            borderActive: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            borderFocus: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            boxShadowHover: 'none',
            boxShadowActive: uiThemeVars.value.focusRingShadow,
            boxShadowFocus: uiThemeVars.value.focusRingShadow,
            caretColor: uiThemeVars.value.primaryColor,
            arrowColor: uiThemeVars.value.iconColor,
            clearColor: uiThemeVars.value.mutedTextColor,
            clearColorHover: uiThemeVars.value.secondaryTextColor,
            clearColorPressed: uiThemeVars.value.primaryColorPressed,
            peers: {
                Popover: {
                    color: uiThemeVars.value.cardColor,
                    textColor: uiThemeVars.value.textColor,
                    dividerColor: uiThemeVars.value.borderColor,
                    boxShadow: uiThemeVars.value.elevatedShadow
                }
            }
        },
        Select: {
            menuBoxShadow: uiThemeVars.value.elevatedShadow,
            peers: {
                InternalSelection: {
                    color: uiThemeVars.value.controlColor,
                    colorActive: uiThemeVars.value.controlColorFocus,
                    textColor: uiThemeVars.value.controlTextColor,
                    placeholderColor: uiThemeVars.value.controlPlaceholderColor,
                    border: `1px solid ${uiThemeVars.value.controlBorderColor}`,
                    borderHover: `1px solid ${uiThemeVars.value.controlBorderHoverColor}`,
                    borderActive: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
                    borderFocus: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
                    boxShadowActive: uiThemeVars.value.focusRingShadow,
                    boxShadowFocus: uiThemeVars.value.focusRingShadow,
                    arrowColor: uiThemeVars.value.iconColor
                },
                InternalSelectMenu: {
                    color: uiThemeVars.value.cardColor,
                    optionTextColor: uiThemeVars.value.textColor,
                    optionTextColorActive: uiThemeVars.value.primaryColor,
                    optionColorPending: uiThemeVars.value.panelColor,
                    optionColorActive: uiThemeVars.value.panelColor,
                    optionColorActivePending: uiThemeVars.value.panelColor,
                    actionDividerColor: uiThemeVars.value.borderColor
                }
            }
        },
        Tag: {
            borderRadius: 'var(--ui-tag-radius)',
            closeBorderRadius: 'var(--ui-tag-radius)',
            border: `1px solid ${vars.borderColor}`,
            color: vars.controlTagColor,
            colorBordered: vars.controlTagColor,
            textColor: vars.controlTagTextColor,
            closeIconColor: vars.iconColor,
            closeIconColorHover: vars.primaryColorHover,
            closeIconColorPressed: vars.primaryColorPressed,
            borderPrimary: `1px solid ${mixThemeColor(vars.primaryColor, 34, 'transparent')}`,
            textColorPrimary: vars.primaryColor,
            colorPrimary: vars.panelColor,
            borderInfo: `1px solid ${mixThemeColor(vars.infoColor, 34, 'transparent')}`,
            textColorInfo: vars.infoColor,
            colorInfo: vars.alertInfoBackgroundColor,
            borderSuccess: `1px solid ${mixThemeColor(vars.successColor, 34, 'transparent')}`,
            textColorSuccess: vars.successColor,
            colorSuccess: vars.alertSuccessBackgroundColor,
            borderWarning: `1px solid ${mixThemeColor(vars.warningColor, 36, 'transparent')}`,
            textColorWarning: vars.warningColor,
            colorWarning: vars.alertWarningBackgroundColor,
            borderError: `1px solid ${mixThemeColor(vars.errorColor, 34, 'transparent')}`,
            textColorError: vars.errorColor,
            colorError: vars.alertErrorBackgroundColor
        },
        Button: {
            borderRadiusTiny: 'var(--ui-button-radius)',
            borderRadiusSmall: 'var(--ui-button-radius)',
            borderRadiusMedium: 'var(--ui-button-radius)',
            borderRadiusLarge: 'var(--ui-button-radius)',
            color: uiThemeVars.value.controlColor,
            colorHover: uiThemeVars.value.controlColorFocus,
            colorPressed: uiThemeVars.value.panelColor,
            colorFocus: uiThemeVars.value.controlColorFocus,
            colorDisabled: uiThemeVars.value.controlColorDisabled,
            textColor: uiThemeVars.value.controlTextColor,
            textColorHover: uiThemeVars.value.primaryColorHover,
            textColorPressed: uiThemeVars.value.primaryColorPressed,
            textColorFocus: uiThemeVars.value.primaryColor,
            textColorDisabled: uiThemeVars.value.mutedTextColor,
            border: `1px solid ${uiThemeVars.value.controlBorderColor}`,
            borderHover: `1px solid ${uiThemeVars.value.controlBorderHoverColor}`,
            borderPressed: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            borderFocus: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            borderDisabled: `1px solid ${uiThemeVars.value.borderColor}`,
            rippleColor: uiThemeVars.value.primaryColor,
            colorPrimary: uiThemeVars.value.primaryColor,
            colorHoverPrimary: uiThemeVars.value.primaryColorHover,
            colorPressedPrimary: uiThemeVars.value.primaryColorPressed,
            colorFocusPrimary: uiThemeVars.value.primaryColorHover,
            textColorPrimary: '#ffffff',
            textColorHoverPrimary: '#ffffff',
            textColorPressedPrimary: '#ffffff',
            textColorFocusPrimary: '#ffffff',
            borderPrimary: `1px solid ${uiThemeVars.value.primaryColor}`,
            borderHoverPrimary: `1px solid ${uiThemeVars.value.primaryColorHover}`,
            borderPressedPrimary: `1px solid ${uiThemeVars.value.primaryColorPressed}`,
            borderFocusPrimary: `1px solid ${uiThemeVars.value.primaryColorHover}`
        },
        BackTop: {
            color: uiThemeVars.value.backTopColor,
            textColor: uiThemeVars.value.backTopIconColor,
            iconColor: uiThemeVars.value.backTopIconColor,
            iconColorHover: uiThemeVars.value.backTopIconHoverColor,
            iconColorPressed: uiThemeVars.value.primaryColorPressed,
            boxShadow: uiThemeVars.value.elevatedShadow,
            boxShadowHover: uiThemeVars.value.elevatedShadow,
            boxShadowPressed: uiThemeVars.value.elevatedShadow,
            borderRadius: uiThemeVars.value.pillRadius
        },
        Alert: {
            color: vars.panelColor,
            colorInfo: vars.alertInfoBackgroundColor,
            colorSuccess: vars.alertSuccessBackgroundColor,
            colorWarning: vars.alertWarningBackgroundColor,
            colorError: vars.alertErrorBackgroundColor,
            border: `1px solid ${uiThemeVars.value.borderColor}`,
            borderInfo: `1px solid ${uiThemeVars.value.infoColor}`,
            borderSuccess: `1px solid ${uiThemeVars.value.successColor}`,
            borderWarning: `1px solid ${uiThemeVars.value.warningColor}`,
            borderError: `1px solid ${uiThemeVars.value.errorColor}`,
            titleTextColor: uiThemeVars.value.cardTitleColor,
            contentTextColor: uiThemeVars.value.textColor,
            iconColor: uiThemeVars.value.primaryColor,
            iconColorInfo: uiThemeVars.value.infoColor,
            iconColorSuccess: uiThemeVars.value.successColor,
            iconColorWarning: uiThemeVars.value.warningColor,
            iconColorError: uiThemeVars.value.errorColor
        },
        Dialog: {
            color: uiThemeVars.value.cardColor,
            textColor: uiThemeVars.value.textColor,
            titleTextColor: uiThemeVars.value.cardTitleColor,
            iconColor: uiThemeVars.value.primaryColor,
            iconColorInfo: uiThemeVars.value.infoColor,
            iconColorSuccess: uiThemeVars.value.successColor,
            iconColorWarning: uiThemeVars.value.warningColor,
            iconColorError: uiThemeVars.value.errorColor,
            closeIconColor: uiThemeVars.value.iconColor,
            closeIconColorHover: uiThemeVars.value.primaryColorHover,
            closeIconColorPressed: uiThemeVars.value.primaryColorPressed,
            boxShadow: uiThemeVars.value.elevatedShadow,
            borderRadius: uiThemeVars.value.cardRadius
        },
        Pagination: {
            itemColor: uiThemeVars.value.controlColor,
            itemColorHover: uiThemeVars.value.controlColorFocus,
            itemColorPressed: uiThemeVars.value.panelColor,
            itemColorActive: uiThemeVars.value.primaryColor,
            itemColorActiveHover: uiThemeVars.value.primaryColorHover,
            itemColorDisabled: uiThemeVars.value.controlColorDisabled,
            itemTextColor: uiThemeVars.value.controlTextColor,
            itemTextColorHover: uiThemeVars.value.primaryColorHover,
            itemTextColorPressed: uiThemeVars.value.primaryColorPressed,
            itemTextColorActive: '#ffffff',
            itemTextColorDisabled: uiThemeVars.value.mutedTextColor,
            itemBorder: `1px solid ${uiThemeVars.value.controlBorderColor}`,
            itemBorderHover: `1px solid ${uiThemeVars.value.controlBorderHoverColor}`,
            itemBorderPressed: `1px solid ${uiThemeVars.value.controlBorderFocusColor}`,
            itemBorderActive: `1px solid ${uiThemeVars.value.primaryColor}`,
            itemBorderDisabled: `1px solid ${uiThemeVars.value.borderColor}`,
            buttonColorHover: uiThemeVars.value.controlColorFocus,
            buttonColorPressed: uiThemeVars.value.panelColor,
            buttonColorDisabled: uiThemeVars.value.controlColorDisabled,
            buttonIconColor: uiThemeVars.value.iconColor,
            buttonIconColorHover: uiThemeVars.value.primaryColorHover,
            buttonIconColorPressed: uiThemeVars.value.primaryColorPressed,
            buttonIconColorDisabled: uiThemeVars.value.mutedTextColor
        },
        Slider: {
            railColor: uiThemeVars.value.sliderRailColor,
            railColorHover: uiThemeVars.value.sliderRailHoverColor,
            fillColor: uiThemeVars.value.sliderFillColor,
            fillColorHover: uiThemeVars.value.sliderFillHoverColor,
            handleColor: uiThemeVars.value.sliderHandleColor,
            handleBoxShadow: `0 0 0 1px ${uiThemeVars.value.controlBorderColor}`,
            handleBoxShadowHover: `0 0 0 1px ${uiThemeVars.value.controlBorderHoverColor}`,
            handleBoxShadowActive: `0 0 0 1px ${uiThemeVars.value.controlBorderFocusColor}`,
            handleBoxShadowFocus: uiThemeVars.value.focusRingShadow,
            dotColor: uiThemeVars.value.controlColor,
            dotColorModal: uiThemeVars.value.controlColor,
            dotColorPopover: uiThemeVars.value.controlColor,
            dotBorder: `1px solid ${uiThemeVars.value.controlBorderColor}`,
            dotBorderActive: `1px solid ${uiThemeVars.value.sliderFillColor}`,
            indicatorColor: uiThemeVars.value.cardColor,
            indicatorTextColor: uiThemeVars.value.textColor,
            indicatorBoxShadow: uiThemeVars.value.elevatedShadow,
            indicatorBorderRadius: uiThemeVars.value.cardRadius
        },
        Message: {
            color: uiThemeVars.value.cardColor,
            colorInfo: uiThemeVars.value.cardColor,
            colorSuccess: uiThemeVars.value.cardColor,
            colorError: uiThemeVars.value.cardColor,
            colorWarning: uiThemeVars.value.cardColor,
            colorLoading: uiThemeVars.value.cardColor,
            textColor: uiThemeVars.value.textColor,
            textColorInfo: uiThemeVars.value.textColor,
            textColorSuccess: uiThemeVars.value.textColor,
            textColorError: uiThemeVars.value.textColor,
            textColorWarning: uiThemeVars.value.textColor,
            textColorLoading: uiThemeVars.value.textColor,
            iconColor: uiThemeVars.value.primaryColor,
            iconColorInfo: uiThemeVars.value.infoColor,
            iconColorSuccess: uiThemeVars.value.successColor,
            iconColorWarning: uiThemeVars.value.warningColor,
            iconColorError: uiThemeVars.value.errorColor,
            iconColorLoading: uiThemeVars.value.primaryColor,
            loadingColor: uiThemeVars.value.primaryColor,
            border: `1px solid ${uiThemeVars.value.borderColor}`,
            boxShadow: uiThemeVars.value.elevatedShadow,
            boxShadowInfo: uiThemeVars.value.elevatedShadow,
            boxShadowSuccess: uiThemeVars.value.elevatedShadow,
            boxShadowError: uiThemeVars.value.elevatedShadow,
            boxShadowWarning: uiThemeVars.value.elevatedShadow,
            boxShadowLoading: uiThemeVars.value.elevatedShadow
        },
        Skeleton: {
            color: uiThemeVars.value.panelColor,
            colorEnd: uiThemeVars.value.controlColorDisabled,
            borderRadius: uiThemeVars.value.cardRadius
        },
        Spin: {
            color: uiThemeVars.value.primaryColor,
            textColor: uiThemeVars.value.textColor
        },
        Space: {
            gapSmall: '8px 8px',
            gapMedium: '12px 12px',
            gapLarge: '16px 16px'
        },
        Statistic: {
            labelTextColor: uiThemeVars.value.secondaryTextColor,
            valueTextColor: uiThemeVars.value.textColor,
            valuePrefixTextColor: uiThemeVars.value.textColor,
            valueSuffixTextColor: uiThemeVars.value.secondaryTextColor
        },
        DataTable: {
            thColor: vars.tableHeaderColor,
            thTextColor: vars.secondaryTextColor,
            tdColor: vars.cardColor,
            tdColorHover: vars.panelColor,
            tdTextColor: vars.textColor,
            borderColor: vars.borderColor
        }
    };
});

const themeCssVars = computed(() => {
    const vars = uiThemeVars.value;
    return {
        '--ui-body-color': vars.bodyColor,
        '--ui-body-gradient-start': vars.bodyGradientStart,
        '--ui-body-gradient-end': vars.bodyGradientEnd,
        '--ui-primary-color': vars.primaryColor,
        '--ui-primary-color-hover': vars.primaryColorHover,
        '--ui-primary-color-pressed': vars.primaryColorPressed,
        '--ui-primary-color-suppl': vars.primaryColorSuppl,
        '--ui-card-color': vars.cardColor,
        '--ui-translucent-card-color': vars.translucentCardColor,
        '--ui-card-title-color': vars.cardTitleColor,
        '--ui-text-color': vars.textColor,
        '--ui-secondary-text-color': vars.secondaryTextColor,
        '--ui-muted-text-color': vars.mutedTextColor,
        '--ui-border-color': vars.borderColor,
        '--ui-panel-color': vars.panelColor,
        '--ui-control-color': vars.controlColor,
        '--ui-control-color-focus': vars.controlColorFocus,
        '--ui-control-color-disabled': vars.controlColorDisabled,
        '--ui-control-text-color': vars.controlTextColor,
        '--ui-control-placeholder-color': vars.controlPlaceholderColor,
        '--ui-control-border-color': vars.controlBorderColor,
        '--ui-control-border-hover-color': vars.controlBorderHoverColor,
        '--ui-control-border-focus-color': vars.controlBorderFocusColor,
        '--ui-control-tag-color': vars.controlTagColor,
        '--ui-control-tag-text-color': vars.controlTagTextColor,
        '--ui-slider-rail-color': vars.sliderRailColor,
        '--ui-slider-rail-hover-color': vars.sliderRailHoverColor,
        '--ui-slider-fill-color': vars.sliderFillColor,
        '--ui-slider-fill-hover-color': vars.sliderFillHoverColor,
        '--ui-slider-handle-color': vars.sliderHandleColor,
        '--ui-back-top-color': vars.backTopColor,
        '--ui-back-top-hover-color': vars.backTopHoverColor,
        '--ui-back-top-icon-color': vars.backTopIconColor,
        '--ui-back-top-icon-hover-color': vars.backTopIconHoverColor,
        '--ui-code-background-color': vars.codeBackgroundColor,
        '--ui-code-text-color': vars.codeTextColor,
        '--ui-code-theme': vars.codeTheme,
        '--ui-inline-code-background-color': vars.inlineCodeBackgroundColor,
        '--ui-inline-code-text-color': vars.inlineCodeTextColor,
        '--ui-mark-background-color': vars.markBackgroundColor,
        '--ui-table-header-color': vars.tableHeaderColor,
        '--ui-scrollbar-track-color': vars.scrollbarTrackColor,
        '--ui-scrollbar-thumb-color': vars.scrollbarThumbColor,
        '--ui-copy-button-background-color': vars.copyButtonBackgroundColor,
        '--ui-copy-button-text-color': vars.copyButtonTextColor,
        '--ui-footer-text-color': vars.footerTextColor,
        '--ui-link-color': vars.linkColor,
        '--ui-link-hover-color': vars.linkHoverColor,
        '--ui-info-color': vars.infoColor,
        '--ui-success-color': vars.successColor,
        '--ui-warning-color': vars.warningColor,
        '--ui-error-color': vars.errorColor,
        '--ui-alert-info-background-color': vars.alertInfoBackgroundColor,
        '--ui-alert-success-background-color': vars.alertSuccessBackgroundColor,
        '--ui-alert-warning-background-color': vars.alertWarningBackgroundColor,
        '--ui-alert-error-background-color': vars.alertErrorBackgroundColor,
        '--ui-orange-color': vars.orangeColor,
        '--ui-cyan-color': vars.cyanColor,
        '--ui-muted-accent-color': vars.mutedAccentColor,
        '--ui-card-shadow': vars.cardShadow,
        '--ui-elevated-shadow': vars.elevatedShadow,
        '--ui-focus-ring-shadow': vars.focusRingShadow,
        '--ui-card-radius': vars.cardRadius,
        '--ui-pill-radius': vars.pillRadius,
        '--ui-icon-color': vars.iconColor,
        '--ui-user-red-color': vars.userRedColor,
        '--ui-user-orange-color': vars.userOrangeColor,
        '--ui-user-purple-color': vars.userPurpleColor,
        '--ui-user-green-color': vars.userGreenColor,
        '--ui-user-blue-color': vars.userBlueColor,
        '--ui-user-gray-color': vars.userGrayColor,
        '--ui-user-cheater-color': vars.userCheaterColor,
        '--ui-prize-green-color': vars.prizeGreenColor,
        '--ui-prize-blue-color': vars.prizeBlueColor,
        '--ui-prize-gold-color': vars.prizeGoldColor,
        '--ui-category-personal-color': vars.categoryPersonalColor,
        '--ui-category-solution-color': vars.categorySolutionColor,
        '--ui-category-tech-color': vars.categoryTechColor,
        '--ui-category-algorithm-color': vars.categoryAlgorithmColor,
        '--ui-category-life-color': vars.categoryLifeColor,
        '--ui-category-study-color': vars.categoryStudyColor,
        '--ui-category-fun-color': vars.categoryFunColor,
        '--ui-category-chat-color': vars.categoryChatColor,
        '--ui-category-unknown-color': vars.categoryUnknownColor
    };
});

const shellStyle = computed(() => ({
    ...themeCssVars.value,
    '--ui-sider-current-width': desktopReservedWidth.value
}));

watch(
    [themeCssVars, isDarkTheme],
    ([vars, dark]) => {
        Object.entries(vars).forEach(([key, value]) => {
            document.documentElement.style.setProperty(key, value);
        });
        document.documentElement.dataset.uiCodeTheme = uiThemeVars.value.codeTheme;
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    },
    { immediate: true }
);

watch(
    desktopReservedWidth,
    width => {
        document.documentElement.style.setProperty('--ui-sider-current-width', width);
    },
    { immediate: true }
);

const { dialog, unmount: unmountSidebarDialog } = createDiscreteApi(['dialog'], {
    configProviderProps: computed(() => ({
        theme: naiveTheme.value,
        locale: zhCN,
        dateLocale: dateZhCN,
        themeOverrides: themeOverrides.value
    }))
});
onBeforeUnmount(unmountSidebarDialog);

const openPaintboardDialog = () => {
    dialog.info({
        title: '冬日绘板',
        content: () =>
            h('span', [
                '活动尚未开始，',
                h(
                    'a',
                    {
                        href: PAINTBOARD_ANNOUNCEMENT_URL,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: { color: 'var(--ui-link-color)' }
                    },
                    '有关公告'
                ),
                '请点击前往查看，敬请期待。'
            ]),
        positiveText: '查看公告',
        negativeText: '取消',
        onPositiveClick: () => {
            window.open(PAINTBOARD_ANNOUNCEMENT_URL, '_blank', 'noopener,noreferrer');
        }
    });
};
</script>

<style scoped>
.n-layout {
    height: 100dvh;
}

.app-shell {
    position: relative;
    padding-left: var(--ui-sider-current-width, 220px);
    box-sizing: border-box;
    transition: padding-left var(--ui-motion-normal) var(--ui-motion-ease);
}

.route-progress-bar {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 2000;
    height: 2px;
    background: var(--ui-primary-color);
    transform-origin: left center;
    opacity: 0;
    pointer-events: none;
    transition:
        transform var(--ui-motion-normal) var(--ui-motion-ease-out),
        opacity var(--ui-motion-fast) var(--ui-motion-ease-out);
}

.route-progress-bar.is-visible {
    opacity: 1;
}

.route-progress-bar.is-finishing {
    opacity: 0;
    transition:
        transform var(--ui-motion-fast) var(--ui-motion-ease-out),
        opacity var(--ui-motion-normal) var(--ui-motion-ease-in) 80ms;
}

.app-main {
    height: 100%;
    background-color: var(--ui-body-color);
    background-image: linear-gradient(
        180deg,
        var(--ui-body-gradient-start),
        var(--ui-body-gradient-end)
    );
}

.app-main :deep(.n-layout-scroll-container),
.app-main :deep(.n-layout-content) {
    background: transparent;
}

.desktop-sider {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 1100;
    width: 220px;
    height: 100dvh;
    background: var(--ui-card-color);
    border-right: 1px solid var(--ui-border-color);
    box-sizing: border-box;
    transition:
        width var(--ui-motion-normal) var(--ui-motion-ease),
        box-shadow var(--ui-motion-normal) var(--ui-motion-ease);
}

.desktop-sider.is-collapsed {
    width: 64px;
}

.desktop-sider.is-overlay {
    z-index: 1200;
    box-shadow: var(--ui-elevated-shadow);
}

.sider-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1190;
    padding: 0;
    border: 0;
    background: rgb(0 0 0 / 28%);
    cursor: default;
    transition: opacity var(--ui-motion-fast) var(--ui-motion-ease);
}

.sider-backdrop-enter-from,
.sider-backdrop-leave-to {
    opacity: 0;
}
.app-footer {
    margin: var(--ui-page-padding) calc(-1 * var(--ui-page-padding))
        calc(-1 * var(--ui-page-padding));
    padding: var(--ui-space-4) var(--ui-space-10);
    background: var(--ui-translucent-card-color);
    color: var(--ui-footer-text-color);
    backdrop-filter: blur(16px);
}

.footer-grid {
    /* Preserve the former paragraph spacing after moving each row into its own grid item. */
    row-gap: 1em !important;
    padding-block: 1em;
}

.footer-element {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
    margin: 0;
}
.footer-element.right-aligned {
    justify-content: flex-end;
}
.footer-element > :nth-child(2) {
    margin-left: 8px;
}
.footer-element > a > :nth-child(2) {
    margin-left: 8px;
}
.footer-link {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
}
.footer-element span,
.footer-link span {
    min-width: 0;
    overflow-wrap: anywhere;
}
.footer-link,
.footer-element a {
    color: var(--ui-footer-text-color);
    transition: color 0.2s;
    text-decoration: none;
}
.footer-link:hover,
.footer-element a:hover {
    color: var(--ui-link-hover-color) !important;
    text-decoration: underline;
}
.footer-link:not(:first-child) {
    margin-left: var(--ui-space-4);
}
.router-view {
    max-width: min(1680px, 100%);
    margin: 0 auto;
    min-height: calc(100dvh - var(--ui-page-padding) - var(--ui-page-padding));
}

:deep(.n-back-top:hover) {
    background-color: var(--ui-back-top-hover-color) !important;
}

:deep(.back-top-action) {
    border-radius: var(--ui-pill-radius) !important;
    color: var(--ui-back-top-icon-color) !important;
    background: var(--ui-back-top-color) !important;
}

@media (max-width: 768px) {
    .app-shell {
        padding-left: 0;
        padding-top: calc(52px + env(safe-area-inset-top, 0px));
        transition: none;
    }

    .app-main {
        width: 100%;
        height: 100%;
    }

    .router-view {
        min-height: calc(
            100dvh - 52px - env(safe-area-inset-top, 0px) - var(--ui-page-padding-mobile) -
                var(--ui-page-padding-mobile)
        );
    }

    .app-main :deep(.n-layout-scroll-container) {
        padding: var(--ui-page-padding-mobile) !important;
    }

    :deep(.n-layout-content) {
        padding: 0 !important;
    }

    .app-footer {
        padding: var(--ui-space-3) var(--ui-space-4);
        margin: var(--ui-page-padding-mobile) calc(-1 * var(--ui-page-padding-mobile))
            calc(-1 * var(--ui-page-padding-mobile));
    }
}

@media (max-width: 639px) {
    .footer-legal {
        order: 5;
    }

    .footer-copyright {
        order: 6;
    }

    .footer-element,
    .footer-element.right-aligned {
        justify-content: center;
        text-align: center;
    }

    .footer-link {
        justify-content: center;
    }
}
</style>
