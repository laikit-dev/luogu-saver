<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { NButton, NCard, NIcon, NTooltip } from 'naive-ui';
import { X, Github, Star } from 'lucide-vue-next';
import { useStarPrompt } from '@/composables/useStarPrompt.ts';
import { GITHUB_STAR_PROMPT_STORAGE_KEY } from '@/utils/constants.ts';

const props = withDefaults(
    defineProps<{
        blocked?: boolean;
    }>(),
    {
        blocked: false
    }
);

const { state, markOpened, dismiss, syncStoredState } = useStarPrompt();
const show = ref(false);
let showTimer: number | null = null;

function clearShowTimer() {
    if (showTimer === null) return;
    window.clearTimeout(showTimer);
    showTimer = null;
}

function schedulePrompt() {
    clearShowTimer();

    if (state.value !== 'eligible' || props.blocked || document.visibilityState !== 'visible') {
        show.value = false;
        return;
    }

    showTimer = window.setTimeout(() => {
        showTimer = null;
        if (
            state.value === 'eligible' &&
            !props.blocked &&
            document.visibilityState === 'visible'
        ) {
            show.value = true;
        }
    }, 2200);
}

function handleOpen() {
    markOpened();
    show.value = false;
}

function handleDismiss() {
    dismiss();
    show.value = false;
}

function handleVisibilityChange() {
    schedulePrompt();
}

function handleStorageChange(event: StorageEvent) {
    if (event.key === GITHUB_STAR_PROMPT_STORAGE_KEY) {
        syncStoredState(event.newValue);
    }
}

watch([state, () => props.blocked], schedulePrompt, { immediate: true });

onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);
});
onUnmounted(() => {
    clearShowTimer();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('storage', handleStorageChange);
});
</script>

<template>
    <div class="star-prompt-region" aria-live="polite" aria-atomic="true">
        <Transition name="star-prompt">
            <aside v-if="show" class="star-prompt" aria-label="支持开源项目">
                <n-card class="star-prompt-card" :bordered="false" content-style="padding: 14px;">
                    <div class="prompt-heading">
                        <div class="github-icon" aria-hidden="true">
                            <n-icon :component="Github" />
                        </div>

                        <div class="prompt-copy">
                            <strong>觉得洛谷保存站有帮助？</strong>
                            <span>欢迎在 GitHub 点个 Star，让更多人找到它。</span>
                        </div>

                        <n-tooltip trigger="hover" placement="top">
                            <template #trigger>
                                <n-button
                                    class="dismiss-button"
                                    quaternary
                                    circle
                                    size="small"
                                    aria-label="不再提示"
                                    @click="handleDismiss"
                                >
                                    <template #icon>
                                        <n-icon :component="X" />
                                    </template>
                                </n-button>
                            </template>
                            不再提示
                        </n-tooltip>
                    </div>

                    <div class="prompt-actions">
                        <n-button
                            class="star-action"
                            tag="a"
                            type="primary"
                            size="small"
                            href="https://github.com/laikit-dev/luogu-saver"
                            target="_blank"
                            rel="noopener noreferrer"
                            @click="handleOpen"
                        >
                            <template #icon>
                                <n-icon :component="Star" />
                            </template>
                            去 GitHub 点 Star
                        </n-button>
                    </div>
                </n-card>
            </aside>
        </Transition>
    </div>
</template>

<style scoped>
.star-prompt {
    position: fixed;
    right: var(--ui-space-6);
    bottom: calc(var(--ui-space-6) + env(safe-area-inset-bottom, 0px));
    z-index: 1100;
    width: min(360px, calc(100vw - 48px));
}

.star-prompt-card {
    position: relative;
    overflow: hidden;
    color: var(--ui-text-color);
    background: var(--ui-translucent-card-color);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    box-shadow: var(--ui-elevated-shadow);
    backdrop-filter: blur(14px);
}

.star-prompt-card::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    content: '';
    background: var(--ui-primary-color);
}

.prompt-heading {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) 28px;
    gap: 10px;
    align-items: start;
}

.github-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    color: var(--ui-primary-color);
    background: var(--ui-panel-color);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
}

.github-icon .n-icon {
    font-size: 20px;
}

.prompt-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
    padding-top: 1px;
}

.prompt-copy strong {
    color: var(--ui-card-title-color);
    font-size: 14px;
    line-height: 1.4;
    letter-spacing: 0;
}

.prompt-copy span {
    color: var(--ui-muted-text-color);
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.dismiss-button {
    width: 28px;
    height: 28px;
    min-width: 28px;
    color: var(--ui-muted-text-color);
}

.prompt-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--ui-space-3);
    margin-left: 48px;
}

.star-action {
    min-width: 144px;
}

.star-prompt-enter-active,
.star-prompt-leave-active {
    transition:
        opacity 0.22s ease,
        transform 0.22s ease;
}

.star-prompt-enter-from,
.star-prompt-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (max-width: 600px) {
    .star-prompt {
        right: 68px;
        bottom: calc(var(--ui-space-3) + env(safe-area-inset-bottom, 0px));
        left: var(--ui-space-3);
        width: auto;
    }

    .prompt-actions {
        margin-left: 48px;
    }

    .star-action {
        width: 100%;
    }
}

@media (max-width: 360px) {
    .star-prompt {
        right: 60px;
        left: var(--ui-space-2);
    }

    .prompt-heading {
        grid-template-columns: minmax(0, 1fr) 28px;
    }

    .github-icon {
        display: none;
    }

    .prompt-actions {
        margin-left: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .star-prompt-enter-active,
    .star-prompt-leave-active {
        transition: none;
    }
}
</style>
