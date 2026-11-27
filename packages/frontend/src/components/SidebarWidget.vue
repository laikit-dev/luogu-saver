<script setup lang="ts">
import { type Component, inject, computed, type Ref } from 'vue';
import { NIcon } from 'naive-ui';
import { uiThemeKey, type UiThemeVars } from '@/styles/theme/themeKeys.ts';

const themeVars: Ref<UiThemeVars> = inject(uiThemeKey)!;

defineProps<{
    title?: string;
    icon?: Component;
}>();

const titleColor = computed(() => themeVars.value.cardTitleColor);
const iconColor = computed(() => themeVars.value.primaryColor);
</script>

<template>
    <div class="sidebar-widget">
        <div v-if="title || $slots['header-extra']" class="widget-header">
            <div class="widget-header-main">
                <NIcon v-if="icon" :component="icon" :color="iconColor" class="widget-icon" />
                <span v-if="title" class="widget-title" :style="{ color: titleColor }">{{
                    title
                }}</span>
            </div>
            <div v-if="$slots['header-extra']" class="widget-header-extra">
                <slot name="header-extra" />
            </div>
        </div>
        <div class="widget-content">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.sidebar-widget {
    box-sizing: border-box;
    margin-bottom: var(--ui-space-6);
    padding: var(--ui-space-4);
    background: var(--ui-card-color);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    box-shadow: var(--ui-card-shadow);
}

.widget-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    margin-bottom: var(--ui-space-4);
    padding-bottom: var(--ui-space-2);
    border-bottom: 1px solid var(--ui-border-color);
}

.widget-header-main {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    min-width: 0;
}

.widget-header-extra {
    display: flex;
    align-items: center;
    flex-shrink: 0;
}

.widget-icon {
    font-size: 18px;
    flex-shrink: 0;
}

.widget-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.5px;
}
.widget-content {
    padding: 0 2px;
}
</style>
