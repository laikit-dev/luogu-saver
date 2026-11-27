import type { Socket } from 'socket.io';
import { ContentRefreshStateService } from '@/services/content-refresh-state.service';

const CONTENT_ROOM_RE = /^(article|paste|user)_(.+)$/;

export function isContentRoom(room: string): boolean {
    return CONTENT_ROOM_RE.test(room);
}

export async function handleContentRoomJoin(socket: Socket, room: string) {
    const events = ContentRefreshStateService.getRoomReplayEvents(room);
    for (const { event, state } of events) {
        socket.emit(event, state);
    }
}
