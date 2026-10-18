<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import {
    NAlert,
    NAvatar,
    NButton,
    NDataTable,
    NInput,
    NInputNumber,
    NSpin,
    useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import Card from '@/components/Card.vue';
import { getAdminUsers, updateAdminUserRole, type AdminUser } from '@/api/admin.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request.ts';

const message = useMessage();

const users = ref<AdminUser[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const savingUserIds = ref(new Set<number>());
const searchKeyword = ref('');
let loadRequestId = 0;

const pagination = {
    defaultPageSize: 20,
    showSizePicker: true,
    pageSizes: [10, 20, 50]
};

const canManageUsers = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_USERS)
);

const filteredUsers = computed(() => {
    const keyword = searchKeyword.value.trim().toLowerCase();
    if (!keyword) return users.value;
    return users.value.filter(
        user =>
            user.name.toLowerCase().includes(keyword) ||
            String(user.luoguUid).includes(keyword) ||
            String(user.id).includes(keyword)
    );
});

async function loadUsers() {
    if (!canManageUsers.value) return;
    const id = ++loadRequestId;
    loading.value = true;
    loadError.value = null;
    try {
        const response = await getAdminUsers();
        if (id !== loadRequestId) return;
        if (response.code !== 200) {
            loadError.value = '用户列表加载失败，请重试。';
            return;
        }
        users.value = response.data;
    } catch (error) {
        if (id !== loadRequestId) return;
        loadError.value = requestErrorMessage(error, '用户列表加载失败，请重试。');
    } finally {
        if (id === loadRequestId) loading.value = false;
    }
}

async function saveRole(row: AdminUser) {
    if (row.role === null || savingUserIds.value.has(row.id)) return;
    savingUserIds.value.add(row.id);
    try {
        const response = await updateAdminUserRole(row.id, row.role);
        if (response.code === 200) message.success('权限已更新');
        else message.error('权限更新失败，请重试。');
    } catch (error) {
        message.error(requestErrorMessage(error, '权限更新失败，请重试。'));
    } finally {
        savingUserIds.value.delete(row.id);
    }
}

const columns: DataTableColumns<AdminUser> = [
    { title: 'ID', key: 'id', width: 72 },
    {
        title: '用户',
        key: 'name',
        minWidth: 180,
        render(row) {
            return h('div', { class: 'user-cell' }, [
                h(NAvatar, {
                    size: 'small',
                    round: true,
                    src: row.avatarUrl ?? undefined,
                    fallbackSrc: undefined
                }),
                h('span', row.name)
            ]);
        }
    },
    { title: '洛谷 UID', key: 'luoguUid', width: 110 },
    {
        title: '注册时间',
        key: 'createdAt',
        width: 170,
        render: row => formatDate(row.createdAt)
    },
    {
        title: 'Role',
        key: 'role',
        width: 160,
        render(row) {
            return h(NInputNumber, {
                value: row.role ?? 0,
                min: -1,
                style: 'width: 140px',
                onUpdateValue(value: number | null) {
                    row.role = value ?? 0;
                }
            });
        }
    },
    {
        title: '操作',
        key: 'actions',
        width: 100,
        render(row) {
            return h(
                NButton,
                {
                    size: 'small',
                    type: 'primary',
                    secondary: true,
                    loading: savingUserIds.value.has(row.id),
                    onClick: () => saveRole(row)
                },
                { default: () => '保存' }
            );
        }
    }
];

onMounted(() => {
    void loadUsers();
});
</script>

<template>
    <Card title="注册用户" class="users-card">
        <n-spin :show="loading">
            <template v-if="canManageUsers">
                <n-alert v-if="loadError" type="error">
                    {{ loadError }}
                    <div class="state-actions">
                        <n-button :disabled="loading" @click="loadUsers">重试</n-button>
                    </div>
                </n-alert>
                <template v-else>
                    <n-input
                        v-model:value="searchKeyword"
                        placeholder="按名称 / 洛谷 UID / ID 筛选"
                        clearable
                        class="user-search"
                    />
                    <n-data-table
                        :columns="columns"
                        :data="filteredUsers"
                        :pagination="pagination"
                        :row-key="(row: AdminUser) => row.id"
                    />
                </template>
            </template>
            <n-alert v-else type="warning" title="缺少 MANAGE_USERS">
                你没有用户管理权限。
            </n-alert>
        </n-spin>
    </Card>
</template>

<style scoped>
.users-card {
    margin-bottom: var(--ui-space-4);
}

.user-search {
    max-width: 320px;
    margin-bottom: var(--ui-space-3);
}

.users-card :deep(.user-cell) {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}
</style>
