import { Socket } from 'socket.io';
import { handleTaskRoomJoin } from './handlers/task.handler';
import type { SocketJoinResult } from '@/lib/socket';
import { logger } from '@/lib/logger';
import {
    QueueStatsBroadcaster,
    QUEUE_STATS_ROOM
} from '@/services/queue-stats-broadcaster.service';

export async function socketJoinHandler(socket: Socket, room: string): Promise<SocketJoinResult> {
    if (room === QUEUE_STATS_ROOM) {
        return { afterJoin: () => QueueStatsBroadcaster.handleJoin(socket) };
    }

    const [type, id] = room.split(':');

    if (!type || !id) return {};

    switch (type) {
        case 'task':
            return { afterJoin: () => handleTaskRoomJoin(socket, id) };
        default:
            logger.debug({ room }, 'No specialized handler for this room type');
            return {};
    }
}
