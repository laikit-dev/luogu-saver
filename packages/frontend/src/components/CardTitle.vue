<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

withDefaults(
    defineProps<{
        title: string;
        icon?: Component | null;
    }>(),
    {
        icon: null
    }
);
</script>

<template>
    <header class="page-hero">
        <div class="hero-main">
            <n-icon v-if="icon" class="hero-icon" :component="icon" size="24" aria-hidden="true" />
            <h1 class="hero-title">{{ title }}</h1>
        </div>
        <div v-if="$slots.extra" class="hero-extra">
            <slot name="extra" />
        </div>
    </header>
</template>

<style scoped>
.page-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--ui-space-3) var(--ui-space-4);
    padding: var(--ui-space-1) 0 var(--ui-space-4);
}

.hero-main {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    min-width: 0;
}

.hero-icon {
    flex: 0 0 auto;
    color: var(--ui-icon-color);
}

.hero-title {
    margin: 0;
    min-width: 0;
    color: var(--ui-card-title-color);
    font-family: var(--ui-font-family-display);
    font-size: 24px;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
}

.hero-extra {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-shrink: 0;
}

@media (max-width: 480px) {
    .page-hero {
        gap: var(--ui-space-2) var(--ui-space-3);
        padding: 0 0 var(--ui-space-3);
    }

    .hero-main {
        gap: var(--ui-space-2);
    }

    .hero-title {
        font-size: 22px;
    }

    .hero-icon {
        font-size: 22px !important;
    }
}
</style>
