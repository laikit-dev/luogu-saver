import { In } from 'typeorm';
import { SiteNotification, type SiteNotificationChannel } from '@/entities/site-notification';
import { NotificationReadState } from '@/entities/notification-read-state';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { sanitizeSiteHtml } from '@/utils/html-sanitizer';
export type NotificationChannel = SiteNotificationChannel;

type SiteNotificationInput = {
    id?: unknown;
    channel?: unknown;
    title?: unknown;
    content?: unknown;
    enabled?: unknown;
    loginOnly?: unknown;
    sortOrder?: unknown;
};

type ReplaceNotificationsInput = {
    notifications?: unknown;
};

type AdminNotificationItem = {
    id: number;
    channel: NotificationChannel;
    title: string;
    content: string;
    enabled: boolean;
    loginOnly: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
};

type CurrentNotificationItem = {
    id: number;
    channel: NotificationChannel;
    title: string;
    content: string;
    loginOnly: boolean;
    sortOrder: number;
    updatedAt: Date;
    read: boolean;
};

type NormalizedNotificationInput = {
    id: number | null;
    channel: NotificationChannel;
    title: string;
    content: string;
    enabled: boolean;
    loginOnly: boolean;
    sortOrder: number;
};

export class SiteNotificationService {
    static async getAdminNotifications(): Promise<AdminNotificationItem[]> {
        const rows = await this.findOrderedNotifications();
        return rows.map(row => this.toAdminItem(row));
    }

    static async replaceAdminNotifications(
        input: ReplaceNotificationsInput
    ): Promise<AdminNotificationItem[]> {
        if (!Array.isArray(input.notifications)) {
            throw Object.assign(new Error('notifications must be an array'), { status: 400 });
        }

        const normalized = input.notifications.map(item => this.normalizeInput(item));

        await SiteNotification.transaction(async manager => {
            const notificationRepository = getServiceRepository<SiteNotification>(
                SiteNotification,
                manager
            );
            const readStateRepository = getServiceRepository<NotificationReadState>(
                NotificationReadState,
                manager
            );
            const existing = await notificationRepository.find();
            const existingById = new Map(existing.map(row => [row.id, row]));
            const keptIds = new Set<number>();

            for (const item of normalized) {
                const notification =
                    item.id && existingById.has(item.id)
                        ? existingById.get(item.id)!
                        : notificationRepository.create();

                const changed = this.applyNotificationInput(notification, item);
                if (!notification.id || changed) {
                    await notificationRepository.save(notification);
                }
                keptIds.add(notification.id);
            }

            const deleteIds = existing.map(row => row.id).filter(id => !keptIds.has(id));
            if (deleteIds.length > 0) {
                await readStateRepository.delete({ notificationId: In(deleteIds) });
                await notificationRepository.delete(deleteIds);
            }
        });

        return await this.getAdminNotifications();
    }

    static async getCurrentNotifications(userId?: number): Promise<{
        banners: CurrentNotificationItem[];
        popups: CurrentNotificationItem[];
    }> {
        const rows = await this.findOrderedNotifications();
        const visibleRows = rows.filter(row => row.enabled && (!row.loginOnly || userId));
        const readStates = userId ? await this.getReadStates(userId) : new Map<number, Date>();
        const items = visibleRows.map(row => this.toCurrentItem(row, userId, readStates));

        return {
            banners: items.filter(item => item.channel === 'banner'),
            popups: items.filter(item => item.channel === 'popup')
        };
    }

