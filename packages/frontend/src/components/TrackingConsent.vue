<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { RouterLink } from 'vue-router';
import { NCard, NSpace, NButton, NText, NIcon } from 'naive-ui';
import { ChartNoAxesCombined } from 'lucide-vue-next';
import { trackingConsent } from '@/utils/tracking-consent.ts';

const show = ref(false);
const emit = defineEmits<{
    'update:blocking': [blocking: boolean];
}>();
let showTimer: number | null = null;

onMounted(() => {
    const consent = trackingConsent.value;
    emit('update:blocking', consent === 'unset');
    if (consent === 'unset') {
        showTimer = window.setTimeout(() => {
            showTimer = null;
            show.value = true;
        }, 500);
    }
});

onUnmounted(() => {
    if (showTimer !== null) window.clearTimeout(showTimer);
});

const handleAccept = () => {
    trackingConsent.value = 'allowed';
    show.value = false;
    emit('update:blocking', false);
};

const handleReject = () => {
    trackingConsent.value = 'denied';
    show.value = false;
    emit('update:blocking', false);
};
</script>

<template>
    <Transition name="slide-up">
        <div v-if="show" class="consent-banner">
            <n-card content-style="padding: 16px;" :bordered="false" class="consent-card">
                <div class="content-wrapper">
                    <div class="text-section">
                        <div class="icon-wrapper">
                            <n-icon size="24" color="var(--ui-primary-color)">
                                <ChartNoAxesCombined />
                            </n-icon>
                        </div>
                        <div class="text-content">
                            <n-text strong>我们需要您的许可</n-text>
                            <n-text depth="3" class="description">
                                为了提供更精准的内容推荐，我们希望收集您的设备信息用于数据分析。
                                <router-link to="/privacy" class="policy-link">
                                    查看隐私协议
                                </router-link>
                            </n-text>
                        </div>
                    </div>

                    <n-space class="action-section">
                        <n-button secondary @click="handleReject"> 拒绝 </n-button>
                        <n-button type="primary" @click="handleAccept"> 同意并开启 </n-button>
                    </n-space>
                </div>
            </n-card>
        </div>
    </Transition>
</template>

<style scoped>
.consent-banner {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 800px;
    z-index: 9999;
}

.consent-card {
    box-shadow: var(--ui-elevated-shadow);
    border-radius: var(--ui-card-radius);
    background-color: var(--ui-translucent-card-color);
    backdrop-filter: blur(10px);
    border: 1px solid var(--ui-border-color);
}

.content-wrapper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.text-section {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex: 1;
}

.description {
    display: block;
    margin-top: 2px;
    line-height: 1.5;
}

.policy-link {
    color: var(--ui-link-color);
    text-decoration: none;
}

.policy-link:hover,
.policy-link:focus-visible {
    color: var(--ui-link-hover-color);
    text-decoration: underline;
}

.action-section {
    flex-shrink: 0;
}

@media (max-width: 600px) {
    .consent-banner {
        bottom: 0;
        left: 0;
        width: 100%;
        transform: none;
        border-radius: var(--ui-card-radius) var(--ui-card-radius) 0 0;
    }

    .consent-card {
        border-radius: var(--ui-card-radius) var(--ui-card-radius) 0 0;
    }

    .content-wrapper {
        flex-direction: column;
        align-items: flex-start;
    }

    .action-section {
        width: 100%;
        justify-content: flex-end;
        margin-top: 12px;
    }
}

.slide-up-enter-active,
.slide-up-leave-active {
    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
    transform: translate(-50%, 100%);
    opacity: 0;
}

@media (max-width: 600px) {
    .slide-up-enter-from,
    .slide-up-leave-to {
        transform: translateY(100%);
    }
}

@media (prefers-reduced-motion: reduce) {
    .slide-up-enter-active,
    .slide-up-leave-active {
        transition: none;
    }
}
</style>
