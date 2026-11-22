<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

// MUST equal `FOUNDING_DATE` in AboutView.vue. See spec/about-page.spec.md §3.5 / §6.4.
const FOUNDING_DATE = new Date('2025-02-12T00:00:00Z').getTime();

const timeSinceFound = ref(Math.floor((Date.now() - FOUNDING_DATE) / 1000));
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    timer = setInterval(() => {
        timeSinceFound.value = Math.floor((Date.now() - FOUNDING_DATE) / 1000);
    }, 1000);
});

onUnmounted(() => {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
});
</script>

<template>
    <span>本网站已运行 {{ timeSinceFound }} 秒</span>
</template>
