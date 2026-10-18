<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { NBadge, NIcon, NSpace, NTag } from 'naive-ui';
import { CircleCheck, Wrench, Megaphone, Users, Hammer } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import { getAdminDeletionRequests } from '@/api/deletion-request.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';

const pendingReviewCount = ref<number | null>(null);
const pendingReviewState = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle');

const canManageContent = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_CONTENT)
);

const permissionChips = computed(() => [
    {
        label: 'MANAGE_USERS',
        granted: hasPermission(currentAuth.value?.role, Permission.MANAGE_USERS)
    },
    {
        label: 'MANAGE_SEARCH',
        granted: hasPermission(currentAuth.value?.role, Permission.MANAGE_SEARCH)
    },
    {
        label: 'MANAGE_ANNOUNCEMENTS',
        granted: hasPermission(currentAuth.value?.role, Permission.MANAGE_ANNOUNCEMENTS)
    },
    {
        label: 'MANAGE_DISCOVERY',
        granted: hasPermission(currentAuth.value?.role, Permission.MANAGE_DISCOVERY)
    },
    { label: 'MANAGE_CONTENT', granted: canManageContent.value }
]);

const entries = computed(() => [
    {
        name: 'admin-review',
        title: '内容审核',
        description: '审核用户提交的文章/剪贴板删除申请。',
        icon: CircleCheck,
        badge: pendingReviewCount.value ?? 0,
        status:
            pendingReviewState.value === 'loading'
                ? '正在统计待审核申请…'
                : pendingReviewState.value === 'failed'
                  ? '待审核数量加载失败'
                  : null
    },
    {
        name: 'admin-site',
        title: '公告与通知',
        description: '管理站点公告以及 Banner / Popup 通知。',
        icon: Megaphone,
        badge: 0,
        status: null
    },
    {
        name: 'admin-users',
        title: '用户管理',
        description: '查看注册用户并调整权限位。',
        icon: Users,
        badge: 0,
        status: null
    },
    {
        name: 'admin-judgements',
        title: '陶片管理',
        description: '隐藏陶片放逐记录',
        icon: Hammer,
        badge: 0,
        status: null
    },
    {
        name: 'admin-ops',
        title: '系统运维',
        description: '搜索索引、Embedding 重建与文章发现。',
        icon: Wrench,
        badge: 0,
        status: null
    }
]);

async function loadPendingReviewCount() {
    if (!canManageContent.value) return;
    pendingReviewState.value = 'loading';
    try {
        const response = await getAdminDeletionRequests('pending', 1, 1);
        if (response.code !== 200) {
            pendingReviewState.value = 'failed';
            return;
        }
        pendingReviewCount.value = response.data.total;
        pendingReviewState.value = 'ready';
    } catch {
        pendingReviewState.value = 'failed';
    }
}

onMounted(() => {
    void loadPendingReviewCount();
});
</script>

<template>
    <div class="overview-panel">
        <Card title="当前权限" class="panel-card">
            <n-space>
                <n-tag
                    v-for="chip in permissionChips"
                    :key="chip.label"
                    :type="chip.granted ? 'success' : 'default'"
                >
                    {{ chip.label }}
                </n-tag>
            </n-space>
        </Card>

        <div class="entry-grid">
            <Card v-for="entry in entries" :key="entry.name" class="entry-card">
                <div class="entry-body">
                    <n-badge :value="entry.badge" :max="99" :show="entry.badge > 0">
                        <div class="entry-icon">
                            <n-icon :component="entry.icon" size="26" />
                        </div>
                    </n-badge>
                    <div class="entry-text">
                        <RouterLink :to="{ name: entry.name }" class="entry-link">
                            <strong>{{ entry.title }}</strong>
                        </RouterLink>
                        <p class="muted">{{ entry.description }}</p>
                        <p
                            v-if="entry.status"
                            class="entry-status"
                            :class="{ failed: pendingReviewState === 'failed' }"
                        >
                            {{ entry.status }}
                        </p>
                    </div>
                </div>
            </Card>
        </div>
    </div>
</template>

<style scoped>
.panel-card {
    margin-bottom: var(--ui-space-4);
}

.entry-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}

/* The title link is stretched over the whole card so the entire card stays clickable. */
.entry-card {
    position: relative;
    cursor: pointer;
}

.entry-link {
    color: inherit;
    text-decoration: none;
}

.entry-link::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--ui-card-radius);
}

.entry-link:focus-visible {
    outline: none;
}

.entry-link:focus-visible::after {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.entry-body {
    display: flex;
    align-items: center;
    gap: var(--ui-space-4);
}

.entry-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
    border: 1px solid var(--ui-border-color);
    color: var(--ui-primary-color);
}

.entry-text strong {
    color: var(--ui-card-title-color);
    font-size: 15px;
}

.entry-text p {
    margin: var(--ui-space-1) 0 0;
    font-size: 14px;
}

.entry-status {
    color: var(--ui-muted-text-color);
}

.entry-status.failed {
    color: var(--ui-error-color);
}

.muted {
    color: var(--ui-muted-text-color);
}

@media (max-width: 900px) {
    .entry-grid {
        grid-template-columns: 1fr;
    }
}
</style>
