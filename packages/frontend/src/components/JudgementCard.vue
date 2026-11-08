<script lang="ts">
const userColors: Record<string, string> = {
    red: '#FE4C61',
    orange: '#F39C11',
    green: '#52C41A',
    blue: '#3498DB',
    purple: '#9D3DCF',
    gray: '#BFBFBF',
    cheater: '#AD8B00'
};
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { NIcon } from 'naive-ui';
import { UserCog, UserMinus, UserPlus, UserRound } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import UserBadge from '@/components/UserBadge.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import type { JudgementItem } from '@/api/judgement.ts';
import { getJudgementPermissionNames } from '@/utils/judgement.ts';
import { useLuoguSource } from '@/utils/luogu-source.ts';
import { formatDate } from '@/utils/render.ts';

const props = defineProps<{
    item: JudgementItem;
    displayOptions: {
        avatar: boolean;
        reason: boolean;
        time: boolean;
        color: boolean;
        badge: boolean;
        ccf: boolean;
        xcpc: boolean;
    };
}>();

const { buildLuoguUrl } = useLuoguSource();
const userColor = computed(() =>
    props.displayOptions.color ? userColors[props.item.user.color?.toLowerCase() ?? ''] : undefined
);
const revokedPermissions = computed(() =>
    getJudgementPermissionNames(props.item.revoked_permission)
);
const addedPermissions = computed(() => getJudgementPermissionNames(props.item.added_permission));
const status = computed(() => {
    const { hidden, revoked_permission: revoked, added_permission: added } = props.item;
    if (hidden || (!revoked && !added)) {
        return {
            label: '权限记录',
            icon: UserRound,
            color: 'var(--ui-secondary-text-color)'
        };
    }
    if (revoked && added) {
        return {
            label: '权限变更',
            icon: UserCog,
            color: 'var(--ui-secondary-text-color)'
        };
    }
    if (revoked) {
        return { label: '取消权限', icon: UserMinus, color: 'var(--ui-error-color)' };
    }
    return { label: '授予权限', icon: UserPlus, color: 'var(--ui-success-color)' };
});
</script>

<template>
    <Card class="judgement-card" background-color="var(--ui-translucent-card-color)">
        <header class="judgement-event-header">
            <h2 class="judgement-event-title" :style="{ color: status.color }">
                <n-icon :component="status.icon" :size="20" aria-hidden="true" />
                {{ status.label }}
            </h2>
            <time
                v-if="displayOptions.time"
                class="judgement-time"
                :datetime="new Date(item.time * 1000).toISOString()"
            >
                {{ formatDate(item.time * 1000) }}
            </time>
        </header>

        <div class="judgement-user">
            <a
                v-if="displayOptions.avatar"
                class="user-avatar-link"
                :href="buildLuoguUrl(`/user/${item.uid}`)"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`在洛谷查看 ${item.name} 的主页`"
            >
                <img
                    class="user-avatar"
                    :src="`https://cdn.luogu.com.cn/upload/usericon/${item.uid}.png`"
                    :alt="`${item.name} 的头像`"
                    loading="lazy"
                />
            </a>
            <div class="user-cell">
                <RouterLink
                    class="user-name"
                    :to="`/user/${item.uid}`"
                    :style="{ color: userColor }"
                >
                    {{ item.name }}
                </RouterLink>
                <UserBadge
                    v-if="displayOptions.badge && item.user.badge"
                    :content="item.user.badge"
                    :color="userColor"
                />
                <UserPrizeBadge
                    v-if="
                        (displayOptions.ccf && item.user.ccfLevel) ||
                        (displayOptions.xcpc && item.user.xcpcLevel)
                    "
                    :ccf-level="displayOptions.ccf ? (item.user.ccfLevel ?? 0) : 0"
                    :xcpc-level="displayOptions.xcpc ? (item.user.xcpcLevel ?? 0) : 0"
                    :size="16"
                />
            </div>
        </div>

        <ul
            v-if="!item.hidden && (revokedPermissions.length || addedPermissions.length)"
            class="permission-list"
        >
            <li v-for="name in revokedPermissions" :key="`removed-${name}`">
                <span class="permission-removed">撤销</span>
                <span class="permission-name">{{ name }}</span>
                权限
            </li>
            <li v-for="name in addedPermissions" :key="`added-${name}`">
                <span class="permission-added">授予</span>
                <span class="permission-name">{{ name }}</span>
                权限
            </li>
        </ul>
        <p v-else class="permission-unchanged">{{ item.hidden ? '—' : '无权限变更' }}</p>

        <p v-if="displayOptions.reason" class="judgement-reason">{{ item.reason || '—' }}</p>
    </Card>
</template>

<style scoped>
.judgement-card {
    min-width: 0;
}
.judgement-event-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2) var(--ui-space-4);
    margin: calc(-1 * var(--ui-card-padding)) calc(-1 * var(--ui-card-padding)) var(--ui-space-4);
    padding: var(--ui-space-3) var(--ui-card-padding);
    border-bottom: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius) var(--ui-card-radius) 0 0;
    background: var(--ui-card-color);
}
.judgement-event-title {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--ui-space-1);
    margin: 0;
    font-size: inherit;
    font-weight: 700;
    line-height: 1.5;
}
.judgement-event-title .n-icon {
    flex-shrink: 0;
}
.judgement-time {
    color: var(--ui-secondary-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.judgement-user {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--ui-space-3);
}
.user-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    min-width: 0;
    gap: var(--ui-space-1);
}
.user-name {
    min-width: 0;
    font-size: 18px;
    font-weight: 700;
    text-decoration: none;
    overflow-wrap: anywhere;
}
.user-name:hover {
    text-decoration: none;
}
.user-avatar-link {
    display: inline-flex;
    flex-shrink: 0;
    border-radius: 50%;
}
.user-avatar-link:focus-visible,
.user-name:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}
.user-avatar {
    display: block;
    width: var(--ui-space-8);
    height: var(--ui-space-8);
    border-radius: 50%;
    object-fit: cover;
}
.permission-list {
    display: grid;
    gap: var(--ui-space-2);
    margin: var(--ui-space-4) 0;
    padding-left: var(--ui-space-6);
}
.permission-list li {
    padding-left: var(--ui-space-1);
    overflow-wrap: anywhere;
}
.permission-name {
    margin: 0 var(--ui-space-1);
    padding: 1px var(--ui-space-2);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}
.permission-added {
    color: var(--ui-success-color);
}
.permission-removed {
    color: var(--ui-error-color);
}
.permission-unchanged {
    margin: var(--ui-space-4) 0;
    color: var(--ui-secondary-text-color);
}
.judgement-reason {
    margin: var(--ui-space-4) 0 0;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
@media (max-width: 768px) {
    .judgement-event-header {
        align-items: flex-start;
        flex-direction: column;
        gap: var(--ui-space-1);
    }
}
</style>
