<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import { NButton, useMessage } from 'naive-ui';
import { getAuthorFollowState, setAuthorFollow } from '@/api/archive.ts';
import { authToken, currentAuth, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { requestErrorMessage } from '@/utils/request.ts';

type AccessIssue = 'expired' | 'forbidden';

const props = defineProps<{ uid: number }>();
const emit = defineEmits<{ change: [following: boolean] }>();
const route = useRoute();
const message = useMessage();
const following = ref<boolean | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const accessIssue = ref<AccessIssue | null>(null);
let requestId = 0;

const accessMessages: Record<AccessIssue, string> = {
    expired: '登录已失效，请使用 CP OAuth 重新登录后管理关注。',
    forbidden: '当前账号无权使用私人关注，账号可能已被封禁。'
};

const buttonLabel = computed(() => {
    if (!isAuthenticated.value) return '登录后关注';
    if (accessIssue.value === 'expired') return '重新登录后关注';
    if (accessIssue.value === 'forbidden') return '无法使用关注';
    if (loading.value && following.value === null) return '读取关注状态';
    if (following.value === null) return '重试关注状态';
    return following.value ? '取消关注' : '关注作者';
});

function accessIssueOf(code: number | undefined): AccessIssue | null {
    if (code === 401) return 'expired';
    if (code === 403) return 'forbidden';
    return null;
}

function fail(issue: AccessIssue | null, fallback: string) {
    accessIssue.value = issue;
    if (issue) following.value = null;
    errorMessage.value = issue ? accessMessages[issue] : fallback;
}

async function loadState() {
    const request = ++requestId;
    following.value = null;
    errorMessage.value = '';
    accessIssue.value = null;
    loading.value = false;
    if (!isAuthenticated.value) return;
    loading.value = true;
    try {
        await nextTick();
        if (request !== requestId || !isAuthenticated.value) return;
        const response = await getAuthorFollowState(props.uid);
        if (request !== requestId) return;
        if (response.code === 200) {
            following.value = response.data.following;
        } else {
            fail(accessIssueOf(response.code), '读取关注状态失败，请重试。');
        }
    } catch (error) {
        if (request !== requestId) return;
        fail(
            accessIssueOf(isAxiosError(error) ? error.response?.status : undefined),
            requestErrorMessage(error, '读取关注状态失败，请重试。')
        );
    } finally {
        if (request === requestId) loading.value = false;
    }
}

async function handleClick() {
    if (!isAuthenticated.value || accessIssue.value === 'expired') {
        startCpOAuthLogin(route.fullPath);
        return;
    }
    if (loading.value || accessIssue.value === 'forbidden') return;
    if (following.value === null) {
        await loadState();
        return;
    }
    const request = ++requestId;
    const desiredState = !following.value;
    loading.value = true;
    errorMessage.value = '';
    try {
        const response = await setAuthorFollow(props.uid, desiredState);
        if (request !== requestId) return;
        if (response.code === 200) {
            following.value = response.data.following;
            emit('change', response.data.following);
            message.success(response.data.following ? '已关注作者' : '已取消关注');
        } else {
            fail(accessIssueOf(response.code), '更新关注失败，请重试。');
        }
    } catch (error) {
        if (request !== requestId) return;
        fail(
            accessIssueOf(isAxiosError(error) ? error.response?.status : undefined),
            requestErrorMessage(error, '更新关注失败，未能确认结果，请重试。')
        );
    } finally {
        if (request === requestId) loading.value = false;
    }
}

watch(
    [() => props.uid, authToken, () => currentAuth.value?.registeredUser?.id],
    () => {
        void loadState();
    },
    { immediate: true, flush: 'sync' }
);
onBeforeUnmount(() => {
    requestId += 1;
});
</script>

<template>
    <div class="archive-relation-control">
        <div class="archive-relation-actions">
            <n-button
                :type="following ? 'default' : 'primary'"
                secondary
                :loading="loading"
                :disabled="loading || accessIssue === 'forbidden'"
                @click="handleClick"
            >
                {{ buttonLabel }}
            </n-button>
            <router-link v-if="following" to="/library?tab=follows" class="archive-relation-link">
                管理关注
            </router-link>
        </div>
        <p v-if="errorMessage" class="archive-relation-error" role="status">
            {{ errorMessage }}
        </p>
    </div>
</template>

<style scoped>
.archive-relation-control {
    min-width: 0;
    max-width: 100%;
}

.archive-relation-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
}

.archive-relation-link {
    color: var(--ui-link-color);
    overflow-wrap: anywhere;
}

.archive-relation-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.archive-relation-error {
    margin: var(--ui-space-2) 0 0;
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}
</style>
