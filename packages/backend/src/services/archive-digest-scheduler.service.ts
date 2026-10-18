import { LessThanOrEqual, MoreThan } from 'typeorm';
import { config } from '@/config';
import { ArchiveDigestPreference } from '@/entities/archive-digest-preference';
import { logger } from '@/lib/logger';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { ARCHIVE_DIGEST_INTERVAL_MS } from '@/services/library.service';
import { UserNotificationService } from '@/services/user-notification.service';
import { UserTimelineService } from '@/services/user-timeline.service';
import { normalizeErrorReason } from '@/utils/error-reason';

const OWNER_BATCH_SIZE = 100;

export class ArchiveDigestScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static runningPass: Promise<void> | null = null;

    static start(): void {
        if (this.timer) return;
        this.timer = setInterval(
            () => void this.runScheduledPass(),
            config.archive.digestPollIntervalMs
        );
        this.timer.unref();
        void this.runScheduledPass();
        logger.info(
            { intervalMs: config.archive.digestPollIntervalMs },
            'Archive digest scheduler started'
        );
    }

    static stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    static async sendDueDigests(now = new Date()): Promise<void> {
        if (this.runningPass) return this.runningPass;
        const pass = this.processDueDigests(now);
        this.runningPass = pass;
        try {
            await pass;
        } finally {
            if (this.runningPass === pass) this.runningPass = null;
        }
    }

    private static async runScheduledPass(): Promise<void> {
        try {
            await this.sendDueDigests();
        } catch (error) {
            logger.error(
                { reason: normalizeErrorReason(error) },
                'Archive digest scheduling pass failed'
            );
        }
    }

    private static async processDueDigests(now: Date): Promise<void> {
        const repository = getServiceRepository<ArchiveDigestPreference>(ArchiveDigestPreference);
        let lastOwnerId = 0;
        while (true) {
            const owners = await repository.find({
                select: { ownerId: true },
                where: {
                    ownerId: MoreThan(lastOwnerId),
                    enabled: true,
                    nextDigestAt: LessThanOrEqual(now)
                },
                order: { ownerId: 'ASC' },
                take: OWNER_BATCH_SIZE
            });
            for (const { ownerId } of owners) {
                try {
                    await this.sendForOwner(ownerId, now);
                } catch (error) {
                    logger.error(
                        { ownerId, reason: normalizeErrorReason(error) },
                        'Archive digest generation failed for owner'
                    );
                }
            }
            if (owners.length < OWNER_BATCH_SIZE) return;
            lastOwnerId = owners[owners.length - 1].ownerId;
        }
    }

    private static async sendForOwner(ownerId: number, now: Date): Promise<void> {
        await ArchiveDigestPreference.transaction(async manager => {
            const repository = getServiceRepository<ArchiveDigestPreference>(
                ArchiveDigestPreference,
                manager
            );
            const preference = await repository.findOne({
                where: { ownerId },
                lock: { mode: 'pessimistic_write' }
            });
            if (
                !preference?.enabled ||
                !preference.nextDigestAt ||
                preference.nextDigestAt.getTime() > now.getTime()
            ) {
                return;
            }
            if (!preference.lastDigestAt) {
                throw new Error('Enabled archive digest preference has no checkpoint');
            }
            const from = preference.lastDigestAt;
            const eventCount = await UserTimelineService.countForOwner(ownerId, from, now, manager);
            if (eventCount > 0) {
                await UserNotificationService.createNotification(
                    {
                        recipientId: ownerId,
                        type: 'archive_digest',
                        title: `归档动态摘要：${eventCount} 条记录`,
                        content: `您的资料库新增了 ${eventCount} 条可见归档记录。打开资料库查看当前可见动态。`,
                        metadata: {
                            kind: 'archive_digest',
                            eventCount,
                            from: from.toISOString(),
                            to: now.toISOString()
                        }
                    },
                    manager
                );
            }
            preference.lastDigestAt = now;
            preference.nextDigestAt = new Date(now.getTime() + ARCHIVE_DIGEST_INTERVAL_MS);
            await repository.save(preference);
        });
    }
}
