<script setup lang="ts">
import { NAvatar } from 'naive-ui';
import type { UserIdentity } from '@/types/user';
import UserBadge from './UserBadge.vue';
import UserPrizeBadge from './UserPrizeBadge.vue';

defineProps<{
    user?: UserIdentity;
    showAvatar?: boolean;
}>();
</script>

<template>
    <span class="user-link-container" :class="`user-${user?.color || 'Gray'}`">
        <n-avatar
            v-if="showAvatar"
            class="user-link-avatar"
            round
            size="small"
            :src="`https://cdn.luogu.com.cn/upload/usericon/${user?.id || 3}.png`"
        />
        <router-link v-if="user?.id" :to="`/user/${user.id}`" class="user-name" @click.stop>
            <slot name="name">{{ user.name || '未知用户' }}</slot>
        </router-link>
        <span v-else class="user-name">
            <slot name="name">{{ user?.name || '未知用户' }}</slot>
        </span>
        <UserPrizeBadge
            v-if="user && ((user.ccfLevel ?? 0) > 0 || (user.xcpcLevel ?? 0) > 0)"
            :ccf-level="user.ccfLevel ?? 0"
            :xcpc-level="user.xcpcLevel ?? 0"
            :size="showAvatar ? 16 : 14"
        />
        <UserBadge v-if="user?.badge" :content="user.badge" />
    </span>
</template>

<style scoped>
.user-link-container {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
}
.user-link-avatar {
    flex: none;
    margin-right: var(--ui-inline-gap);
}
.user-name {
    color: inherit;
    overflow-wrap: anywhere;
    text-decoration: none;
    font-weight: 600;
    transition: opacity 0.2s;
}
.user-name:hover {
    opacity: 0.8;
}
</style>
