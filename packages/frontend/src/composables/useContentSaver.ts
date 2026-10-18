import { ref, onUnmounted } from 'vue';
import { useDialog, useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import socket from '@/utils/websocket';
import { requestErrorMessage } from '@/utils/request';

export function useContentSaver() {
    const dialog = useDialog();
    const message = useMessage();
    const router = useRouter();
    const isSaving = ref(false);
    const hasUpdate = ref(false);
    const cleanupCallbacks = new Set<() => void>();
    let updateDialogOpen = false;

    const addCleanup = (cleanup: () => void) => {
        cleanupCallbacks.add(cleanup);
    };

    const openWorkflowTracker = (workflowId: string) => {
        const { href } = router.resolve({ name: 'workflow-tracker', params: { id: workflowId } });
        const newWindow = window.open(href, '_blank', 'noopener,noreferrer');
        if (newWindow) newWindow.opener = null;
    };

    const notifyWorkflowSubmitted = (response: any, title = '保存任务已提交') => {
        const workflowId = response?.data?.workflowId;
        if (!workflowId) {
            message.success(title);
            return;
        }

        dialog.success({
            title,
            content: `工作流 ${workflowId} 已创建。`,
            positiveText: '跟踪工作流',
            negativeText: '留在当前页',
            onPositiveClick: () => openWorkflowTracker(workflowId)
        });
    };

    onUnmounted(() => {
        for (const cleanup of cleanupCallbacks) {
            cleanup();
        }
        cleanupCallbacks.clear();
    });

    const handle404 = (saveAction: () => Promise<any>, onCancel?: () => void) => {
        dialog.warning({
            title: '内容未找到',
            content: '该内容尚未被收录，是否立即保存？',
            positiveText: '立即保存',
            negativeText: '返回',
            closable: false,
            closeOnEsc: false,
            maskClosable: false,
            onPositiveClick: async () => {
                try {
                    isSaving.value = true;
                    const res = await saveAction();
                    notifyWorkflowSubmitted(res);
                } catch (e) {
                    message.error(requestErrorMessage(e, '保存请求提交失败，请重试。'));
                    isSaving.value = false;
                }
            },
            onNegativeClick: () => {
                if (onCancel) onCancel();
                else router.back();
            }
        });
    };

    const stopSaving = () => {
        isSaving.value = false;
    };

    const setupUpdateListener = (
        room: string,
        event: string,
        onRefresh: () => void,
        shouldPrompt: () => boolean = () => true
    ) => {
        socket.joinRoom(room);

        const handleUpdate = () => {
            stopSaving();
            if (!shouldPrompt()) {
                hasUpdate.value = false;
                onRefresh();
                return;
            }

            hasUpdate.value = true;
            if (updateDialogOpen) return;
            updateDialogOpen = true;
            dialog.info({
                title: '内容已更新',
                content: '检测到当前内容有新的版本，是否立即刷新页面以查看最新内容？',
                positiveText: '刷新',
                negativeText: '稍后',
                onPositiveClick: () => {
                    updateDialogOpen = false;
                    hasUpdate.value = false;
                    onRefresh();
                },
                onNegativeClick: () => {
                    updateDialogOpen = false;
                }
            });
        };

        socket.getInstance().on(event, handleUpdate);

        const cleanup = () => {
            socket.getInstance().off(event, handleUpdate);
            socket.leaveRoom(room);
            cleanupCallbacks.delete(cleanup);
        };

        addCleanup(cleanup);
        return cleanup;
    };

    const setupTaskUpdateListener = (
        taskId: string,
        onComplete: (data?: any) => void,
        onFail: (error: string) => void
    ) => {
        if (!taskId) return () => {};

        const roomId = `task:${taskId}`;
        const completeEvent = `task:${taskId}:completed`;
        const failEvent = `task:${taskId}:failed`;
        socket.joinRoom(roomId);

        let active = true;
        socket.getInstance().on(completeEvent, handleComplete);
        socket.getInstance().on(failEvent, handleFail);

        addCleanup(cleanup);
        return cleanup;

        function cleanup() {
            if (!active) return;
            active = false;
            socket.getInstance().off(completeEvent, handleComplete);
            socket.getInstance().off(failEvent, handleFail);
            socket.leaveRoom(roomId);
            cleanupCallbacks.delete(cleanup);
        }

        function handleComplete(data?: any) {
            stopSaving();
            onComplete(data);
            cleanup();
        }

        function handleFail(data: { error: string }) {
            stopSaving();
            onFail(data.error);
            cleanup();
        }
    };

    const handleRefresh = (onRefresh: () => void) => {
        hasUpdate.value = false;
        onRefresh();
    };

    return {
        isSaving,
        hasUpdate,
        handle404,
        stopSaving,
        setupUpdateListener,
        setupTaskUpdateListener,
        handleRefresh,
        notifyWorkflowSubmitted,
        openWorkflowTracker
    };
}
