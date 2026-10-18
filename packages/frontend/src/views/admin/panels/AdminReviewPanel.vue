<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import {
    NAlert,
    NButton,
    NCard,
    NDataTable,
    NEllipsis,
    NInput,
    NModal,
    NRadioButton,
    NRadioGroup,
    NSpace,
    NSpin,
    NTag,
    useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { RouterLink } from 'vue-router';
import Card from '@/components/Card.vue';
import {
    approveDeletionRequest,
    getAdminDeletionRequests,
    rejectDeletionRequest,
    type AdminDeletionRequestItem,
    type DeletionRequestStatus
} from '@/api/deletion-request.ts';
import { currentAuth } from '@/utils/auth.ts';
import { hasPermission, Permission } from '@/utils/permissions.ts';
import { formatDate } from '@/utils/render';
import { requestErrorMessage } from '@/utils/request.ts';

const message = useMessage();

const canManageContent = computed(() =>
    hasPermission(currentAuth.value?.role, Permission.MANAGE_CONTENT)
);

const statusFilter = ref<DeletionRequestStatus | 'all'>('pending');
const requests = ref<AdminDeletionRequestItem[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const loadError = ref<string | null>(null);
let loadRequestId = 0;

const reviewAction = ref<'approve' | 'reject' | null>(null);
const reviewTarget = ref<AdminDeletionRequestItem | null>(null);
const reviewComment = ref('');
const reviewSubmitting = ref(false);

const STATUS_OPTIONS = [
    { value: 'pending', label: '待审核' },
    { value: 'approved', label: '已通过' },
    { value: 'rejected', label: '已拒绝' },
    { value: 'all', label: '全部' }
] as const;

const pagination = computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
    itemCount: total.value,
    showSizePicker: true,
    pageSizes: [10, 20, 50]
}));

const reviewModalTitle = computed(() => {
    if (!reviewTarget.value) return '';
    const action = reviewAction.value === 'approve' ? '通过' : '拒绝';
    return `${action}删除申请 #${reviewTarget.value.id}`;
});

async function load() {
    if (!canManageContent.value) return;
    const id = ++loadRequestId;
    loading.value = true;
    loadError.value = null;
    try {
        const response = await getAdminDeletionRequests(
            statusFilter.value,
            page.value,
            pageSize.value
        );
        if (id !== loadRequestId) return;
        if (response.code !== 200) {
            loadError.value = '删除申请加载失败，请重试。';
            return;
        }
        requests.value = response.data.requests;
        total.value = response.data.total;
    } catch (error) {
        if (id !== loadRequestId) return;
        loadError.value = requestErrorMessage(error, '删除申请加载失败，请重试。');
    } finally {
        if (id === loadRequestId) loading.value = false;
    }
}

function handleStatusChange() {
    page.value = 1;
    void load();
}

function handlePageChange(nextPage: number) {
    page.value = nextPage;
    void load();
}

function handlePageSizeChange(nextPageSize: number) {
    pageSize.value = nextPageSize;
    page.value = 1;
    void load();
}

function openReviewModal(row: AdminDeletionRequestItem, action: 'approve' | 'reject') {
    reviewTarget.value = row;
    reviewAction.value = action;
    reviewComment.value = '';
}

function closeReviewModal() {
    if (reviewSubmitting.value) return;
    reviewTarget.value = null;
    reviewAction.value = null;
    reviewComment.value = '';
}

async function submitReview() {
    if (!reviewTarget.value || !reviewAction.value) return;
    reviewSubmitting.value = true;
    try {
        const submit =
            reviewAction.value === 'approve' ? approveDeletionRequest : rejectDeletionRequest;
        const response = await submit(reviewTarget.value.id, reviewComment.value.trim());
        if (response.code === 200) {
            message.success(
                reviewAction.value === 'approve' ? '申请已通过，内容已删除' : '申请已拒绝'
            );
            reviewSubmitting.value = false;
            closeReviewModal();
            await load();
            return;
        }
        if (response.code === 409) {
            message.warning('该申请已被其他管理员处理');
            reviewSubmitting.value = false;
            closeReviewModal();
            await load();
            return;
        }
        message.error('审核提交失败，请重试。');
    } catch (error) {
        message.error(requestErrorMessage(error, '审核提交失败，请重试。'));
    } finally {
        reviewSubmitting.value = false;
    }
}

