<script setup lang="ts">
import { NButton, NPopconfirm } from 'naive-ui';

const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
    <n-popconfirm
        positive-text="继续"
        negative-text="取消"
        :positive-button-props="{ type: 'error' }"
        @positive-click="emit('confirm')"
    >
        <template #trigger>
            <n-button secondary type="error">退出登录</n-button>
        </template>
        是否退出当前账号？
    </n-popconfirm>
</template>
