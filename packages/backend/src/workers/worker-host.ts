import {
    Worker,
    Job,
    QueueEvents,
    type WorkerOptions,
    UnrecoverableError,
    DelayedError
} from 'bullmq';
import { TaskStatus } from '@/shared/task';
import type { CommonTask } from '@/workers/types';
import { TaskProcessor } from './task-processor';
import { PointGuard } from '@/lib/point-guard';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { TaskService } from '@/services/task.service';
import { emitToRoom } from '@/lib/socket';
import { FlowManager } from '@/workers/flow-manager';
import { normalizeErrorReason } from '@/utils/error-reason';

export class WorkerHost<T extends CommonTask> {
    public worker: Worker<T>;
    private queueEvents: QueueEvents;

    constructor(
        queueName: string,
        private processor: TaskProcessor<T>,
        private pointGuard: PointGuard | null,
        options?: WorkerOptions
    ) {
        this.worker = new Worker<T>(queueName, this.handleJob, {
            connection: {
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password
            },
            prefix: config.redis.keyPrefix,
            concurrency: 5,
            limiter: {
                max: 100,
                duration: 1000
            },
            ...options
        });
        this.setupEvents();
    }

    private handleJob = async (job: Job<T>) => {
        if (!this.pointGuard) {
            logger.debug({ jobId: job.id }, 'PointGuard is NULL! Rate limiting is skipped!');
            return await this.processor.process(job);
        }

        const hasPoints = await this.pointGuard.consume(1);
        logger.debug({ jobId: job.id, hasPoints }, `PointGuard consume result: ${hasPoints}`);

        if (!hasPoints) {
            logger.warn({ jobId: job.id }, 'Rate limited by PointGuard, delaying job...');
            const regenInterval = this.pointGuard.getRegenerationInterval();
            const jitterDelay = regenInterval + Math.floor(Math.random() * 4000);
            await job.moveToDelayed(Date.now() + jitterDelay, job.token);
            throw new DelayedError();
        }

        return await this.processor.process(job);
    };

    private setupEvents() {
        this.queueEvents = new QueueEvents(this.worker.name, {
            connection: {
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password
            },
            prefix: config.redis.keyPrefix
        });

        this.worker.on('completed', async job => {
            logger.info({ jobId: job.id }, 'Job completed successfully.');
            const returnvalue = job.returnvalue as any;
            if (this.shouldEmitTaskEvent(job)) {
                emitToRoom(`task:${job.id}`, `task:${job.id}:completed`, {
                    status: 'completed',
                    result: this.sanitizeReportedResult(returnvalue?.__result)
                });
            }
            if (job.data?.workflowId) {
                await FlowManager.handleWorkflowJobCompleted(job, returnvalue);
            } else {
                await TaskService.updateTask(
                    job.id!,
                    TaskStatus.COMPLETED,
                    'Task completed successfully'
                );
            }
        });

        this.worker.on('failed', async (job, err) => {
            const isFinalAttempt = job && job.attemptsMade >= (job.opts.attempts || 1);
            const isUnrecoverable = err instanceof UnrecoverableError;
            if (isFinalAttempt || isUnrecoverable) {
                const reason = normalizeErrorReason(err);
                if (this.shouldEmitTaskEvent(job)) {
                    emitToRoom(`task:${job?.id}`, `task:${job?.id}:failed`, {
                        status: 'failed',
                        error: reason
                    });
                }
                logger.error({ jobId: job?.id, err }, 'Job failed PERMANENTLY.');
                if (job?.id) {
                    if (job.data?.workflowId) {
                        await FlowManager.handleWorkflowJobFailed(job, reason);
                    } else {
                        await TaskService.updateTask(job.id, TaskStatus.FAILED, reason);
                    }
                }
            } else {
                logger.warn(
                    { jobId: job?.id, attempt: job?.attemptsMade, err },
                    'Job failed, retrying...'
                );
            }
        });

        this.worker.on('active', async job => {
            logger.debug({ job: job?.data }, 'Job is now active.');
            if (job?.id)
                await TaskService.updateTask(job.id, TaskStatus.PROCESSING, 'Task is now active');
        });

        this.worker.on('error', err => {
            logger.error({ err }, 'Worker connection error');
        });

        this.worker.on('progress', async (job, progress) => {
            logger.debug({ jobId: job?.id, progress }, 'Job progress update.');
            if (job?.id)
                await TaskService.updateTask(job.id, TaskStatus.PROCESSING, progress as string);
        });

        this.queueEvents.on('delayed', (job: { jobId: string; delay: number }) => {
            logger.warn({ jobId: job.jobId, delay: job.delay }, 'Job has been delayed.');
        });

        this.queueEvents.on('waiting', (job: { jobId: string }) => {
            logger.debug({ jobId: job?.jobId }, 'Job queued.');
        });
    }

    private shouldEmitTaskEvent(job?: Job<T>) {
        if (!job?.data?.workflowId) return true;
        return job.data.report === true;
    }

    private sanitizeReportedResult(result: any) {
        if (!result?.data?.embedding) return result;
        return {
            ...result,
            data: {
                ...result.data,
                embedding: [],
                embeddingLength: result.data.embeddingLength || result.data.embedding.length
            }
        };
    }

    public async close() {
        await Promise.all([this.worker.close(), this.queueEvents.close()]);
    }
}
