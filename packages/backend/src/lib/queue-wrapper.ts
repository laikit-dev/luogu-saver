import {
    Queue,
    JobsOptions,
    Job,
    RedisConnection,
    type IRedisTransaction,
    type ParentKeyOpts,
    type QueueOptions,
    type RedisClient
} from 'bullmq';
import Redis from 'ioredis';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { WORKFLOW_PRIORITY } from '@/shared/constants';

const PENDING_COUNT_SCRIPT = `return redis.call('LLEN', KEYS[1])
    + redis.call('LLEN', KEYS[2])
    + redis.call('ZCARD', KEYS[3])
    + redis.call('ZCARD', KEYS[4])
    + redis.call('ZCARD', KEYS[5])`;

class CapacityJob<T = any, R = any, N extends string = string> extends Job<T, R, N> {
    override async addJob(
        _client: RedisClient | IRedisTransaction,
        parentOpts?: ParentKeyOpts
    ): Promise<string> {
        const result = await (this.queue as CapacityQueue).addWithCapacity(
            this.opts.priority,
            transaction => super.addJob(transaction, parentOpts)
        );
        if (typeof result === 'number' && result < 0) {
            throw this.scripts.finishedErrors({
                code: result,
                parentKey: parentOpts?.parentKey,
                command: 'addJob'
            });
        }
        return String(result);
    }
}

class CapacityQueue extends Queue {
    private admissionTail = Promise.resolve();
    private admissionConnection?: { raw: Redis; connection: RedisConnection };
    private capacityClosing?: Promise<void>;

    constructor(
        name: string,
        options: QueueOptions,
        private readonly maxQueueLength: number,
        private readonly extraCapacity: number
    ) {
        super(name, options);
    }

    protected override get Job(): typeof Job {
        return CapacityJob;
    }

    async addWithCapacity(
        priority: number | undefined,
        enqueue: (transaction: IRedisTransaction) => Promise<string>
    ): Promise<string | number> {
        if (this.capacityClosing) throw new Error('Queue is closed.');
        const previous = this.admissionTail;
        let release!: () => void;
        this.admissionTail = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;

        let admission: { raw: Redis; connection: RedisConnection } | undefined;
        try {
            if (this.capacityClosing) throw new Error('Queue is closed.');
            if (!this.admissionConnection) {
                const raw = new Redis({
                    host: config.redis.host,
                    port: config.redis.port,
                    password: config.redis.password,
                    // Reconnecting must not replay EXEC after the connection's WATCH state was lost.
                    enableOfflineQueue: false,
                    autoResendUnfulfilledCommands: false,
                    retryStrategy: () => null,
                    maxRetriesPerRequest: 0
                });
                const connection = new RedisConnection(raw, { blocking: false, shared: false });
                connection.on('error', error => this.emit('error', error));
                this.admissionConnection = { raw, connection };
            }
            admission = this.admissionConnection;
            const client = await admission.connection.client;
            const keys = [
                this.keys.wait,
                this.keys.paused,
                this.keys.delayed,
                this.keys.prioritized,
                this.keys['waiting-children']
            ];
            const limit =
                this.maxQueueLength +
                (priority === WORKFLOW_PRIORITY.AUTHENTICATED ? this.extraCapacity : 0);

            // WATCH is connection-scoped; local serialization prevents one caller clearing another's watch.
            for (;;) {
                await admission.raw.watch(...keys);
                const pending = Number(
                    await admission.raw.eval(PENDING_COUNT_SCRIPT, keys.length, ...keys)
                );
                if (pending + 1 > limit) {
                    throw new Error('Queue is full. Please try again later.');
                }
                const transaction = client.multi();
                // The native script's ID is available only after EXEC, not when it is queued.
                await enqueue(transaction);
                const result = await transaction.exec();
                if (result === null) continue;
                const [error, jobId] = result[0];
                if (error) throw error;
                return jobId;
            }
        } finally {
            try {
                if (admission?.raw.status === 'ready') await admission.raw.unwatch();
            } catch (error) {
                // Cleanup must not turn a committed enqueue into a reported failure.
                admission?.raw.disconnect();
                this.emit('error', error instanceof Error ? error : new Error(String(error)));
            } finally {
                try {
                    if (admission && admission.raw.status !== 'ready') {
                        this.admissionConnection = undefined;
                        try {
                            await admission.connection.close(true);
                        } catch (error) {
                            this.emit(
                                'error',
                                error instanceof Error ? error : new Error(String(error))
                            );
                        }
                    }
                } finally {
                    release();
                }
            }
        }
    }

    override close(): Promise<void> {
        return (this.capacityClosing ??= (async () => {
            await this.admissionTail;
            try {
                await this.admissionConnection?.connection.close(true);
            } finally {
                await super.close();
            }
        })());
    }
}

export class TypedQueue<T> {
    public queue: Queue;
    private maxQueueLength: number;
    private extraCapacity: number;

    constructor(queueName: string, maxQueueLength: number, extraCapacity: number) {
        this.maxQueueLength = maxQueueLength;
        this.extraCapacity = extraCapacity;
        this.queue = new CapacityQueue(
            queueName,
            {
                connection: {
                    host: config.redis.host,
                    port: config.redis.port,
                    password: config.redis.password
                },
                prefix: config.redis.keyPrefix,
                defaultJobOptions: {
                    removeOnComplete: 100,
                    removeOnFail: 500,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000
                    }
                }
            },
            maxQueueLength,
            extraCapacity
        );

        this.queue.on('error', err => {
            logger.error({ err, queueName }, 'Queue connection error');
        });
    }

    /*
     * Add a new job to the queue.
     * @param name - The name of the job.
     * @param data - The data associated with the job.
     * @param options - Optional job options.
     * @return The added job.
     */
    async add(name: string, data: T, options?: JobsOptions): Promise<Job<T>> {
        return this.queue.add(name, data, options);
    }

    async wouldExceedMaxLength(
        jobsToAdd: number,
        priority: number = WORKFLOW_PRIORITY.ANONYMOUS
    ): Promise<boolean> {
        const counts = await this.queue.getJobCounts(
            'waiting',
            'paused',
            'delayed',
            'prioritized',
            'waiting-children'
        );
        const pendingCount =
            counts.waiting +
            (counts.paused || 0) +
            counts.delayed +
            counts.prioritized +
            (counts['waiting-children'] || 0);
        const limit =
            this.maxQueueLength +
            (priority === WORKFLOW_PRIORITY.AUTHENTICATED ? this.extraCapacity : 0);
        return pendingCount + jobsToAdd > limit;
    }

    async getJob(jobId: string): Promise<Job<T> | undefined> {
        return this.queue.getJob(jobId);
    }

    async close() {
        await this.queue.close();
    }
}
