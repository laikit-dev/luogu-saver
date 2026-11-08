import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
    const counts = new Map<string, number>();
    const versions = new Map<string, number>();
    const jobs = new Map<string, { id: string; priority?: number }>();
    const control = {
        nextId: 0,
        onCount: undefined as (() => Promise<void>) | undefined,
        commandError: undefined as Error | undefined,
        unwatchError: undefined as Error | undefined
    };
    const changeCount = (key: string, count: number) => {
        counts.set(key, count);
        versions.set(key, (versions.get(key) || 0) + 1);
    };
    class Redis {
        status = 'ready';
        watched?: Map<string, number>;
        async watch(...keys: string[]) {
            this.watched = new Map(keys.map(key => [key, versions.get(key) || 0]));
        }
        async unwatch() {
            if (control.unwatchError) {
                const error = control.unwatchError;
                control.unwatchError = undefined;
                throw error;
            }
            this.watched = undefined;
        }
        async eval(_script: string, _keyCount: number, ...keys: string[]) {
            const snapshot = keys.reduce((sum, key) => sum + (counts.get(key) || 0), 0);
            await control.onCount?.();
            return snapshot;
        }
        disconnect() {
            this.status = 'end';
        }
    }
    class Transaction {
        operation?: () => string;
        constructor(private raw: Redis) {}
        async exec() {
            const watched = this.raw.watched;
            this.raw.watched = undefined;
            if (
                watched &&
                [...watched].some(([key, version]) => (versions.get(key) || 0) !== version)
            ) {
                return null;
            }
            if (control.commandError) {
                const error = control.commandError;
                control.commandError = undefined;
                return [[error, null]];
            }
            return [[null, this.operation!()]];
        }
    }
    class RedisConnection {
        client: Promise<{ multi: () => Transaction }>;
        constructor(private raw: Redis) {
            this.client = Promise.resolve({ multi: () => new Transaction(raw) });
        }
        on() {
            return this;
        }
        async close() {
            this.raw.disconnect();
        }
    }
    class Job {
        id?: string;
        scripts = {
            finishedErrors: ({ code }: { code: number }) => new Error(`Native error ${code}`)
        };
        constructor(
            public queue: Queue,
            public name: string,
            public data: unknown,
            public opts: { jobId?: string; priority?: number; delay?: number }
        ) {}
        async addJob(transaction: Transaction) {
            transaction.operation = () => {
                const id = this.opts.jobId || String(++control.nextId);
                const key = this.opts.delay
                    ? this.queue.keys.delayed
                    : this.opts.priority
                      ? this.queue.keys.prioritized
                      : this.queue.keys.wait;
                if (!jobs.has(`${this.queue.name}:${id}`)) {
                    jobs.set(`${this.queue.name}:${id}`, { id, priority: this.opts.priority });
                    changeCount(key, (counts.get(key) || 0) + 1);
                }
                return id;
            };
            return transaction;
        }
    }
    class Queue {
        keys: Record<string, string>;
        constructor(public name: string) {
            this.keys = Object.fromEntries(
                ['wait', 'paused', 'delayed', 'prioritized', 'waiting-children'].map(key => [
                    key,
                    `${name}:${key}`
                ])
            );
        }
        protected get Job() {
            return Job;
        }
        on() {
            return this;
        }
        emit() {}
        async add(name: string, data: unknown, opts = {}) {
            const job = new this.Job(this, name, data, opts);
            job.id = (await job.addJob(undefined as unknown as Transaction)) as unknown as string;
            return job;
        }
        async getJobCounts() {
            return Object.fromEntries(
                ['waiting', 'paused', 'delayed', 'prioritized', 'waiting-children'].map(key => [
                    key,
                    counts.get(this.keys[key === 'waiting' ? 'wait' : key]) || 0
                ])
            );
        }
        async close() {}
    }
    return { counts, versions, jobs, control, changeCount, Redis, RedisConnection, Job, Queue };
});

