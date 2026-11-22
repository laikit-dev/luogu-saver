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
        <div v-if="icon" class="hero-symbol" aria-hidden="true">
            <n-icon class="hero-icon" :component="icon" size="34" />
        </div>
        <div class="hero-copy">
            <h1 class="hero-title">{{ title }}</h1>
        </div>
    </header>
</template>

<style scoped>
.page-hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--ui-space-5);
    padding: var(--ui-space-2) 0 var(--ui-space-4);
}

.hero-copy {
    min-width: 0;
}

.hero-symbol {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    min-width: 46px;
    padding-right: var(--ui-space-5);
    border-right: 1px solid var(--ui-border-color);
}

.hero-icon {
    flex: 0 0 auto;
    color: var(--ui-icon-color);
}

.hero-title {
    margin: 0;
    color: var(--ui-card-title-color);
    font-family: var(--ui-font-family-display);
    font-size: 28px;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.015em;
}

@media (max-width: 480px) {
    .page-hero {
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--ui-space-3);
        padding: var(--ui-space-1) 0 var(--ui-space-3);
    }

    .hero-title {
        font-size: 24px;
    }

    .hero-symbol {
        min-width: 38px;
        padding-right: var(--ui-space-3);
    }

    .hero-icon {
        font-size: 28px !important;
    }
}
</style>
