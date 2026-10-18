import { Server, Socket } from 'socket.io';
import http from 'http';
import { logger } from './logger';
import { RegisteredUserService } from '@/services/registered-user.service';
import { ROLE_ADMIN } from '@/shared/permission';

let io: Server | null = null;

export type SocketJoinResult = {
    allowed?: boolean;
    error?: string;
    afterJoin?: () => Promise<void>;
};

export type SocketUser = {
    id: number;
    role: number;
};

export function initSocket(
    server: http.Server,
    joinRoomCallback?: (socket: Socket, room: string) => Promise<SocketJoinResult | void>
): Server {
    io = new Server(server, {
        path: '/websocket',
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.use(async (socket, next) => {
        const token =
            typeof socket.handshake.auth?.token === 'string'
                ? socket.handshake.auth.token.trim()
                : '';
        if (!token) {
            next();
            return;
        }

        try {
            const user = await RegisteredUserService.validateBearerToken(token);
            if (!user) {
                next(new Error('Unauthorized'));
                return;
            }
            socket.data.user = { id: user.id, role: user.role } satisfies SocketUser;
            next();
        } catch (error) {
            logger.error({ error }, 'Socket token validation failed');
            next(new Error('Unauthorized'));
        }
    });

    io.on('connection', async (socket: Socket) => {
        logger.info({ id: socket.id, userId: socket.data.user?.id ?? null }, 'Client connected');

        socket.on('join', async (room: string) => {
            let result: SocketJoinResult | void = undefined;
            if (joinRoomCallback) {
                try {
                    result = await joinRoomCallback(socket, room);
                } catch (error) {
                    logger.error({ error, id: socket.id, room }, 'Error in joinRoomCallback');
                    socket.emit('join:error', { room, message: 'Failed to join room' });
                    return;
                }
            }
            if (result?.allowed === false) {
                socket.emit('join:error', { room, message: result.error || 'Permission denied' });
                logger.warn({ id: socket.id, room }, 'Client rejected from room');
                return;
            }

            socket.join(room);
            logger.info({ id: socket.id, room }, 'Client joined room');
            if (result?.afterJoin) await result.afterJoin();
        });

        socket.on('leave', (room: string) => {
            socket.leave(room);
            socket.emit(`leave:${room}`);
            logger.info({ id: socket.id, room }, 'Client left room');
        });

        socket.on('disconnect', () => {
            logger.info({ id: socket.id }, 'Client disconnected');
        });
    });

    return io;
}

export function socketHasPermission(socket: Socket, permissionBit: number) {
    const user = socket.data.user as SocketUser | undefined;
    if (!user) return false;
    if (user.role === ROLE_ADMIN) return true;
    return (user.role & permissionBit) === permissionBit;
}

export function emitToRoom(room: string, event: string, data: any = {}) {
    if (!io) {
        logger.warn('Socket.io not initialized, skipping emit');
        return;
    }
    logger.debug({ room, event, data }, 'Emitting event to room');
    io.to(room).emit(event, data);
}

export function getIo() {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
}