    static async markNotificationRead(
        userId: number,
        notificationId: number,
        expectedUpdatedAt?: unknown
    ) {
        if (!Number.isInteger(notificationId) || notificationId <= 0) {
            throw Object.assign(new Error('Valid notificationId is required'), { status: 400 });
        }

        const notification = await getServiceRepository<SiteNotification>(SiteNotification).findOne(
            {
                where: { id: notificationId }
            }
        );
        if (!notification) {
            throw Object.assign(new Error('Notification not found'), { status: 404 });
        }

        if (
            expectedUpdatedAt !== undefined &&
            !this.isSameTimestamp(expectedUpdatedAt, notification.updatedAt)
        ) {
            throw Object.assign(new Error('Notification version changed'), { status: 409 });
        }

        const repository = getServiceRepository<NotificationReadState>(NotificationReadState);
        const existing = await repository.findOne({
            where: { registeredUserId: userId, notificationId }
        });
        const readState =
            existing ||
            repository.create({
                registeredUserId: userId,
                notificationId
            });

        readState.notificationUpdatedAt = notification.updatedAt;
        await repository.save(readState);

        return {
            notificationId,
            updatedAt: notification.updatedAt,
            read: true
        };
    }

    private static async findOrderedNotifications() {
        return await getServiceRepository<SiteNotification>(SiteNotification).find({
            order: {
                channel: 'ASC',
                sortOrder: 'ASC',
                id: 'ASC'
            }
        });
    }

    private static normalizeInput(input: unknown): NormalizedNotificationInput {
        const item = (input && typeof input === 'object' ? input : {}) as SiteNotificationInput;
        const channel = item.channel;
        if (channel !== 'banner' && channel !== 'popup') {
            throw Object.assign(new Error('Invalid notification channel'), { status: 400 });
        }

        const id = Number(item.id);
        const sortOrder = Number(item.sortOrder);

        return {
            id: Number.isInteger(id) && id > 0 ? id : null,
            channel,
            title: String(item.title ?? '').trim(),
            content: sanitizeSiteHtml(item.content),
            enabled: Boolean(item.enabled),
            loginOnly: Boolean(item.loginOnly),
            sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0
        };
    }

    private static applyNotificationInput(
        notification: SiteNotification,
        input: NormalizedNotificationInput
    ) {
        const changed =
            notification.channel !== input.channel ||
            notification.title !== input.title ||
            (notification.content ?? '') !== input.content ||
            Boolean(notification.enabled) !== input.enabled ||
            Boolean(notification.loginOnly) !== input.loginOnly ||
            notification.sortOrder !== input.sortOrder;

        notification.channel = input.channel;
        notification.title = input.title;
        notification.content = input.content;
        notification.enabled = input.enabled;
        notification.loginOnly = input.loginOnly;
        notification.sortOrder = input.sortOrder;

        return changed;
    }

    private static async getReadStates(userId: number) {
        const rows = await getServiceRepository<NotificationReadState>(NotificationReadState).find({
            where: { registeredUserId: userId }
        });
        return new Map(rows.map(row => [row.notificationId, row.notificationUpdatedAt]));
    }

    private static toAdminItem(row: SiteNotification): AdminNotificationItem {
        return {
            id: row.id,
            channel: row.channel,
            title: row.title,
            content: sanitizeSiteHtml(row.content),
            enabled: Boolean(row.enabled),
            loginOnly: Boolean(row.loginOnly),
            sortOrder: row.sortOrder,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        };
    }

    private static toCurrentItem(
        row: SiteNotification,
        userId: number | undefined,
        readStates: Map<number, Date>
    ): CurrentNotificationItem {
        const readUpdatedAt = readStates.get(row.id);

        return {
            id: row.id,
            channel: row.channel,
            title: row.title,
            content: sanitizeSiteHtml(row.content),
            loginOnly: Boolean(row.loginOnly),
            sortOrder: row.sortOrder,
            updatedAt: row.updatedAt,
            read: userId
                ? Boolean(readUpdatedAt && readUpdatedAt.getTime() >= row.updatedAt.getTime())
                : false
        };
    }

    private static isSameTimestamp(input: unknown, expected: Date) {
        const inputTime = new Date(String(input)).getTime();
        return Number.isFinite(inputTime) && inputTime === expected.getTime();
    }
}
