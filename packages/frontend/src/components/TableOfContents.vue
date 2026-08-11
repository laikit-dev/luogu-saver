<script setup lang="ts">
import { NAnchor } from 'naive-ui';
import { List } from 'lucide-vue-next';
import SidebarWidget from '@/components/SidebarWidget.vue';
import TableOfContentsItem from '@/components/TableOfContentsItem.vue';
import type { TocItem } from '@/types/article';

withDefaults(
    defineProps<{
        items: TocItem[];
        maxHeight?: string;
    }>(),
    {
        maxHeight: 'calc(100vh - 130px)'
    }
);
</script>

<template>
    <SidebarWidget
        v-if="items.length > 0"
        title="目录"
        :icon="List"
        class="toc-card"
        :style="{ maxHeight }"
    >
        <n-anchor
            class="toc-anchor"
            type="block"
            :bound="100"
            ignore-gap
            :show-rail="true"
            :show-background="true"
        >
            <TableOfContentsItem v-for="item in items" :key="item.href" :item="item" :level="0" />
        </n-anchor>
    </SidebarWidget>
</template>

<style scoped>
.toc-card {
    margin-top: 0;
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

.toc-card :deep(.n-anchor) {
    box-sizing: border-box;
    max-width: none;
    width: 100%;
    overflow: hidden;
}

.toc-card :deep(.n-anchor--block) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px;
}

.toc-card :deep(.n-anchor-link) {
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    border-radius: var(--ui-card-radius);
    overflow: hidden;
}

.toc-card :deep(.n-anchor-link .n-anchor-link) {
    margin-top: 2px;
}

.toc-card :deep(.n-anchor-link--active) {
    background-color: var(--ui-panel-color) !important;
    box-shadow: none;
}

.toc-card :deep(.toc-anchor-link > .n-anchor-link__title) {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 5px 10px 5px calc(10px + var(--toc-level) * 16px);
    border-radius: var(--ui-card-radius);
    color: var(--ui-text-color);
    white-space: normal;
    line-height: 1.35;
    overflow: hidden;
    transition:
        background-color 0.2s ease,
        color 0.2s ease;
}

.toc-card :deep(.n-anchor-link__title:hover),
.toc-card :deep(.n-anchor-link__title:focus) {
    color: var(--ui-text-color) !important;
}

.toc-card :deep(.n-anchor-link--active > .n-anchor-link__title) {
    color: var(--ui-text-color);
    font-weight: 600;
}

.toc-card :deep(.n-anchor-link__title::before) {
    content: '';
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-muted-accent-color);
}

.toc-card :deep(.n-anchor-link--active > .n-anchor-link__title::before) {
    background: var(--ui-primary-color);
}

@media (max-width: 1200px) {
    .toc-card {
        max-height: none !important;
    }
}
</style>
