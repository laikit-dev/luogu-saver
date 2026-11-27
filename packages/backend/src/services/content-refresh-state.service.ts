import { emitToRoom } from '@/lib/socket';
import { SaveTarget, TaskType } from '@/shared/task';

export const CONTENT_REFRESH_STALE_TTL_MS = 15 * 60 * 1000;

export type ContentRefreshTarget =
    | SaveTarget.ARTICLE
    | SaveTarget.COMMENTS
    | SaveTarget.PASTE
    | SaveTarget.PROFILE;

export interface ContentRefreshStatePayload {
    refreshing: boolean;
    activeCount: number;
}

export interface RoomReplayEvent {
    event: string;
    state: ContentRefreshStatePayload;
}

interface TargetDescriptor {
    key: string;
    room: string;
    event: string;
}

const TARGET_ROUTES: Record<
    ContentRefreshTarget,
    (targetId: string) => { room: string; event: string }
> = {
    [SaveTarget.ARTICLE]: targetId => ({
        room: `article_${targetId}`,
        event: `article:${targetId}:refresh-state`
    }),
    [SaveTarget.COMMENTS]: targetId => ({
        room: `article_${targetId}`,
        event: `article:${targetId}:comments-refresh-state`
    }),
    [SaveTarget.PASTE]: targetId => ({
        room: `paste_${targetId}`,
        event: `paste:${targetId}:refresh-state`
    }),
    [SaveTarget.PROFILE]: targetId => ({
        room: `user_${targetId}`,
        event: `user:${targetId}:profile-refresh-state`
    })
};

const activeTasksByTarget = new Map<string, Map<string, number>>();

function resolveDescriptor(
    type: unknown,
    payload: { target?: unknown; targetId?: unknown } | null | undefined
): TargetDescriptor | null {
    if (type !== TaskType.SAVE || !payload) return null;
    const target = payload.target as ContentRefreshTarget | undefined;
    if (!target || !Object.prototype.hasOwnProperty.call(TARGET_ROUTES, target)) {
        return null;
    }
    const targetId = payload.targetId != null ? String(payload.targetId).trim() : '';
    if (!targetId) return null;
    const route = TARGET_ROUTES[target](targetId);
    return {
        key: `${target}:${targetId}`,
        room: route.room,
        event: route.event
    };
}

function pruneExpired(tasks: Map<string, number>, now: number): number {
    let pruned = 0;
    for (const [taskId, timestamp] of tasks) {
        if (now - timestamp > CONTENT_REFRESH_STALE_TTL_MS) {
            tasks.delete(taskId);
            pruned += 1;
        }
    }
    return pruned;
}

function toPayload(activeCount: number): ContentRefreshStatePayload {
    return {
        refreshing: activeCount > 0,
        activeCount
    };
}

export class ContentRefreshStateService {
    static markActive(
        taskId: string | undefined | null,
        type: unknown,
        payload: { target?: unknown; targetId?: unknown } | null | undefined,
        now = Date.now()
    ) {
        const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
        if (!normalizedTaskId) return;
        const descriptor = resolveDescriptor(type, payload);
        if (!descriptor) return;

        let tasks = activeTasksByTarget.get(descriptor.key);
        if (!tasks) {
            tasks = new Map<string, number>();
            activeTasksByTarget.set(descriptor.key, tasks);
        }

        const pruned = pruneExpired(tasks, now);
        const existed = tasks.has(normalizedTaskId);
        tasks.set(normalizedTaskId, now);

        if (!existed || pruned > 0) {
            emitToRoom(descriptor.room, descriptor.event, toPayload(tasks.size));
        }
    }

    static markInactive(
        taskId: string | undefined | null,
        type: unknown,
        payload: { target?: unknown; targetId?: unknown } | null | undefined,
        now = Date.now()
    ) {
        const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
        if (!normalizedTaskId) return;
        const descriptor = resolveDescriptor(type, payload);
        if (!descriptor) return;

        const tasks = activeTasksByTarget.get(descriptor.key);
        if (!tasks) return;

        const pruned = pruneExpired(tasks, now);
        const deleted = tasks.delete(normalizedTaskId);
        const remainingCount = tasks.size;
        if (remainingCount === 0) {
            activeTasksByTarget.delete(descriptor.key);
        }

        if (deleted || pruned > 0) {
            emitToRoom(descriptor.room, descriptor.event, toPayload(remainingCount));
        }
    }

    static getState(
        target: ContentRefreshTarget,
        targetId: string,
        now = Date.now()
    ): ContentRefreshStatePayload {
        const normalizedId = String(targetId || '').trim();
        if (!normalizedId) return toPayload(0);

        const key = `${target}:${normalizedId}`;
        const tasks = activeTasksByTarget.get(key);
        if (!tasks) return toPayload(0);

        pruneExpired(tasks, now);
        if (tasks.size === 0) {
            activeTasksByTarget.delete(key);
            return toPayload(0);
        }
        return toPayload(tasks.size);
    }

    static getRoomReplayEvents(room: string, now = Date.now()): RoomReplayEvent[] {
        const articleMatch = /^article_(.+)$/.exec(room);
        if (articleMatch) {
            const id = articleMatch[1];
            return [
                {
                    event: TARGET_ROUTES[SaveTarget.ARTICLE](id).event,
                    state: this.getState(SaveTarget.ARTICLE, id, now)
                },
                {
                    event: TARGET_ROUTES[SaveTarget.COMMENTS](id).event,
                    state: this.getState(SaveTarget.COMMENTS, id, now)
                }
            ];
        }

        const pasteMatch = /^paste_(.+)$/.exec(room);
        if (pasteMatch) {
            const id = pasteMatch[1];
            return [
                {
                    event: TARGET_ROUTES[SaveTarget.PASTE](id).event,
                    state: this.getState(SaveTarget.PASTE, id, now)
                }
            ];
        }

        const userMatch = /^user_(.+)$/.exec(room);
        if (userMatch) {
            const uid = userMatch[1];
            return [
                {
                    event: TARGET_ROUTES[SaveTarget.PROFILE](uid).event,
                    state: this.getState(SaveTarget.PROFILE, uid, now)
                }
            ];
        }

        return [];
    }

    static reset() {
        activeTasksByTarget.clear();
    }
}
