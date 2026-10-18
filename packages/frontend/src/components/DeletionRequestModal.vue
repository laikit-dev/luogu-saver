<script setup lang="ts">
import { ref } from 'vue';
import { NAlert, NButton, NCard, NInput, NModal, useMessage } from 'naive-ui';
import { createDeletionRequest, type DeletionRequestTargetType } from '@/api/deletion-request';
import { requestErrorMessage } from '@/utils/request';

const props = defineProps<{
    show: boolean;
    targetType: DeletionRequestTargetType;
    targetId: string;
}>();

const emit = defineEmits<{
    (e: 'update:show', value: boolean): void;
    (e: 'submitted'): void;
}>();

const message = useMessage();
const reason = ref('');
const submitting = ref(false);

const targetLabel = () => (props.targetType === 'article' ? '文章' : '剪贴板');

const close = () => {
    emit('update:show', false);
};

const handleSubmit = async () => {
    const trimmedReason = reason.value.trim();
    if (!trimmedReason) {
        message.warning('请填写申请删除的原因');
        return;
    }

    submitting.value = true;
    try {
        const res = await createDeletionRequest(props.targetType, props.targetId, trimmedReason);
        if (res.code === 200) {
            message.success('删除申请已提交，请等待管理员审核');
            reason.value = '';
            emit('submitted');
            close();
            return;
        }
        if (res.code === 409) {
            message.warning('您已提交过该内容的删除申请，请耐心等待审核');
            close();
            return;
        }
        message.error('删除申请提交失败，请重试。');
    } catch (error) {
        message.error(requestErrorMessage(error, '删除申请提交失败，请重试。'));
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <n-modal :show="show" @update:show="value => emit('update:show', value)">
        <n-card
            :bordered="false"
            role="dialog"
            aria-modal="true"
            :title="`申请删除${targetLabel()} ${targetId}`"
            :style="{ width: 'min(520px, calc(100vw - 32px))' }"
        >
            <n-alert type="info" :bordered="true" class="policy-alert">
                提交申请前，请先阅读
                <router-link
                    to="/deletion"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="policy-link"
                >
                    《数据移除政策》 </router-link
                >。管理员审核通过后，相关内容将被删除，审核结果会通过站内通知告知您。
            </n-alert>

            <n-input
                v-model:value="reason"
                type="textarea"
                placeholder="请填写申请删除的原因（必填）"
                maxlength="500"
                show-count
                :autosize="{ minRows: 4, maxRows: 8 }"
            />

            <template #footer>
                <div class="modal-actions">
                    <n-button :disabled="submitting" @click="close">取消</n-button>
                    <n-button type="error" :loading="submitting" @click="handleSubmit">
                        提交申请
                    </n-button>
                </div>
            </template>
        </n-card>
    </n-modal>
</template>

<style scoped>
.policy-alert {
    margin-bottom: var(--ui-space-4);
}

.policy-link {
    color: var(--ui-link-color);
    text-decoration: none;
}

.policy-link:hover {
    color: var(--ui-link-hover-color);
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--ui-space-3);
}
</style>
