<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NIcon, NSpin } from 'naive-ui';
import { AlertCircle, ExternalLink, LogIn, RotateCcw } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import { exchangeCpOAuthCode } from '@/api/auth.ts';
import { setAuthToken, setCurrentAuth, startCpOAuthLogin } from '@/utils/auth.ts';

const CP_OAUTH_BINDINGS_URL = 'https://www.cpoauth.com/profile?tab=bindings';

const route = useRoute();
const router = useRouter();
const errorTitle = ref('登录失败');
const errorMessage = ref('');
const showBindLuoguAction = ref(false);

type CallbackErrorCopy = { title: string; message: string };

const DEFAULT_CALLBACK_ERROR: CallbackErrorCopy = {
    title: '登录失败',
    message: '登录未能完成，请稍后重新登录。'
};
const UNLINKED_LUOGU_ERROR: CallbackErrorCopy = {
    title: '尚未绑定洛谷账号',
    message:
        '当前 CP OAuth 账号尚未绑定洛谷账号。请先前往 CP OAuth 完成洛谷账号绑定，再返回重新登录。'
};
const ALREADY_BOUND_LUOGU_ERROR: CallbackErrorCopy = {
    title: '洛谷账号已被绑定',
    message: '该洛谷账号已绑定到其他 CP OAuth 账号，请切换对应账号或检查绑定设置。'
};

const callbackErrorMessages: Record<string, CallbackErrorCopy> = {
    access_denied: {
        title: '已取消授权',
        message: '你已取消 CP OAuth 授权，未完成登录。'
    },
    invalid_request: {
        title: '登录失败',
        message: '登录回调参数无效，请重新登录。'
    },
    luogu_account_not_linked: UNLINKED_LUOGU_ERROR,
    luogu_account_already_bound: ALREADY_BOUND_LUOGU_ERROR,
    login_failed: DEFAULT_CALLBACK_ERROR
};

function resolveCallbackError(error: string, rawMessage: unknown): CallbackErrorCopy {
    const message = typeof rawMessage === 'string' ? rawMessage : '';
    const isUnlinkedLuogu =
        error === 'luogu_account_not_linked' ||
        message === 'CP OAuth account has no linked Luogu account' ||
        message.includes('尚未绑定洛谷账号');
    if (isUnlinkedLuogu) {
        showBindLuoguAction.value = true;
        return UNLINKED_LUOGU_ERROR;
    }

    const isAlreadyBound =
        error === 'luogu_account_already_bound' ||
        message === 'Luogu account is already bound to another CP OAuth account';
    if (isAlreadyBound) {
        return ALREADY_BOUND_LUOGU_ERROR;
    }

    return callbackErrorMessages[error] ?? DEFAULT_CALLBACK_ERROR;
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
        <Card class="auth-card">
            <div v-if="errorMessage" class="auth-state" role="alert">
                <div class="auth-badge is-error" aria-hidden="true">
                    <n-icon :component="AlertCircle" :size="24" />
                </div>
                <h1 class="auth-title">{{ errorTitle }}</h1>
                <p class="auth-desc">{{ errorMessage }}</p>
                <div class="auth-actions">
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
                        :secondary="showBindLuoguAction"
                        @click="startCpOAuthLogin('/')"
                    >
                        <template #icon>
                            <n-icon :component="RotateCcw" />
                        </template>
                        重新登录
                    </n-button>
                    <n-button secondary @click="router.replace('/')">返回首页</n-button>
                </div>
            </div>

            <div v-else class="auth-state" role="status" aria-live="polite">
                <div class="auth-badge" aria-hidden="true">
                    <n-icon :component="LogIn" :size="24" />
                </div>
                <h1 class="auth-title">正在验证登录…</h1>
                <p class="auth-desc">正在确认 CP OAuth 凭据并同步账号状态，请稍候。</p>
                <div class="auth-spinner">
                    <n-spin size="medium" />
                </div>
            </div>
        </Card>
    </div>
</template>

<style scoped>
.auth-callback {
    box-sizing: border-box;
    width: 100%;
    max-width: 480px;
    margin: clamp(32px, 10vh, 96px) auto;
}

.auth-card {
    width: 100%;
}

.auth-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--ui-space-4) var(--ui-space-2);
}

.auth-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    margin-bottom: var(--ui-space-4);
    border-radius: 14px;
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
}

.auth-badge.is-error {
    background: var(--ui-alert-error-background-color);
    color: var(--ui-error-color);
}

.auth-title {
    margin: 0;
    color: var(--ui-card-title-color);
    font-size: 18px;
    font-weight: 600;
    line-height: 1.4;
}

.auth-desc {
    margin: var(--ui-space-2) 0 0;
    max-width: 360px;
    color: var(--ui-secondary-text-color);
    font-size: 14px;
    line-height: 1.6;
}

.auth-spinner {
    margin-top: var(--ui-space-5);
}

.auth-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
    margin-top: var(--ui-space-5);
}
</style>
