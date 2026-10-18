<script setup lang="ts">
import { onMounted } from 'vue';
import { NAlert, NButton, NSpin } from 'naive-ui';
import { ensureCurrentAuth } from '@/api/auth.ts';
import { currentAuthState, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';

/**
 * Renders the default slot only for a logged-in account whose permissions were loaded and
 * `allowed` is true. Otherwise shows exactly one of: login required, checking permissions,
 * login expired (re-login), permission check failed (retry), or no permission.
 */
defineProps<{
    allowed: boolean;
    redirect: string;
}>();

onMounted(() => {
    void ensureCurrentAuth();
});
</script>

<template>
    <n-alert v-if="!isAuthenticated" type="warning" title="需要登录">
        请先登录后访问此页面。
        <div class="access-gate-actions">
            <n-button type="primary" @click="startCpOAuthLogin(redirect)">
                使用 CP OAuth 登录
            </n-button>
        </div>
    </n-alert>
    <div
        v-else-if="currentAuthState === 'idle' || currentAuthState === 'loading'"
        class="access-gate-loading"
        role="status"
    >
        <n-spin size="small" />
        <span>正在确认账号权限…</span>
    </div>
    <n-alert v-else-if="currentAuthState === 'expired'" type="warning" title="登录已失效">
        当前登录状态已失效，请重新登录。
        <div class="access-gate-actions">
            <n-button type="primary" @click="startCpOAuthLogin(redirect)">
                使用 CP OAuth 重新登录
            </n-button>
        </div>
    </n-alert>
    <n-alert v-else-if="currentAuthState === 'failed'" type="error" title="无法确认账号权限">
        账号信息加载失败，请重试。
        <div class="access-gate-actions">
            <n-button @click="ensureCurrentAuth({ force: true })">重试</n-button>
        </div>
    </n-alert>
    <n-alert v-else-if="!allowed" type="error" title="无权限">
        当前账号没有访问此页面的权限。
    </n-alert>
    <slot v-else />
</template>

<style scoped>
.access-gate-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    margin-top: var(--ui-space-3);
}

.access-gate-loading {
    display: flex;
    align-items: center;
    gap: var(--ui-inline-gap);
    color: var(--ui-secondary-text-color);
}
</style>