vi.mock('bullmq', () => ({
    Queue: state.Queue,
    Job: state.Job,
    RedisConnection: state.RedisConnection
}));
vi.mock('ioredis', () => ({ default: state.Redis }));
vi.mock('@/config', () => ({ config: { redis: {} } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { TypedQueue } from '../src/lib/queue-wrapper';
import { QueueSchema } from '../src/config/schemas/business';
import { WORKFLOW_PRIORITY } from '../src/shared/constants';

beforeEach(() => {
    state.counts.clear();
    state.versions.clear();
    state.jobs.clear();
    state.control.nextId = 0;
    state.control.onCount = undefined;
    state.control.commandError = undefined;
    state.control.unwatchError = undefined;
});

describe('reserved queue admission', () => {
    it('preserves a committed job when watch cleanup fails and replaces the broken connection', async () => {
        const queue = new TypedQueue('save', 1, 1);
        state.control.unwatchError = new Error('Watch cleanup connection lost');
        const committed = await queue.add(
            'guest',
            {},
            {
                jobId: 'committed',
                priority: WORKFLOW_PRIORITY.ANONYMOUS
            }
        );
        expect(committed.id).toBe('committed');
        expect(state.jobs.has('save:committed')).toBe(true);
        await queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        await expect(
            queue.add('past-reserve', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ).rejects.toThrow('Queue is full');
        expect(state.jobs.size).toBe(2);
        await queue.close();
    });

    it('reserves overflow for authenticated priority and rejects the first job beyond it', async () => {
        const queue = new TypedQueue('save', 1, 2);
        await queue.add('guest', {}, { priority: WORKFLOW_PRIORITY.ANONYMOUS });
        for (const priority of [undefined, 0, WORKFLOW_PRIORITY.ANONYMOUS, WORKFLOW_PRIORITY.LOW]) {
            await expect(queue.add('ordinary', {}, { priority })).rejects.toThrow('Queue is full');
        }
        await queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        expect(await queue.wouldExceedMaxLength(1)).toBe(true);
        expect(await queue.wouldExceedMaxLength(1, WORKFLOW_PRIORITY.AUTHENTICATED)).toBe(false);
        await queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        await expect(
            queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ).rejects.toThrow('Queue is full');
        expect(state.jobs.size).toBe(3);
        await queue.close();
    });

    it('counts paused, delayed, prioritized and waiting-children jobs against the same bound', async () => {
        const queue = new TypedQueue('save', 5, 1);
        for (const key of ['wait', 'paused', 'delayed', 'prioritized', 'waiting-children']) {
            state.changeCount(queue.queue.keys[key], 1);
        }
        expect(await queue.wouldExceedMaxLength(1)).toBe(true);
        await expect(
            queue.add('guest', {}, { priority: WORKFLOW_PRIORITY.ANONYMOUS })
        ).rejects.toThrow('Queue is full');
        await queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        await expect(
            queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ).rejects.toThrow('Queue is full');
        expect([...state.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(6);
        await queue.close();
    });

    it('serializes concurrent calls sharing a WATCH connection', async () => {
        const queue = new TypedQueue('save', 1, 1);
        await queue.add('guest', {}, { priority: WORKFLOW_PRIORITY.ANONYMOUS });
        const replies = await Promise.allSettled(
            Array.from({ length: 4 }, () =>
                queue.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
            )
        );
        expect(replies.filter(reply => reply.status === 'fulfilled')).toHaveLength(1);
        expect(state.jobs.size).toBe(2);
        await queue.close();
    });

    it('rechecks after two independent producers race for the last reserved slot', async () => {
        const first = new TypedQueue('save', 1, 1);
        const second = new TypedQueue('save', 1, 1);
        await first.add('guest', {}, { priority: WORKFLOW_PRIORITY.ANONYMOUS });
        let release!: () => void;
        const bothCounted = new Promise<void>(resolve => {
            release = resolve;
        });
        let reads = 0;
        state.control.onCount = async () => {
            reads++;
            if (reads === 2) release();
            if (reads <= 2) await bothCounted;
        };
        const replies = await Promise.allSettled([
            first.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED }),
            second.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ]);
        expect(replies.filter(reply => reply.status === 'fulfilled')).toHaveLength(1);
        expect(state.jobs.size).toBe(2);
        await Promise.all([first.close(), second.close()]);
    });

    it('keeps queue reserves independent and leaves capacity available after a failed command', async () => {
        const save = new TypedQueue('save', 0, 1);
        const ai = new TypedQueue('ai', 0, 2);
        state.control.commandError = new Error('Redis command failed');
        await expect(
            save.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ).rejects.toThrow('Redis command failed');
        await save.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        await expect(
            save.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED })
        ).rejects.toThrow('Queue is full');
        await ai.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        await ai.add('signed-in', {}, { priority: WORKFLOW_PRIORITY.AUTHENTICATED });
        expect(state.counts.get('save:prioritized')).toBe(1);
        expect(state.counts.get('ai:prioritized')).toBe(2);
        await Promise.all([save.close(), ai.close()]);
    });
});

describe('per-queue reserve configuration', () => {
    it('keeps separately configured queue reserves independent', () => {
        const parsed = QueueSchema.parse({ save: { extraCapacity: 2 }, ai: { extraCapacity: 7 } });
        expect(parsed.save.extraCapacity).toBe(2);
        expect(parsed.ai.extraCapacity).toBe(7);
    });

    it.each([-1, 0.5])('rejects invalid reserved job counts: %s', extraCapacity => {
        expect(QueueSchema.safeParse({ save: { extraCapacity } }).success).toBe(false);
    });
});
