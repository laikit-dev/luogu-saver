<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NIcon, NSpin } from 'naive-ui';
import { ExternalLink, LogIn } from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import { exchangeCpOAuthCode } from '@/api/auth.ts';
import { setAuthToken, setCurrentAuth, startCpOAuthLogin } from '@/utils/auth.ts';

const CP_OAUTH_BINDINGS_URL = 'https://www.cpoauth.com/profile?tab=bindings';

const route = useRoute();
const router = useRouter();
const errorTitle = ref('登录失败');
const errorMessage = ref('');
const showBindLuoguAction = ref(false);

const callbackErrorMessages: Record<string, { title: string; message: string }> = {
    access_denied: {
        title: '已取消授权',
        message: '你已取消 CP OAuth 授权，未完成登录。'
    },
    invalid_request: {
        title: '登录失败',
        message: '登录回调参数无效，请重新登录。'
    },
    luogu_account_not_linked: {
        title: '尚未绑定洛谷账号',
        message:
            '当前 CP OAuth 账号尚未绑定洛谷账号。请先前往 CP OAuth 完成洛谷账号绑定，再返回重新登录。'
    },
    luogu_account_already_bound: {
        title: '洛谷账号已被绑定',
        message: '该洛谷账号已绑定到其他 CP OAuth 账号，请切换对应账号或检查绑定设置。'
    },
    login_failed: {
        title: '登录失败',
        message: '登录未能完成，请稍后重新登录。'
    }
};

function resolveCallbackError(error: string, rawMessage: unknown) {
    const message = typeof rawMessage === 'string' ? rawMessage : '';
    const isUnlinkedLuogu =
        error === 'luogu_account_not_linked' ||
        message === 'CP OAuth account has no linked Luogu account' ||
        message.includes('尚未绑定洛谷账号');
    if (isUnlinkedLuogu) {
        showBindLuoguAction.value = true;
        return callbackErrorMessages.luogu_account_not_linked;
    }

    const isAlreadyBound =
        error === 'luogu_account_already_bound' ||
        message === 'Luogu account is already bound to another CP OAuth account';
    if (isAlreadyBound) {
        return callbackErrorMessages.luogu_account_already_bound;
    }

    return callbackErrorMessages[error] ?? callbackErrorMessages.login_failed;
}

onMounted(async () => {
    const error = route.query.error as string | undefined;
    if (error) {
        const resolved = resolveCallbackError(error, route.query.message);
        errorTitle.value = resolved.title;
        errorMessage.value = resolved.message;
        return;
    }

    const code = route.query.code as string | undefined;
    if (!code) {
        errorMessage.value = '登录回调缺少登录凭据，请重新登录。';
        return;
    }

    try {
        const response = await exchangeCpOAuthCode(code);
        if (response.code !== 200 || !response.data?.token) {
            errorMessage.value = '登录凭据无效或已过期，请重新登录。';
            return;
        }
        setAuthToken(response.data.token);
        setCurrentAuth({
            uid: response.data.uid,
            role: response.data.role,
            registeredUser: response.data.registeredUser
        });
        const redirect = (route.query.redirect as string | undefined) || '/';
        await router.replace(
            redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
        );
    } catch {
        errorMessage.value = '登录未能完成，请稍后重新登录。';
    }
});
</script>

<template>
    <div class="auth-callback">
        <CardTitle title="登录验证" :icon="LogIn" />

        <n-alert v-if="errorMessage" type="error" :title="errorTitle">
            <div class="alert-content">
                <p class="alert-message">{{ errorMessage }}</p>
                <div class="alert-actions">
                    <n-button
                        v-if="showBindLuoguAction"
                        tag="a"
                        type="primary"
                        :href="CP_OAUTH_BINDINGS_URL"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <template #icon>
                            <n-icon :component="ExternalLink" />
                        </template>
                        前往 CP OAuth 绑定
                    </n-button>
                    <n-button
                        :type="showBindLuoguAction ? 'default' : 'primary'"
                        secondary
                        @click="startCpOAuthLogin('/')"
                    >
                        重新登录
                    </n-button>
                    <n-button quaternary @click="router.replace('/')">返回首页</n-button>
                </div>
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
    flex-direction: column;
    gap: var(--ui-space-3);
}

.alert-message {
    margin: 0;
    line-height: 1.6;
}

.alert-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}
</style>
