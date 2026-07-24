import { randomUUID } from 'node:crypto';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { SaveTarget, TaskType } from '@/shared/task';
import { TaskService } from '@/services/task.service';
import { normalizeErrorReason } from '@/utils/error-reason';

const LOCK_KEY = 'scheduler:judgement-sync';
const SYNC_INTERVAL_MS = 60_000;

export class JudgementSyncScheduler {
    private static timer: NodeJS.Timeout | null = null;

    static start() {
        if (this.timer) return;
        void this.runOnce();
        this.timer = setInterval(() => void this.runOnce(), SYNC_INTERVAL_MS);
        this.timer.unref();
        logger.info(
            { intervalMs: SYNC_INTERVAL_MS },
            'Judgement synchronization scheduler started'
        );
    }

    static stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private static async releaseOwnedLock(token: string) {
        await redisClient.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            LOCK_KEY,
            token
        );
    }

    private static async runOnce() {
        const token = randomUUID();
        let lockOwned = false;

        try {
            const acquired = await redisClient.set(LOCK_KEY, token, 'PX', SYNC_INTERVAL_MS, 'NX');
            if (acquired !== 'OK') {
                logger.info('Judgement synchronization dispatch skipped: lock held');
                return;
            }
            lockOwned = true;

            const task = await TaskService.createTask(TaskType.SAVE, {
                target: SaveTarget.JUDGEMENT,
                targetId: 'latest',
                metadata: {}
            });
            await TaskService.dispatchTask(task.id);
            logger.info({ taskId: task.id }, 'Judgement synchronization task dispatched');
        } catch (error) {
            if (lockOwned) {
                try {
                    await this.releaseOwnedLock(token);
                } catch (releaseError) {
                    logger.error(
                        { reason: normalizeErrorReason(releaseError) },
                        'Failed to release judgement scheduler lock'
                    );
                }
            }
            logger.error(
                { reason: normalizeErrorReason(error) },
                'Judgement synchronization dispatch failed'
            );
        }
    }
}
