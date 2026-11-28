<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NSkeleton } from 'naive-ui';
import { List } from 'lucide-vue-next';
import SidebarWidget from '@/components/SidebarWidget.vue';
import type { TocItem } from '@/types/article';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { handleInPageHashClick } from '@/utils/navigation-history';

interface FlatTocItem {
    id: string;
    href: string;
    title: string;
    level: number;
    depth: number;
}

const props = withDefaults(
    defineProps<{
        items: TocItem[];
        loading?: boolean;
        maxHeight?: string;
    }>(),
    {
        loading: false,
        maxHeight: '100%'
    }
);

const reducedMotion = useReducedMotion();
const navRef = ref<HTMLElement | null>(null);
const activeId = ref('');

let scrollContainer: HTMLElement | null = null;
let rafId: number | null = null;
let clickLockTimer: number | null = null;
let clickLockedUntil = 0;

function decodeTargetId(href: string): string {
    if (!href.startsWith('#')) return href;
    const raw = href.slice(1);
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

const flatItems = computed<FlatTocItem[]>(() => {
    const result: FlatTocItem[] = [];
    const visit = (nodes: TocItem[], level: number) => {
        for (const node of nodes) {
            result.push({
                id: decodeTargetId(node.href),
                href: node.href,
                title: node.title,
                level,
                depth: Math.min(level, 3)
            });
            if (node.children?.length) {
                visit(node.children, level + 1);
            }
        }
    };
    visit(props.items, 0);
    return result;
});

const activeIndex = computed(() => {
    if (!activeId.value) return -1;
    return flatItems.value.findIndex(item => item.id === activeId.value);
});

function getScrollMetrics() {
    if (scrollContainer) {
        return {
            topEdge: scrollContainer.getBoundingClientRect().top,
            scrollTop: scrollContainer.scrollTop,
            clientHeight: scrollContainer.clientHeight,
            scrollHeight: scrollContainer.scrollHeight
        };
    }
    return {
        topEdge: 0,
        scrollTop: window.scrollY,
        clientHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight
    };
}

function syncActiveHeading() {
    const items = flatItems.value;
    if (items.length === 0) {
        activeId.value = '';
        return;
    }
    // Mobile/narrow layouts stack TOC outside a sticky sidebar, so skip per-frame layout reads.
    if (window.innerWidth <= 1200) {
        return;
    }
    if (performance.now() < clickLockedUntil) {
        return;
    }

    const { topEdge, scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
    const isScrollable = scrollHeight > clientHeight + 16;
    const nearBottom =
        isScrollable && scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 16;

    let firstExistingId = '';
    let lastExistingId = '';
    let candidateId = '';

    for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (!firstExistingId) firstExistingId = item.id;
        lastExistingId = item.id;

        if (el.getBoundingClientRect().top <= topEdge + 110) {
            candidateId = item.id;
        }
    }

    if (nearBottom && lastExistingId) {
        activeId.value = lastExistingId;
        return;
    }

    activeId.value = candidateId || firstExistingId || items[0]?.id || '';
}

function scheduleSync() {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
        rafId = null;
        syncActiveHeading();
    });
}

function handleTocItemClick(event: MouseEvent, item: FlatTocItem) {
    handleInPageHashClick(event, reducedMotion.value);
    activeId.value = item.id;
    clickLockedUntil = performance.now() + (reducedMotion.value ? 120 : 480);
    if (clickLockTimer !== null) {
        window.clearTimeout(clickLockTimer);
    }
    clickLockTimer = window.setTimeout(
        () => {
            clickLockTimer = null;
            clickLockedUntil = 0;
            syncActiveHeading();
        },
        reducedMotion.value ? 140 : 500
    );
}

watch(activeId, async nextId => {
    if (!nextId) return;
    await nextTick();
    const navEl = navRef.value;
    if (!navEl) return;
    const scrollBox = navEl.closest('.widget-content') as HTMLElement | null;
    const activeLink = navEl.querySelector('.toc-link.is-active') as HTMLElement | null;
    if (!scrollBox || !activeLink) return;

    const boxRect = scrollBox.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const padding = 12;

    if (linkRect.top < boxRect.top + padding) {
        const targetTop = scrollBox.scrollTop + (linkRect.top - boxRect.top) - padding;
        scrollBox.scrollTo({
            top: Math.max(0, targetTop),
            behavior: reducedMotion.value ? 'auto' : 'smooth'
        });
    } else if (linkRect.bottom > boxRect.bottom - padding) {
        const targetTop = scrollBox.scrollTop + (linkRect.bottom - boxRect.bottom) + padding;
        scrollBox.scrollTo({
            top: targetTop,
            behavior: reducedMotion.value ? 'auto' : 'smooth'
        });
    }
});

watch(
    flatItems,
    () => {
        void nextTick(() => {
            syncActiveHeading();
        });
    },
    { immediate: true }
);

