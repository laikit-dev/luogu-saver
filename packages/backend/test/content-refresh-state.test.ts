import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    emitToRoom: vi.fn()
}));

vi.mock('@/lib/socket', () => ({
    emitToRoom: mocks.emitToRoom
}));

vi.mock('@/services/queue-stats-broadcaster.service', () => ({
    QUEUE_STATS_ROOM: 'stats:queues',
    QueueStatsBroadcaster: { handleJoin: vi.fn() }
}));

vi.mock('@/socket/handlers/task.handler', () => ({
    handleTaskRoomJoin: vi.fn()
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import {
    CONTENT_REFRESH_STALE_TTL_MS,
    ContentRefreshStateService
} from '../src/services/content-refresh-state.service';
import { handleContentRoomJoin } from '../src/socket/handlers/content-room.handler';
import { socketJoinHandler } from '../src/socket';
import { SaveTarget, TaskType } from '../src/shared/task';

describe('ContentRefreshStateService and content room replay', () => {
    beforeEach(() => {
        ContentRefreshStateService.reset();
        vi.clearAllMocks();
    });

    it('tracks article, comments, paste, and profile save tasks and emits room updates', () => {
        const cases = [
            {
                target: SaveTarget.ARTICLE,
                targetId: 'abc12345',
                room: 'article_abc12345',
                event: 'article:abc12345:refresh-state'
            },
            {
                target: SaveTarget.COMMENTS,
                targetId: 'abc12345',
                room: 'article_abc12345',
                event: 'article:abc12345:comments-refresh-state'
            },
            {
                target: SaveTarget.PASTE,
                targetId: 'pst99999',
                room: 'paste_pst99999',
                event: 'paste:pst99999:refresh-state'
            },
            {
                target: SaveTarget.PROFILE,
                targetId: '42',
                room: 'user_42',
                event: 'user:42:profile-refresh-state'
            }
        ];

        for (const item of cases) {
            ContentRefreshStateService.markActive(
                `t-${item.target}`,
                TaskType.SAVE,
                { target: item.target, targetId: item.targetId },
                1000
            );
            expect(mocks.emitToRoom).toHaveBeenLastCalledWith(item.room, item.event, {
                refreshing: true,
                activeCount: 1
            });

            ContentRefreshStateService.markInactive(
                `t-${item.target}`,
                TaskType.SAVE,
                { target: item.target, targetId: item.targetId },
                1005
            );
            expect(mocks.emitToRoom).toHaveBeenLastCalledWith(item.room, item.event, {
                refreshing: false,
                activeCount: 0
            });
        }
    });

    it('handles overlapping tasks and ignores duplicate markActive calls without redundant emits', () => {
        ContentRefreshStateService.markActive(
            't1',
            TaskType.SAVE,
            { target: SaveTarget.ARTICLE, targetId: 'art1' },
            1000
        );
        ContentRefreshStateService.markActive(
            't1',
            TaskType.SAVE,
            { target: SaveTarget.ARTICLE, targetId: 'art1' },
            1001
        );
        expect(mocks.emitToRoom).toHaveBeenCalledTimes(1);

        ContentRefreshStateService.markActive(
            't2',
            TaskType.SAVE,
            { target: SaveTarget.ARTICLE, targetId: 'art1' },
            1002
        );
        expect(mocks.emitToRoom).toHaveBeenLastCalledWith(
            'article_art1',
            'article:art1:refresh-state',
            { refreshing: true, activeCount: 2 }
        );

        ContentRefreshStateService.markInactive(
            't1',
            TaskType.SAVE,
            { target: SaveTarget.ARTICLE, targetId: 'art1' },
            1003
        );
        expect(mocks.emitToRoom).toHaveBeenLastCalledWith(
            'article_art1',
            'article:art1:refresh-state',
            { refreshing: true, activeCount: 1 }
        );

        ContentRefreshStateService.markInactive(
            't2',
            TaskType.SAVE,
            { target: SaveTarget.ARTICLE, targetId: 'art1' },
            1004
        );
        expect(mocks.emitToRoom).toHaveBeenLastCalledWith(
            'article_art1',
            'article:art1:refresh-state',
            { refreshing: false, activeCount: 0 }
        );
    });

    it('ignores non-SAVE tasks, untracked targets, and empty identifiers', () => {
        ContentRefreshStateService.markActive('t1', TaskType.LLM, {
            target: 'summary',
            targetId: 'art1'
        });
        ContentRefreshStateService.markActive('t2', TaskType.SAVE, {
            target: SaveTarget.JUDGEMENT,
            targetId: 'j1'
        });
        ContentRefreshStateService.markActive('', TaskType.SAVE, {
            target: SaveTarget.ARTICLE,
            targetId: 'art1'
        });
        ContentRefreshStateService.markActive('t3', TaskType.SAVE, {
            target: SaveTarget.ARTICLE,
            targetId: '   '
        });
        expect(mocks.emitToRoom).not.toHaveBeenCalled();
    });

    it('prunes expired entries after 15 minutes', () => {
        const start = 10_000;
        ContentRefreshStateService.markActive(
            'stale-task',
            TaskType.SAVE,
            { target: SaveTarget.PASTE, targetId: 'p1' },
            start
        );

        const expiredNow = start + CONTENT_REFRESH_STALE_TTL_MS + 1;
        expect(ContentRefreshStateService.getState(SaveTarget.PASTE, 'p1', expiredNow)).toEqual({
            refreshing: false,
            activeCount: 0
        });
    });

    it('replays current refresh states directly to joining sockets via handleContentRoomJoin and socketJoinHandler', async () => {
        ContentRefreshStateService.markActive('t-art', TaskType.SAVE, {
            target: SaveTarget.ARTICLE,
            targetId: 'art7'
        });
        ContentRefreshStateService.markActive('t-prof', TaskType.SAVE, {
            target: SaveTarget.PROFILE,
            targetId: '99'
        });

        const fakeSocket = { emit: vi.fn() } as any;

        const articleJoin = await socketJoinHandler(fakeSocket, 'article_art7');
        expect(typeof articleJoin.afterJoin).toBe('function');
        await articleJoin.afterJoin?.();
        expect(fakeSocket.emit).toHaveBeenCalledWith('article:art7:refresh-state', {
            refreshing: true,
            activeCount: 1
        });
        expect(fakeSocket.emit).toHaveBeenCalledWith('article:art7:comments-refresh-state', {
            refreshing: false,
            activeCount: 0
        });

        fakeSocket.emit.mockClear();
        await handleContentRoomJoin(fakeSocket, 'paste_p9');
        expect(fakeSocket.emit).toHaveBeenCalledWith('paste:p9:refresh-state', {
            refreshing: false,
            activeCount: 0
        });

        fakeSocket.emit.mockClear();
        const userJoin = await socketJoinHandler(fakeSocket, 'user_99');
        await userJoin.afterJoin?.();
        expect(fakeSocket.emit).toHaveBeenCalledWith('user:99:profile-refresh-state', {
            refreshing: true,
            activeCount: 1
        });
    });
});
