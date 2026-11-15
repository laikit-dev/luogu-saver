<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NCard, NModal, useMessage } from 'naive-ui';

const props = defineProps<{ show: boolean; source: string }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const message = useMessage();
const copying = ref(false);

async function copyAll() {
    copying.value = true;
    try {
        await navigator.clipboard.writeText(props.source);
        message.success('源码已复制到剪贴板');
    } catch {
        message.error('复制失败，请手动选择源码复制');
    } finally {
        copying.value = false;
    }
}
</script>

<template>
    <n-modal :show="show" @update:show="value => emit('update:show', value)">
        <n-card
            title="Markdown 源码"
            class="source-modal"
            :bordered="false"
            role="dialog"
            aria-modal="true"
            aria-label="Markdown 源码"
        >
            <pre
                class="source-code"
                tabindex="0"
                aria-label="Markdown 源码内容"
            ><code class="language-markdown">{{ source }}</code></pre>
            <template #footer>
                <div class="source-actions">
                    <n-button @click="emit('update:show', false)">关闭</n-button>
                    <n-button type="primary" :loading="copying" @click="copyAll">复制全部</n-button>
                </div>
            </template>
        </n-card>
    </n-modal>
</template>

<style scoped>
.source-modal {
    width: min(960px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
}
.source-code {
    box-sizing: border-box;
    max-height: max(120px, calc(100dvh - 260px));
    overflow: auto;
    margin: 0;
    padding: var(--ui-space-4);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
    color: var(--ui-text-color);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 14px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
}
.source-code code {
    font: inherit;
}
.source-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--ui-space-2);
}
</style>
