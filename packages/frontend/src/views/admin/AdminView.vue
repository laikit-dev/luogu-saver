<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NTabPane, NTabs } from 'naive-ui';
import { ShieldCheck } from 'lucide-vue-next';
import AccessGate from '@/components/AccessGate.vue';
import CardTitle from '@/components/CardTitle.vue';
import { currentRole } from '@/utils/auth.ts';
import { hasRole, UserRole } from '@/utils/permissions.ts';

const route = useRoute();
const router = useRouter();

const TABS = [
    { name: 'admin', label: '概览' },
    { name: 'admin-review', label: '内容审核' },
    { name: 'admin-site', label: '公告与通知' },
    { name: 'admin-users', label: '用户管理' },
    { name: 'admin-ops', label: '系统运维' }
];

const activeTab = computed(() => (route.name as string) ?? 'admin');

const canOpenAdmin = computed(() => hasRole(currentRole.value, UserRole.MODERATOR));

function handleTabChange(name: string) {
    router.push({ name });
}

onMounted(async () => {
    // Legacy deep link: /admin?section=announcement used to scroll to the
    // announcement card before the console was split into sub-pages.
    if (route.query.section === 'announcement' && route.name === 'admin') {
        await router.replace({ name: 'admin-site' });
    }
});
</script>

<template>
    <div class="admin-page">
        <CardTitle title="管理后台" :icon="ShieldCheck" />

        <AccessGate :allowed="canOpenAdmin" :redirect="route.fullPath">
            <div class="admin-content">
                <n-tabs type="line" :value="activeTab" @update:value="handleTabChange">
                    <n-tab-pane
                        v-for="tab in TABS"
                        :key="tab.name"
                        :name="tab.name"
                        :tab="tab.label"
                        display-directive="if"
                    />
                </n-tabs>

                <router-view />
            </div>
        </AccessGate>
    </div>
</template>

<style scoped>
.admin-page {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    max-width: 1220px;
    margin: 0 auto;
}

.admin-content {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    min-width: 0;
}
</style>
