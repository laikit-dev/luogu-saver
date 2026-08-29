<script setup lang="ts">
import { computed } from 'vue';
import { NTooltip } from 'naive-ui';

const props = withDefaults(
    defineProps<{
        ccfLevel?: number;
        xcpcLevel?: number;
        size?: number;
    }>(),
    {
        ccfLevel: 0,
        xcpcLevel: 0,
        size: 16
    }
);

// OI / XCPC badge colors mirror Luogu's main site (verified against the upstream
// getCCFLevel implementation, replicated in a long-running userscript):
//   level < 3 → not shown
//   level ≤ 5 → green
//   level ≤ 7 → blue
//   level ≥ 8 → gold
function levelColor(level: number): string | null {
    if (level < 3) return null;
    if (level <= 5) return 'var(--ui-prize-green-color)';
    if (level <= 7) return 'var(--ui-prize-blue-color)';
    return 'var(--ui-prize-gold-color)';
}

const oi = computed(() => {
    const color = levelColor(props.ccfLevel ?? 0);
    if (!color) return null;
    return { color, label: `OI 等级 ${props.ccfLevel}` };
});

const xcpc = computed(() => {
    const color = levelColor(props.xcpcLevel ?? 0);
    if (!color) return null;
    return { color, label: `ICPC/CCPC 等级 ${props.xcpcLevel}` };
});

// OI: certified badge — 16x16 viewBox, fill-only path (Luogu's exact rendering).
const OI_PATH =
    'M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z';

// XCPC: balloon — 384x512 viewBox, Font Awesome 6 `fa-balloon` path,
// matching the icon Luogu uses on user pages.
const XCPC_PATH =
    'M0 192C0 86 86 0 192 0S384 86 384 192c0 128-160 240-160 240l27.9 41.8c2.7 4 4.1 8.8 4.1 13.6 0 13.6-11 24.6-24.6 24.6l-78.9 0c-13.6 0-24.6-11-24.6-24.6 0-4.8 1.4-9.6 4.1-13.6L160 432S0 320 0 192zm104-16c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24c-66.3 0-120 53.7-120 120 0 13.3 10.7 24 24 24s24-10.7 24-24z';
</script>

<template>
    <span v-if="oi || xcpc" class="user-prize-badges" :style="{ height: `${size}px` }">
        <n-tooltip v-if="oi" :delay="200">
            <template #trigger>
                <svg
                    class="user-prize-badge"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    :width="size"
                    :height="size"
                    :fill="oi.color"
                    role="img"
                    :aria-label="oi.label"
                >
                    <path :d="OI_PATH" />
                </svg>
            </template>
            {{ oi.label }}
        </n-tooltip>

        <n-tooltip v-if="xcpc" :delay="200">
            <template #trigger>
                <svg
                    class="user-prize-badge"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 384 512"
                    :width="size"
                    :height="size"
                    :fill="xcpc.color"
                    role="img"
                    :aria-label="xcpc.label"
                >
                    <path :d="XCPC_PATH" />
                </svg>
            </template>
            {{ xcpc.label }}
        </n-tooltip>
    </span>
</template>

<style scoped>
.user-prize-badges {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 4px;
    vertical-align: middle;
    line-height: 1;
}
.user-prize-badge {
    display: inline-block;
    vertical-align: middle;
}
</style>
