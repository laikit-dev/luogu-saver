<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCheckbox, NModal, NSpace } from 'naive-ui';
import { useLuoguLinkOpenPreference } from '@/composables/useLuoguLinkOpenPreference';

const router = useRouter();
const { mode, pendingPrompt, closePrompt } = useLuoguLinkOpenPreference();
const rememberChoice = ref(false);

watch(pendingPrompt, next => {
    if (next) {
        rememberChoice.value = false;
    }
});

const modalTitle = computed(() =>
    pendingPrompt.value?.kind === 'paste' ? '打开洛谷剪贴板链接' : '打开洛谷文章链接'
);

function handleShowUpdate(show: boolean) {
    if (!show) {
        closePrompt();
    }
}

function handleOpenInSaver() {
    const prompt = pendingPrompt.value;
    if (!prompt) return;
    if (rememberChoice.value) {
        mode.value = 'saver';
    }
    const { inSitePath } = prompt;
    closePrompt();
    void router.push(inSitePath);
}

function handleOpenLuoguOriginal() {
    const prompt = pendingPrompt.value;
    if (!prompt) return;
    if (rememberChoice.value) {
        mode.value = 'luogu';
    }
    const { externalHref } = prompt;
    closePrompt();
    window.open(externalHref, '_blank', 'noopener,noreferrer');
}
</script>

<template>
    <n-modal
        :show="Boolean(pendingPrompt)"
        preset="card"
        :bordered="false"
        :title="modalTitle"
        style="width: min(420px, calc(100vw - 24px))"
        @update:show="handleShowUpdate"
    >
        <div v-if="pendingPrompt" class="luogu-link-prompt">
            <p class="prompt-desc">检测到洛谷原站文章或剪贴板链接，是否改从保存站查看？</p>
            <p v-if="pendingPrompt.title" class="prompt-title">{{ pendingPrompt.title }}</p>
            <div class="prompt-url">{{ pendingPrompt.externalHref }}</div>
            <div class="prompt-remember">
                <n-checkbox v-model:checked="rememberChoice">记住我的选择</n-checkbox>
                <div class="prompt-hint">之后可在「设置 → 导航」中修改</div>
            </div>
            <n-space justify="end" class="prompt-actions">
                <n-button secondary @click="handleOpenLuoguOriginal">打开洛谷原站</n-button>
                <n-button type="primary" @click="handleOpenInSaver">从保存站查看</n-button>
            </n-space>
        </div>
    </n-modal>
</template>

<style scoped>
.luogu-link-prompt {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}
.prompt-desc {
    margin: 0;
    color: var(--ui-text-color);
    line-height: 1.55;
}
.prompt-title {
    margin: 0;
    font-weight: 600;
    color: var(--ui-card-title-color);
    overflow-wrap: anywhere;
}
.prompt-url {
    padding: var(--ui-space-2) var(--ui-space-3);
    border-radius: var(--ui-button-radius);
    background: var(--ui-panel-color);
    color: var(--ui-muted-text-color);
    font-family: var(--ui-font-family-mono);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}
.prompt-remember {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.prompt-hint {
    color: var(--ui-muted-text-color);
    font-size: 12px;
    padding-left: 24px;
}
.prompt-actions {
    margin-top: var(--ui-space-1);
}
</style>
