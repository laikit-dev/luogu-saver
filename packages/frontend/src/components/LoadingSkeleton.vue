<template>
    <div v-if="!loading" class="ui-content-reveal">
        <slot />
    </div>

    <template v-else>
        <slot v-if="$slots.skeleton" name="skeleton" />

        <n-space v-else vertical>
            <n-skeleton text :repeat="2" />
            <n-skeleton text style="width: 60%" />
        </n-space>
    </template>
</template>

<script setup lang="ts">
import { useSlots } from 'vue';
import { NSkeleton, NSpace } from 'naive-ui';

defineProps({
    loading: {
        type: Boolean,
        required: false,
        default: true
    }
});

const $slots = useSlots();
</script>