onMounted(() => {
    scrollContainer = document.querySelector<HTMLElement>(
        '.app-main .n-scrollbar-container, .app-main > .n-layout-scroll-container'
    );
    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', scheduleSync, { passive: true });
    } else {
        window.addEventListener('scroll', scheduleSync, { passive: true });
    }
    window.addEventListener('resize', scheduleSync, { passive: true });
    void nextTick(() => {
        syncActiveHeading();
    });
});

onBeforeUnmount(() => {
    if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', scheduleSync);
    } else {
        window.removeEventListener('scroll', scheduleSync);
    }
    window.removeEventListener('resize', scheduleSync);
    if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (clickLockTimer !== null) {
        window.clearTimeout(clickLockTimer);
        clickLockTimer = null;
    }
});
</script>

<template>
    <SidebarWidget
        v-if="flatItems.length > 0 || loading"
        title="目录"
        :icon="List"
        class="toc-card"
        :style="{ maxHeight }"
    >
        <template v-if="flatItems.length > 0" #header-extra>
            <span class="toc-progress" aria-hidden="true">
                {{ Math.max(activeIndex + 1, 1) }} / {{ flatItems.length }}
            </span>
        </template>

        <div v-if="flatItems.length === 0 && loading" class="toc-skeleton" aria-busy="true">
            <n-skeleton text style="width: 78%" />
            <n-skeleton text style="width: 62%; margin-left: 12px" />
            <n-skeleton text style="width: 70%; margin-left: 12px" />
            <n-skeleton text style="width: 84%" />
            <n-skeleton text style="width: 56%; margin-left: 12px" />
        </div>

        <nav v-else ref="navRef" class="toc-nav" aria-label="文章目录">
            <ul class="toc-list">
                <li v-for="item in flatItems" :key="item.href" class="toc-item">
                    <a
                        :href="item.href"
                        :title="item.title"
                        class="toc-link"
                        :class="[`is-depth-${item.depth}`, { 'is-active': activeId === item.id }]"
                        :aria-current="activeId === item.id ? 'location' : undefined"
                        @click="handleTocItemClick($event, item)"
                    >
                        <span class="toc-link-text">{{ item.title }}</span>
                    </a>
                </li>
            </ul>
        </nav>
    </SidebarWidget>
</template>

<style scoped>
.toc-card {
    box-sizing: border-box;
    margin-top: 0;
    margin-bottom: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.toc-card :deep(.widget-content) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 0;
}

.toc-progress {
    font-size: 12px;
    font-weight: 500;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}

.toc-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: var(--ui-space-2);
}

.toc-nav {
    padding: 2px 0;
}

.toc-list {
    position: relative;
    list-style: none;
    margin: 0 0 0 2px;
    padding: 0;
    border-left: 1px solid var(--ui-border-color);
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.toc-item {
    min-width: 0;
}

.toc-link {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 5px 10px 5px 12px;
    border-radius: 0 var(--ui-card-radius) var(--ui-card-radius) 0;
    color: var(--ui-secondary-text-color);
    font-size: 13px;
    line-height: 1.45;
    text-decoration: none;
    transition:
        background-color var(--ui-motion-fast) var(--ui-motion-ease),
        color var(--ui-motion-fast) var(--ui-motion-ease);
}

.toc-link::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 5px;
    bottom: 5px;
    width: 2px;
    border-radius: 2px;
    background: var(--ui-primary-color);
    opacity: 0;
    transform: scaleY(0.5);
    transition:
        opacity var(--ui-motion-fast) var(--ui-motion-ease-out),
        transform var(--ui-motion-normal) var(--ui-motion-ease-out);
}

.toc-link.is-depth-0 {
    padding-left: 12px;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ui-text-color);
}

.toc-link.is-depth-1 {
    padding-left: 22px;
    font-size: 13px;
    font-weight: 400;
    color: var(--ui-secondary-text-color);
}

.toc-link.is-depth-2 {
    padding-left: 32px;
    font-size: 12.5px;
    font-weight: 400;
    color: var(--ui-muted-text-color);
}

.toc-link.is-depth-3 {
    padding-left: 40px;
    font-size: 12px;
    font-weight: 400;
    color: var(--ui-muted-text-color);
}

.toc-link:hover {
    color: var(--ui-text-color);
    background-color: var(--ui-panel-color);
}

.toc-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: -2px;
}

.toc-link.is-active {
    color: var(--ui-primary-color);
    font-weight: 600;
    background-color: color-mix(in srgb, var(--ui-primary-color) 10%, transparent);
}

.toc-link.is-active::before {
    opacity: 1;
    transform: scaleY(1);
}

.toc-link-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
}

@media (max-width: 1200px) {
    .toc-card {
        max-height: none !important;
    }
}
</style>
