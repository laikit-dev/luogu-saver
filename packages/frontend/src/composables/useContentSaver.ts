import { h, ref, onUnmounted } from 'vue';
import {
    NButton,
    NCheckbox,
    useDialog,
    useMessage,
    type DialogReactive,
    type MessageReactive
} from 'naive-ui';
import { useRoute, useRouter } from 'vue-router';
import { useLocalStorage } from '@/composables/useLocalStorage';
import { GUEST_SAVE_PROMPT_DISMISSED_STORAGE_KEY } from '@/utils/constants';
import { currentAuthState, isAuthenticated, startCpOAuthLogin } from '@/utils/auth';
import socket from '@/utils/websocket';
import { requestErrorMessage } from '@/utils/request';
import { goBackIgnoringHash } from '@/utils/navigation-history';
export function useContentSaver() {
    const dialog = useDialog();
    const message = useMessage();
    const route = useRoute();
    const router = useRouter();
    const guestSavePromptDismissed = useLocalStorage(
        GUEST_SAVE_PROMPT_DISMISSED_STORAGE_KEY,
        false
    );
    const SELF_UPDATE_ABSORB_MS = 4000;
    const isSaving = ref(false);
    const hasUpdate = ref(false);
    const cleanupCallbacks = new Set<() => void>();
    let disposed = false;
    let saveRequestPending = false;
    let cancelGuestSave: (() => void) | null = null;
    let missingDialog: DialogReactive | null = null;
    let activeStatusToast: MessageReactive | null = null;
    let activeUpdateToast: MessageReactive | null = null;
    let activeTaskId: string | null = null;
    let refreshedByUpdateForTaskId: string | null = null;
    let suppressUpdateUntil = 0;

    const dismissStatusToast = () => {
        activeStatusToast?.destroy();
        activeStatusToast = null;
    };

    const dismissUpdateToast = () => {
        activeUpdateToast?.destroy();
        activeUpdateToast = null;
    };

    const confirmGuestSave = (): Promise<boolean> => {
        if (
            (isAuthenticated.value && currentAuthState.value !== 'expired') ||
            guestSavePromptDismissed.value === true
        ) {
            return Promise.resolve(true);
        }

        return new Promise(resolve => {
            const rememberChoice = ref(false);
            let settled = false;
            let prompt: DialogReactive | null = null;
            const finish = (confirmed: boolean) => {
                if (settled) return false;
                settled = true;
                if (confirmed && rememberChoice.value) guestSavePromptDismissed.value = true;
                cancelGuestSave = null;
                prompt?.destroy();
                resolve(confirmed);
                return true;
            };

            cancelGuestSave = () => {
                finish(false);
            };
            prompt = dialog.info({
                title: '登录后提交可优先排队',
                closeFocusable: true,
                content: () =>
                    h('div', { style: { display: 'grid', gap: 'var(--ui-space-4)' } }, [
                        h(
                            'p',
                            { style: { margin: '0' } },
                            '排队时，登录用户的保存请求优先于未登录用户的请求。您也可以继续以未登录身份保存。'
                        ),
                        h(NCheckbox, {
                            checked: rememberChoice.value,
                            label: '不再提示',
                            onUpdateChecked: checked => {
                                rememberChoice.value = checked === true;
                            }
                        })
                    ]),
                action: () =>
                    h(
                        'div',
                        {
                            style: {
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'flex-end',
                                gap: 'var(--ui-inline-gap)',
                                minWidth: '0'
                            }
                        },
                        [
                            h(NButton, { onClick: () => finish(false) }, () => '取消'),
                            h(NButton, { onClick: () => finish(true) }, () => '继续保存'),
                            h(
                                NButton,
                                {
                                    type: 'primary',
                                    onClick: () => {
                                        if (finish(false)) startCpOAuthLogin(route.fullPath);
                                    }
                                },
                                () => '使用 CP OAuth 登录'
                            )
                        ]
                    ),
                onClose: () => {
                    finish(false);
                },
                onEsc: () => {
                    finish(false);
                },
                onMaskClick: () => {
                    finish(false);
                },
                onAfterLeave: () => {
                    finish(false);
                }
            });
        });
    };

    const requestSave = async <T>(saveAction: () => Promise<T>): Promise<T | null> => {
        if (disposed || saveRequestPending) return null;
        saveRequestPending = true;
        try {
            if (!(await confirmGuestSave()) || disposed) return null;
            return await saveAction();
        } finally {
            saveRequestPending = false;
        }
    };

    const addCleanup = (cleanup: () => void) => {
        cleanupCallbacks.add(cleanup);
    };

    const openWorkflowTracker = (workflowId: string) => {
        const { href } = router.resolve({ name: 'workflow-tracker', params: { id: workflowId } });
        const newWindow = window.open(href, '_blank', 'noopener,noreferrer');
        if (newWindow) newWindow.opener = null;
    };

    const notifyWorkflowSubmitted = (response: any, title = '正在保存…') => {
        dismissStatusToast();
        const workflowId = response?.data?.workflowId;
        if (!workflowId) {
            activeStatusToast = message.success(title, {
                duration: 3000,
                closable: true
            });
            return;
        }

        const toast = message.loading(
            () =>
                h(
                    'span',
                    {
                        style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '10px'
                        }
                    },
                    [
                        h('span', title),
                        h(
                            NButton,
                            {
                                text: true,
                                type: 'primary',
                                size: 'small',
                                style: { fontWeight: '600' },
                                onClick: () => {
                                    if (activeStatusToast === toast) {
                                        dismissStatusToast();
                                    } else {
                                        toast.destroy();
                                    }
                                    openWorkflowTracker(workflowId);
                                }
                            },
                            () => '跟踪工作流'
                        )
                    ]
                ),
            {
                duration: 0,
                closable: true,
                keepAliveOnHover: true,
                onAfterLeave: () => {
                    if (activeStatusToast === toast) activeStatusToast = null;
                }
            }
        );
        activeStatusToast = toast;
    };

    const notifySaveCompleted = (text = '保存完成') => {
        dismissStatusToast();
        dismissUpdateToast();
        message.success(text, {
            duration: 3000,
            closable: true
        });
    };

    onUnmounted(() => {
        disposed = true;
        cancelGuestSave?.();
        missingDialog?.destroy();
        missingDialog = null;
        dismissStatusToast();
        dismissUpdateToast();
        for (const cleanup of cleanupCallbacks) {
            cleanup();
        }
        cleanupCallbacks.clear();
    });

    const handle404 = (saveAction: () => Promise<any>, onCancel?: () => void) => {
        if (disposed || missingDialog || saveRequestPending || isSaving.value) return;

        const submitMissing = async () => {
            try {
                const res = await requestSave(async () => {
                    isSaving.value = true;
                    return await saveAction();
                });
                if (res !== null) notifyWorkflowSubmitted(res);
            } catch (e) {
                message.error(requestErrorMessage(e, '保存请求提交失败'));
                isSaving.value = false;
            }
        };

        const prompt = dialog.warning({
            title: '内容未找到',
            content: '该内容尚未被收录，是否立即保存？',
            positiveText: '立即保存',
            negativeText: '返回',
            closable: false,
            closeOnEsc: false,
            maskClosable: false,
            onPositiveClick: () => {
                prompt.destroy();
                void submitMissing();
            },
            onNegativeClick: () => {
                if (onCancel) onCancel();
                else goBackIgnoringHash(router);
            },
            onAfterLeave: () => {
                if (missingDialog === prompt) missingDialog = null;
            }
        });
        missingDialog = prompt;
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
            if (Date.now() < suppressUpdateUntil) {
                suppressUpdateUntil = 0;
                return;
            }

            if (activeTaskId) {
                refreshedByUpdateForTaskId = activeTaskId;
                hasUpdate.value = false;
                stopSaving();
                dismissStatusToast();
                dismissUpdateToast();
                onRefresh();
                return;
            }

            if (!shouldPrompt()) {
                hasUpdate.value = false;
                stopSaving();
                dismissStatusToast();
                dismissUpdateToast();
                onRefresh();
                return;
            }

            stopSaving();
            hasUpdate.value = true;
            dismissUpdateToast();
            const toast = message.info(
                () =>
                    h(
                        'span',
                        {
                            style: {
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '10px'
                            }
                        },
                        [
                            h('span', '内容有新版本'),
                            h(
                                NButton,
                                {
                                    text: true,
                                    type: 'primary',
                                    size: 'small',
                                    style: { fontWeight: '600' },
                                    onClick: () => {
                                        if (activeUpdateToast === toast) {
                                            dismissUpdateToast();
                                        } else {
                                            toast.destroy();
                                        }
                                        hasUpdate.value = false;
                                        onRefresh();
                                    }
                                },
                                () => '立即刷新'
                            )
                        ]
                    ),
                {
                    duration: 8000,
                    closable: true,
                    keepAliveOnHover: true,
                    onAfterLeave: () => {
                        if (activeUpdateToast === toast) activeUpdateToast = null;
                    }
                }
            );
            activeUpdateToast = toast;
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
        onComplete: (data?: any, meta?: { alreadyRefreshed: boolean }) => void,
        onFail: (error: string) => void
    ) => {
        if (!taskId) return () => {};

        const roomId = `task:${taskId}`;
        const completeEvent = `task:${taskId}:completed`;
        const failEvent = `task:${taskId}:failed`;
        activeTaskId = taskId;
        refreshedByUpdateForTaskId = null;
        socket.joinRoom(roomId);

        let active = true;
        socket.getInstance().on(completeEvent, handleComplete);
        socket.getInstance().on(failEvent, handleFail);

        addCleanup(cleanup);
        return cleanup;

        function clearTaskTracking() {
            if (activeTaskId === taskId) activeTaskId = null;
            if (refreshedByUpdateForTaskId === taskId) refreshedByUpdateForTaskId = null;
        }

        function cleanup() {
            if (!active) return;
            active = false;
            clearTaskTracking();
            socket.getInstance().off(completeEvent, handleComplete);
            socket.getInstance().off(failEvent, handleFail);
            socket.leaveRoom(roomId);
            cleanupCallbacks.delete(cleanup);
        }

        function handleComplete(data?: any) {
            const alreadyRefreshed = refreshedByUpdateForTaskId === taskId;
            clearTaskTracking();
            suppressUpdateUntil = Date.now() + SELF_UPDATE_ABSORB_MS;
            stopSaving();
            dismissStatusToast();
            onComplete(data, { alreadyRefreshed });
            cleanup();
        }

        function handleFail(data: { error: string }) {
            clearTaskTracking();
            stopSaving();
            dismissStatusToast();
            onFail(data.error);
            cleanup();
        }
    };

    const handleRefresh = (onRefresh: () => void) => {
        dismissUpdateToast();
        hasUpdate.value = false;
        onRefresh();
    };

    return {
        isSaving,
        hasUpdate,
        requestSave,
        handle404,
        stopSaving,
        setupUpdateListener,
        setupTaskUpdateListener,
        handleRefresh,
        notifyWorkflowSubmitted,
        notifySaveCompleted,
        openWorkflowTracker
    };
}