const STATUS_TAG: Record<
    DeletionRequestStatus,
    { type: 'warning' | 'success' | 'error'; label: string }
> = {
    pending: { type: 'warning', label: '待审核' },
    approved: { type: 'success', label: '已通过' },
    rejected: { type: 'error', label: '已拒绝' }
};

const columns = computed<DataTableColumns<AdminDeletionRequestItem>>(() => [
    { title: 'ID', key: 'id', width: 64 },
    {
        title: '目标内容',
        key: 'target',
        minWidth: 180,
        render(row) {
            const path =
                row.targetType === 'article'
                    ? `/article/${row.targetId}`
                    : `/paste/${row.targetId}`;
            const typeLabel = row.targetType === 'article' ? '文章' : '剪贴板';
            const children = [
                h(
                    NSpace,
                    { size: 4, align: 'center', wrapItem: false },
                    {
                        default: () => [
                            h(
                                NTag,
                                { size: 'small', bordered: false },
                                { default: () => typeLabel }
                            ),
                            h(
                                RouterLink,
                                { to: path, class: 'target-link' },
                                { default: () => row.targetId }
                            ),
                            !row.target.exists
                                ? h(
                                      NTag,
                                      { size: 'small', type: 'error' },
                                      { default: () => '不存在' }
                                  )
                                : row.target.deleted
                                  ? h(
                                        NTag,
                                        { size: 'small', type: 'default' },
                                        { default: () => '已删除' }
                                    )
                                  : null
                        ]
                    }
                )
            ];
            if (row.target.title) {
                children.push(
                    h(NEllipsis, { class: 'target-title' }, { default: () => row.target.title })
                );
            }
            return h('div', { class: 'target-cell' }, children);
        }
    },
    {
        title: '申请人',
        key: 'requester',
        minWidth: 140,
        render(row) {
            if (!row.requester) return '已注销';
            return h(
                NSpace,
                { size: 4, align: 'center', wrapItem: false },
                {
                    default: () => [
                        h('span', `${row.requester!.name}（洛谷 UID ${row.requester!.luoguUid}）`),
                        row.requesterIsAuthor
                            ? h(NTag, { size: 'small', type: 'info' }, { default: () => '作者' })
                            : null
                    ]
                }
            );
        }
    },
    {
        title: '申请原因',
        key: 'reason',
        minWidth: 200,
        render(row) {
            return h(
                NEllipsis,
                { 'line-clamp': 2, tooltip: { width: 360 } },
                { default: () => row.reason }
            );
        }
    },
    {
        title: '申请时间',
        key: 'createdAt',
        width: 170,
        render: row => formatDate(row.createdAt)
    },
    {
        title: '状态',
        key: 'status',
        width: 90,
        render(row) {
            const tag = STATUS_TAG[row.status];
            return h(NTag, { size: 'small', type: tag.type }, { default: () => tag.label });
        }
    },
    {
        title: '处理',
        key: 'actions',
        minWidth: 180,
        render(row) {
            if (row.status === 'pending') {
                return h(
                    NSpace,
                    { size: 8, wrapItem: false },
                    {
                        default: () => [
                            h(
                                NButton,
                                {
                                    size: 'small',
                                    type: 'success',
                                    secondary: true,
                                    onClick: () => openReviewModal(row, 'approve')
                                },
                                { default: () => '通过' }
                            ),
                            h(
                                NButton,
                                {
                                    size: 'small',
                                    type: 'error',
                                    secondary: true,
                                    onClick: () => openReviewModal(row, 'reject')
                                },
                                { default: () => '拒绝' }
                            )
                        ]
                    }
                );
            }

            const lines = [
                h(
                    'div',
                    `${row.handler?.name ?? '未知'} · ${row.handledAt ? formatDate(row.handledAt) : ''}`
                )
            ];
            if (row.resolutionComment) {
                lines.push(
                    h(
                        NEllipsis,
                        { 'line-clamp': 1, tooltip: { width: 360 } },
                        { default: () => `备注：${row.resolutionComment}` }
                    )
                );
            }
            return h('div', { class: 'handled-cell' }, lines);
        }
    }
]);

