<script setup lang="ts">
import { NAnchorLink } from 'naive-ui';
import type { TocItem } from '@/types/article';

defineProps<{
    item: TocItem;
    level: number;
}>();
</script>

<template>
    <n-anchor-link
        class="toc-anchor-link"
        :style="{ '--toc-level': level }"
        :title="item.title"
        :href="item.href"
    >
        <TableOfContentsItem
            v-for="child in item.children"
            :key="child.href"
            :item="child"
            :level="level + 1"
        />
    </n-anchor-link>
</template>
