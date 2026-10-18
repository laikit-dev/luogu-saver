<script setup lang="ts">
import { NButton, NButtonGroup, NIcon, NTooltip, useMessage } from 'naive-ui';
import { LayoutGrid, Star } from 'lucide-vue-next';
import { canUseFocusView, type ViewMode } from '@/composables/useViewMode';

defineProps<{
    modelValue: ViewMode;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: ViewMode];
}>();

const message = useMessage();

const handleSwitch = (mode: ViewMode) => {
    if (mode === 'focus' && !canUseFocusView(window.innerWidth)) {
        message.warning('屏幕宽度不足，无法使用聚焦视图');
        return;
    }
    emit('update:modelValue', mode);
};
</script>

<template>
    <n-button-group size="small" role="group" aria-label="阅读视图">
        <n-tooltip>
            <template #trigger>
                <n-button
                    :type="modelValue === 'default' ? 'primary' : 'default'"
                    :ghost="modelValue !== 'default'"
                    :aria-pressed="modelValue === 'default'"
                    @click="handleSwitch('default')"
                >
                    <template #icon>
                        <NIcon :component="LayoutGrid" />
                    </template>
                    综合
                </n-button>
            </template>
            默认视图，内容显示区域较窄
        </n-tooltip>
        <n-tooltip>
            <template #trigger>
                <n-button
                    :type="modelValue === 'focus' ? 'primary' : 'default'"
                    :ghost="modelValue !== 'focus'"
                    :aria-pressed="modelValue === 'focus'"
                    @click="handleSwitch('focus')"
                >
                    <template #icon>
                        <NIcon :component="Star" />
                    </template>
                    聚焦
                </n-button>
            </template>
            聚焦于正文内容，内容显示区域较宽，还可以使用段落收藏
        </n-tooltip>
    </n-button-group>
</template>
