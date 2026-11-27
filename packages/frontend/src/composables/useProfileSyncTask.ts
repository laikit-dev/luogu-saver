import { ref } from 'vue';

export interface PendingProfileSyncTask {
    uid: number;
    taskId: string;
}

export const pendingProfileSyncTask = ref<PendingProfileSyncTask | null>(null);

export function setPendingProfileSyncTask(uid: number, taskId: string) {
    pendingProfileSyncTask.value = { uid, taskId };
}

export function consumePendingProfileSyncTask(uid: number): PendingProfileSyncTask | null {
    const pending = pendingProfileSyncTask.value;
    if (!pending || pending.uid !== uid) return null;
    pendingProfileSyncTask.value = null;
    return pending;
}
