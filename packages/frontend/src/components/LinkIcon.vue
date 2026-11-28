<script setup lang="ts">
import { computed } from 'vue';
import type { LinkIconGroup } from '@/utils/enhanced-links';
import { LINK_ICON_DEFS } from '@/utils/link-icons';

const props = defineProps<{
    group: LinkIconGroup;
}>();

const def = computed(() => LINK_ICON_DEFS[props.group]);
</script>

<template>
    <span :class="['lgs-link-icon', `lgs-link-icon--${group}`]" aria-hidden="true">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            :viewBox="def.viewBox"
            :fill="def.fill ? 'currentColor' : 'none'"
            :stroke="def.fill ? 'none' : 'currentColor'"
            :stroke-width="def.fill ? undefined : 2"
            :stroke-linecap="def.fill ? undefined : 'round'"
            :stroke-linejoin="def.fill ? undefined : 'round'"
        >
            <component
                :is="el.tag"
                v-for="(el, index) in def.elements"
                :key="index"
                v-bind="el.attrs"
            />
        </svg>
    </span>
</template>
