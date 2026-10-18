<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NSpin } from 'naive-ui';
import { LogIn } from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import { setAuthToken } from '@/utils/auth.ts';

const route = useRoute();
const router = useRouter();
const errorMessage = ref('');

// The callback `message` query carries raw OAuth/backend English text, so it is never shown; the
// error code (plus the one backend reason users can act on) is mapped to Chinese copy instead.
const callbackErrorMessages: Record<string, string> = {
    access_denied: '你已取消授权，未完成登录。',
    invalid_request: '登录回调参数无效，请重新登录。',
    login_failed: '登录未能完成，请稍后重新登录。'
};
const UNLINKED_LUOGU_ACCOUNT_MESSAGE = 'CP OAuth account has no linked Luogu account';

onMounted(() => {
    const error = route.query.error as string | undefined;
    if (error) {
        errorMessage.value =
            route.query.message === UNLINKED_LUOGU_ACCOUNT_MESSAGE
                ? '你的 CP OAuth 账号尚未绑定洛谷账号，请先在 CP OAuth 绑定后重新登录。'
                : (callbackErrorMessages[error] ?? '登录未能完成，请重新登录。');
        return;
    }

    const token = route.query.token as string | undefined;
    if (!token) {
        errorMessage.value = '登录回调缺少登录凭据，请重新登录。';
        return;
    }

    setAuthToken(token);
    const redirect = (route.query.redirect as string | undefined) || '/';
    router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/');
});
</script>

<template>
    <div class="auth-callback">
        <CardTitle title="登录验证" :icon="LogIn">
            正在校验 CP OAuth 登录结果，完成后会自动返回登录前的页面。
        </CardTitle>

        <n-alert v-if="errorMessage" type="error" title="登录失败">
            <div class="alert-content">
                <span>{{ errorMessage }}</span>
                <n-button @click="router.replace('/')">返回首页</n-button>
            </div>
        </n-alert>
        <div v-else class="loading-state" role="status">
            <n-spin size="small" />
            <span>正在完成登录…</span>
        </div>
    </div>
</template>

<style scoped>
.auth-callback {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    max-width: 640px;
    margin: 80px auto;
}

.loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ui-space-3);
    color: var(--ui-secondary-text-color);
}

.alert-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
}
</style>
