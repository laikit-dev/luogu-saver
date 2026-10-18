<script setup lang="ts">
import { computed, ref } from 'vue';
import { NAlert, NButton, NInput, useDialog, useMessage } from 'naive-ui';
import Card from '@/components/Card.vue';
import { hideAdminJudgementHistories } from '@/api/admin.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const message = useMessage();
const dialog = useDialog();
const uidInput = ref('');
const submitting = ref(false);
const canManageContent = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_CONTENT)
);

function submit() {
    if (!uidInput.value.trim()) {
        message.warning('请输入至少一个洛谷 UID');
        return;
    }

    dialog.warning({
        title: '隐藏陶片放逐记录',
        content: '提交后会立即隐藏所有输入 UID 在当前时刻之前的记录，且无法撤销。确认继续吗？',
        positiveText: '确认隐藏',
        negativeText: '取消',
        onPositiveClick: async () => {
            submitting.value = true;
            try {
                const response = await hideAdminJudgementHistories(uidInput.value);
                if (response.code !== 200) {
                    // The backend rejects malformed or out-of-range UID lists with code 400.
                    message.error(
                        response.code === 400
                            ? '隐藏记录失败，请检查输入的洛谷 UID 是否为正整数。'
                            : '隐藏记录失败，请重试。'
                    );
                    return;
                }
                message.success(`已隐藏 ${response.data.items.length} 个 UID 的历史记录`);
                uidInput.value = '';
            } catch (error) {
                message.error(requestErrorMessage(error, '隐藏记录失败，请重试。'));
            } finally {
                submitting.value = false;
            }
        }
    });
}
</script>

<template>
    <div class="admin-judgement-panel">
        <n-alert v-if="!canManageContent" type="warning" title="缺少 MANAGE_CONTENT">
            当前账号没有管理陶片放逐记录的权限。
        </n-alert>

        <Card v-else title="隐藏陶片放逐记录">
            <p class="description">
                输入一个或多个洛谷 UID。可使用英文逗号或换行分隔；所有 UID 的历史记录会立即隐藏。
            </p>
            <n-input
                v-model:value="uidInput"
                type="textarea"
                placeholder="例如：123456, 234567&#10;345678"
                :autosize="{ minRows: 5, maxRows: 12 }"
            />
            <div class="actions">
                <n-button type="error" :loading="submitting" @click="submit">隐藏历史记录</n-button>
            </div>
        </Card>
    </div>
</template>

<style scoped>
.admin-judgement-panel {
    display: grid;
    gap: var(--ui-space-4);
}

.description {
    margin: 0 0 var(--ui-space-3);
    color: var(--ui-secondary-text-color);
}

.actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--ui-space-3);
}
</style>
