<script setup lang="ts">
import { NTooltip } from 'naive-ui';

withDefaults(
    defineProps<{
        content: string;
        color?: string;
        maxWidth?: number;
    }>(),
    {
        color: undefined,
        maxWidth: 120
    }
);
</script>

<template>
    <n-tooltip :delay="200">
        <template #trigger>
            <span
                class="user-badge"
                :style="{
                    backgroundColor: color || undefined,
                    maxWidth: `${maxWidth}px`
                }"
            >
                {{ content }}
            </span>
        </template>
        <span class="user-badge-tooltip">{{ content }}</span>
    </n-tooltip>
</template>

<style scoped>
.user-badge {
    display: inline-block;
    overflow: hidden;
    color: #fff;
    font-size: 12px;
    line-height: 18px;
    padding: 0 5px;
    border-radius: var(--ui-tag-radius);
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--luogu-user-color, var(--ui-primary-color));
    vertical-align: middle;
}
.user-badge-tooltip {
    max-width: min(420px, calc(100vw - 32px));
    white-space: normal;
    overflow-wrap: anywhere;
}
</style>
