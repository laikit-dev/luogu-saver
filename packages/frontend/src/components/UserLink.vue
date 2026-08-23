<script setup lang="ts">
import { NAvatar } from 'naive-ui';
import type { User } from '@/types/user';
import UserPrizeBadge from './UserPrizeBadge.vue';

defineProps<{
    user?: User;
    showAvatar?: boolean;
}>();
</script>

<template>
    <div class="user-link-container">
        <n-avatar
            v-if="showAvatar"
            round
            size="small"
            :src="`https://cdn.luogu.com.cn/upload/usericon/${user?.id || 3}.png`"
            style="margin-right: 8px"
        />
        <router-link
            :to="`/user/${user?.id}`"
            class="user-name"
            :class="`user-${user?.color || 'Gray'}`"
            @click.stop
        >
            {{ user?.name || '未知用户' }}
        </router-link>
        <UserPrizeBadge
            v-if="user && ((user.ccfLevel ?? 0) > 0 || (user.xcpcLevel ?? 0) > 0)"
            :ccf-level="user.ccfLevel ?? 0"
            :xcpc-level="user.xcpcLevel ?? 0"
        />
    </div>
</template>

<style scoped>
.user-link-container {
    display: inline-flex;
    align-items: center;
}
.user-name {
    text-decoration: none;
    font-weight: 600;
    transition: opacity 0.2s;
}
.user-name:hover {
    opacity: 0.8;
}
</style>