onMounted(() => {
    void load();
});
</script>

<template>
    <Card title="删除申请审核" class="review-card">
        <n-alert v-if="!canManageContent" type="warning" title="缺少 MANAGE_CONTENT">
            你没有内容审核权限。
        </n-alert>

        <n-spin v-else :show="loading">
            <n-space vertical size="large">
                <n-space align="center" justify="space-between">
                    <n-radio-group
                        v-model:value="statusFilter"
                        size="small"
                        @update:value="handleStatusChange"
                    >
                        <n-radio-button
                            v-for="option in STATUS_OPTIONS"
                            :key="option.value"
                            :value="option.value"
                            :label="option.label"
                        />
                    </n-radio-group>
                    <n-button size="small" secondary @click="load">刷新</n-button>
                </n-space>

                <n-alert v-if="loadError" type="error">
                    {{ loadError }}
                    <div class="state-actions">
                        <n-button :disabled="loading" @click="load">重试</n-button>
                    </div>
                </n-alert>
                <n-data-table
                    v-else
                    remote
                    :columns="columns"
                    :data="requests"
                    :pagination="pagination"
                    :row-key="(row: AdminDeletionRequestItem) => row.id"
                    @update:page="handlePageChange"
                    @update:page-size="handlePageSizeChange"
                />
            </n-space>
        </n-spin>
    </Card>

    <n-modal :show="reviewAction !== null" @update:show="value => !value && closeReviewModal()">
        <n-card
            v-if="reviewTarget"
            :bordered="false"
            role="dialog"
            aria-modal="true"
            :title="reviewModalTitle"
            :style="{ width: 'min(520px, calc(100vw - 32px))' }"
        >
            <n-space vertical size="large">
                <n-alert :type="reviewAction === 'approve' ? 'warning' : 'info'" :bordered="true">
                    <template v-if="reviewAction === 'approve'">
                        通过后，{{ reviewTarget.targetType === 'article' ? '文章' : '剪贴板' }}
                        {{ reviewTarget.targetId }} 将被删除，申请人会收到通知。
                    </template>
                    <template v-else> 拒绝后，内容保持不变，申请人会收到通知。 </template>
                </n-alert>

                <n-input
                    v-model:value="reviewComment"
                    type="textarea"
                    placeholder="处理备注（可选，会随通知发送给申请人）"
                    maxlength="500"
                    show-count
                    :autosize="{ minRows: 3, maxRows: 6 }"
                />
            </n-space>

            <template #footer>
                <div class="modal-actions">
                    <n-button :disabled="reviewSubmitting" @click="closeReviewModal">取消</n-button>
                    <n-button
                        :type="reviewAction === 'approve' ? 'success' : 'error'"
                        :loading="reviewSubmitting"
                        @click="submitReview"
                    >
                        确认{{ reviewAction === 'approve' ? '通过' : '拒绝' }}
                    </n-button>
                </div>
            </template>
        </n-card>
    </n-modal>
</template>

<style scoped>
.review-card {
    margin-bottom: var(--ui-space-4);
}

.review-card :deep(.target-link) {
    color: var(--ui-link-color);
    text-decoration: none;
}

.review-card :deep(.target-link:hover) {
    color: var(--ui-link-hover-color);
}

.review-card :deep(.target-cell),
.review-card :deep(.handled-cell) {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-1);
}

.review-card :deep(.target-title) {
    max-width: 220px;
}

.state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin-top: var(--ui-space-3);
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--ui-space-3);
}
</style>
