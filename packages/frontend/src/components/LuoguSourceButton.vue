<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { NButton, NButtonGroup, NIcon, NPopover } from 'naive-ui';
import { ChevronDown, ExternalLink } from 'lucide-vue-next';
import {
    LUOGU_SOURCE_OPTIONS,
    type LuoguSourceHost,
    useLuoguSource
} from '@/utils/luogu-source.ts';

const props = withDefaults(
    defineProps<{
        path: string;
        size?: 'tiny' | 'small' | 'medium' | 'large';
        fixedHost?: LuoguSourceHost;
        block?: boolean;
    }>(),
    {
        size: 'small',
        fixedHost: undefined,
        block: false
    }
);
const { buildLuoguUrl } = useLuoguSource();
const show = ref(false);
const hoverEnabled = ref(false);
const normalizedPath = computed(() => (props.path.startsWith('/') ? props.path : `/${props.path}`));
const primaryHref = computed(() =>
    props.fixedHost
        ? `https://www.${props.fixedHost}${normalizedPath.value}`
        : buildLuoguUrl(props.path)
);
let hoverQuery: MediaQueryList | undefined;

function updateHover() {
    hoverEnabled.value = hoverQuery?.matches ?? false;
    show.value = false;
}

onMounted(() => {
    hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    updateHover();
    hoverQuery.addEventListener('change', updateHover);
});
onUnmounted(() => hoverQuery?.removeEventListener('change', updateHover));
</script>

<template>
    <n-button
        v-if="fixedHost"
        :size="size"
        :block="block"
        secondary
        tag="a"
        :href="primaryHref"
        target="_blank"
        rel="noopener noreferrer"
    >
        <template #icon><n-icon :component="ExternalLink" /></template>
        原站
    </n-button>
    <n-button-group v-else :class="{ 'is-block': block }">
        <n-button
            :class="{ 'source-primary-btn': block }"
            :size="size"
            secondary
            tag="a"
            :href="primaryHref"
            target="_blank"
            rel="noopener noreferrer"
        >
            <template #icon><n-icon :component="ExternalLink" /></template>
            原站
        </n-button>
        <n-popover
            v-model:show="show"
            :trigger="hoverEnabled ? 'hover' : 'click'"
            placement="bottom-end"
            :show-arrow="false"
            style="padding: 4px"
        >
            <template #trigger>
                <n-button
                    class="source-domain-toggle"
                    :size="size"
                    secondary
                    aria-label="选择原站域名"
                    aria-haspopup="true"
                    :aria-expanded="show"
                >
                    <template #icon><n-icon :component="ChevronDown" /></template>
                </n-button>
            </template>
            <nav class="source-options" aria-label="选择原站域名">
                <a
                    v-for="option in LUOGU_SOURCE_OPTIONS"
                    :key="option.value"
                    :href="`https://www.${option.value}${normalizedPath}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click="show = false"
                >
                    {{ option.label }}
                    <n-icon :component="ExternalLink" :size="14" aria-hidden="true" />
                </a>
            </nav>
        </n-popover>
    </n-button-group>
</template>

<style scoped>
.is-block {
    display: flex;
    width: 100%;
}
.source-primary-btn {
    flex: 1;
    min-width: 0;
}
.source-domain-toggle {
    background-image: linear-gradient(
        var(--ui-secondary-text-color),
        var(--ui-secondary-text-color)
    );
    background-size: 1px 16px;
    background-position: left center;
    background-repeat: no-repeat;
}
.source-options {
    display: grid;
    min-width: 160px;
}
.source-options a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-4);
    padding: var(--ui-space-2) var(--ui-space-3);
    border-radius: var(--ui-button-radius);
    color: var(--ui-text-color);
    text-decoration: none;
}
.source-options a:hover,
.source-options a:focus-visible {
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
}
</style>
