<script setup lang="ts">
import { NCheckbox, NRadioButton, NRadioGroup } from 'naive-ui';
import type { JudgementDisplayOptions } from '@/utils/judgement.ts';

defineProps<{
    layout: 'card' | 'table';
    options: JudgementDisplayOptions;
}>();

const emit = defineEmits<{
    'update:layout': [value: 'card' | 'table'];
    'update:option': [key: keyof JudgementDisplayOptions, value: boolean];
}>();
</script>

<template>
    <div class="display-option-panel">
        <div class="display-option-group">
            <strong>显示方式</strong>
            <n-radio-group
                :value="layout"
                aria-label="显示方式"
                @update:value="value => emit('update:layout', value)"
            >
                <n-radio-button value="card">卡片</n-radio-button>
                <n-radio-button value="table">表格</n-radio-button>
            </n-radio-group>
        </div>
        <div class="display-option-group">
            <strong>标记</strong>
            <n-checkbox
                :checked="options.badge"
                label="Badge"
                @update:checked="val => emit('update:option', 'badge', val)"
            />
            <n-checkbox
                :checked="options.ccf"
                label="OI 认证"
                @update:checked="val => emit('update:option', 'ccf', val)"
            />
            <n-checkbox
                :checked="options.xcpc"
                label="XCPC 认证"
                @update:checked="val => emit('update:option', 'xcpc', val)"
            />
        </div>
        <div class="display-option-group">
            <strong>内容</strong>
            <n-checkbox
                :checked="options.avatar"
                label="头像"
                @update:checked="val => emit('update:option', 'avatar', val)"
            />
            <n-checkbox
                :checked="options.reason"
                label="原因"
                @update:checked="val => emit('update:option', 'reason', val)"
            />
            <n-checkbox
                :checked="options.time"
                label="时间"
                @update:checked="val => emit('update:option', 'time', val)"
            />
        </div>
    </div>
</template>

<style scoped>
.display-option-panel {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}
.display-option-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ui-space-2) 14px;
}
.display-option-group strong {
    width: 100%;
}
</style>
