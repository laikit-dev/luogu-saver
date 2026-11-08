import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task as TaskEntity } from '../src/entities/task';
import type { Workflow as WorkflowEntity } from '../src/entities/workflow';

const entities = vi.hoisted(() => {
    class Task {}
    class Workflow {
        static transaction: <T>(run: (manager: Transaction) => Promise<T>) => Promise<T>;
    }
    class WorkflowDeduplication {}
    return { Task, Workflow, WorkflowDeduplication };
});
const mocks = vi.hoisted(() => ({
    getRepository: vi.fn(),
    getQueue: vi.fn(),
    redis: { get: vi.fn(), mget: vi.fn(), set: vi.fn(), decr: vi.fn(), multi: vi.fn() }
}));

vi.mock('@/entities/task', () => ({ Task: entities.Task }));
vi.mock('@/entities/workflow', () => ({ Workflow: entities.Workflow }));
vi.mock('@/entities/workflow-deduplication', () => ({
    WorkflowDeduplication: entities.WorkflowDeduplication
}));
vi.mock('@/services/helpers/repository.helper', () => ({
    getServiceRepository: mocks.getRepository
}));
vi.mock('@/lib/queue-factory', () => ({ getQueueByName: mocks.getQueue }));
vi.mock('@/lib/redis', () => ({ redisClient: mocks.redis }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/config', () => ({ config: {} }));

import { WorkflowRuntimeStore } from '../src/services/helpers/workflow-runtime-store.helper';
import { WorkflowScheduler } from '../src/services/workflow-scheduler.service';
import { WorkflowService } from '../src/services/workflow.service';
import { TaskStatus, TaskType } from '../src/shared/task';
import type { WorkflowDefinition } from '../src/utils/flow-validator';

function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => (resolve = done));
    return { promise, resolve };
}

type Row = Record<string, unknown>;
type Entity = object;
type Criteria = string | Record<string, unknown>;
type FindOptions = {
    where: Record<string, unknown>;
    select?: string[];
    lock?: { mode: string };
};
type Transaction = {
    writes: Map<Entity, Map<string, Row | null>>;
    locks: Set<string>;
    releases: Array<() => void>;
};
type QueuedJob = { priority: number; state: string; data: object };

// Transactional state and raw priority assignments intentionally impose no promotion policy.
// The real services must coordinate SQL visibility and queue writes themselves.
class WorkflowFixture {
    rows = new Map<Entity, Map<string, Row>>();
    lockTails = new Map<string, Promise<void>>();
    jobs = new Map<string, QueuedJob>();
    redis = new Map<string, string>();
    capacity = 100;
    addCount = 0;
    claimConflictError: Error = Object.assign(new Error('Duplicate entry'), {
        code: 'ER_DUP_ENTRY'
    });
    onLockWait?: () => void;
    afterClaimRead?: (row: Row | null) => Promise<void>;
    beforeClaimInsert?: () => Promise<void>;
    beforeRuntimeInit?: () => Promise<void>;
    beforeAdd?: (taskId: string) => Promise<void>;
    beforeChange?: (taskId: string, priority: number) => Promise<void>;

    constructor() {
        for (const entity of Object.values(entities)) this.rows.set(entity, new Map());
    }

    async lock(key: string, tx: Transaction) {
        if (tx.locks.has(key)) return;
        const previous = this.lockTails.get(key);
        if (previous) this.onLockWait?.();
        const released = signal();
        const next = (previous || Promise.resolve()).then(() => released.promise);
        this.lockTails.set(key, next);
        await previous;
        tx.locks.add(key);
        tx.releases.push(() => {
            released.resolve();
            if (this.lockTails.get(key) === next) this.lockTails.delete(key);
        });
    }

    async transaction<T>(run: (tx: Transaction) => Promise<T>) {
        const tx: Transaction = { writes: new Map(), locks: new Set(), releases: [] };
        try {
            const result = await run(tx);
            for (const [entity, writes] of tx.writes) {
                const rows = this.rows.get(entity)!;
                for (const [id, row] of writes) {
                    if (row) rows.set(id, row);
                    else rows.delete(id);
                }
            }
            return result;
        } finally {
            for (const release of tx.releases) release();
        }
    }

    repository(entity: Entity, tx?: Transaction) {
        const keyOf = (row: Row) => {
            const key = entity === entities.WorkflowDeduplication ? row.key : row.id;
            if (typeof key !== 'string') throw new Error('Fixture row has no primary key');
            return key;
        };
        const readRows = () => {
            const rows = new Map(this.rows.get(entity));
            for (const [id, row] of tx?.writes.get(entity) || []) {
                if (row) rows.set(id, row);
                else rows.delete(id);
            }
            return [...rows.values()];
        };
        const matches = (row: Row, where: Criteria) =>
            typeof where === 'string'
                ? row.id === where
                : Object.entries(where || {}).every(([key, value]) => row[key] === value);
        const select = (row: Row, fields?: string[]) =>
            fields ? Object.fromEntries(fields.map(key => [key, row[key]])) : { ...row };
        const write = (id: string, row: Row | null) => {
            if (tx) {
                if (!tx.writes.has(entity)) tx.writes.set(entity, new Map());
                tx.writes.get(entity)!.set(id, row);
            } else if (row) {
                this.rows.get(entity)!.set(id, row);
            } else {
                this.rows.get(entity)!.delete(id);
            }
        };
        return {
            create: (row: Row) => ({ ...row }),
            save: async (input: Row | Row[]) => {
                for (const row of Array.isArray(input) ? input : [input]) {
                    write(keyOf(row), { ...row });
                }
                return input;
            },
            insert: async (row: Row) => {
                await this.beforeClaimInsert?.();
                if (tx) await this.lock(`claim:${keyOf(row)}`, tx);
                if (readRows().some(existing => keyOf(existing) === keyOf(row))) {
                    throw this.claimConflictError;
                }
                write(keyOf(row), { ...row });
            },
            findOne: async (options: FindOptions) => {
                if (options.lock && tx) await this.lock(`workflow:${options.where.id}`, tx);
                const row = readRows().find(row => matches(row, options.where));
                const result = row ? select(row, options.select) : null;
                if (entity === entities.WorkflowDeduplication) await this.afterClaimRead?.(result);
                return result;
            },
            find: async (options: FindOptions) =>
                readRows()
                    .filter(row => matches(row, options.where))
                    .map(row => select(row, options.select)),
            findByIds: async (ids: string[]) =>
                readRows().filter(row => typeof row.id === 'string' && ids.includes(row.id)),
            update: async (where: Criteria, changes: Row) => {
                for (const row of readRows().filter(row => matches(row, where))) {
                    write(keyOf(row), { ...row, ...changes });
                }
            },
            delete: async (where: Criteria | string[]) => {
                for (const row of readRows()) {
                    if (
                        Array.isArray(where)
                            ? typeof row.id === 'string' && where.includes(row.id)
                            : matches(row, where)
                    ) {
                        write(keyOf(row), null);
                    }
                }
            }
        };
    }

    queue() {
        const getJob = async (id: string) => {
            const row = this.jobs.get(id);
            if (!row) return undefined;
            return {
                priority: row.priority,
                getState: async () => row.state,
                changePriority: async ({ priority }: { priority: number }) => {
                    await this.beforeChange?.(id, priority);
                    row.priority = priority;
                }
            };
        };
        return {
            getJob,
            wouldExceedMaxLength: async (count: number) =>
                [...this.jobs.values()].filter(job =>
                    ['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'].includes(
                        job.state
                    )
                ).length +
                    count >
                this.capacity,
            add: async (_name: string, data: Row, options: { jobId: string; priority: number }) => {
                this.addCount += 1;
                await this.beforeAdd?.(options.jobId);
                if (!this.jobs.has(options.jobId)) {
                    this.jobs.set(options.jobId, {
                        priority: options.priority,
                        state: 'prioritized',
                        data
                    });
                }
                return getJob(options.jobId);
            }
        };
    }

    install() {
        entities.Workflow.transaction = run => this.transaction(run);
        mocks.getRepository.mockImplementation((entity, tx) => this.repository(entity, tx));
        mocks.getQueue.mockImplementation(() => this.queue());
        Object.assign(mocks.redis, {
            get: async (key: string) => this.redis.get(key) ?? null,
            mget: async (keys: string[]) => keys.map(key => this.redis.get(key) ?? null),
            set: async (key: string, value: string, nx?: string) => {
                if (nx === 'NX' && this.redis.has(key)) return null;
                this.redis.set(key, value);
                return 'OK';
            },
            decr: async (key: string) => {
                const value = Number(this.redis.get(key) || 0) - 1;
                this.redis.set(key, String(value));
                return value;
            },
            multi: () => {
                const operations: Array<() => void> = [];
                const multi = {
                    set: (key: string, value: string) => {
                        operations.push(() => {
                            this.redis.set(key, value);
                        });
                        return multi;
                    },
                    del: (key: string) => {
                        operations.push(() => {
                            this.redis.delete(key);
                        });
                        return multi;
                    },
                    exec: async () => {
                        await this.beforeRuntimeInit?.();
                        for (const operation of operations) operation();
                    }
                };
                return multi;
            }
        });
    }

    tasks() {
        // These rows are authored by the real service, not deserialized external input.
        const tasks = [...this.rows.get(entities.Task)!.values()] as unknown as TaskEntity[];
        return tasks;
    }
}

const definition: WorkflowDefinition = {
    tasks: [
        { name: 'save', track: true, report: true, data: { type: TaskType.SAVE, payload: {} } },
        ...['waiting', 'delayed', 'prioritized', 'active', 'completed', 'failed', 'future'].map(
            name => ({
                name,
                fathers: ['save'],
                data: { type: TaskType.SAVE, payload: {} }
            })
        )
    ]
};
const key = 'paste-save:priority-test';
const create = (priority: number) =>
    WorkflowService.createWorkflow(definition, { priority, deduplicationKey: key });
let fixture: WorkflowFixture;

beforeEach(() => {
    vi.clearAllMocks();
    fixture = new WorkflowFixture();
    fixture.install();
});

describe('deduplicated workflow priority', () => {
    it('keeps unspecified and missing legacy priorities anonymous until explicitly promoted', async () => {
        const original = await WorkflowService.createWorkflow(definition, {
            deduplicationKey: key
        });
        expect(fixture.tasks().every(task => task.priority === 5)).toBe(true);
        expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(5);

        for (const task of fixture.rows.get(entities.Task)!.values()) task.priority = null;
        fixture.jobs.delete(original.taskIds.save);
        fixture.redis.clear();
        const workflow = fixture.rows
            .get(entities.Workflow)!
            .get(original.workflowId)! as unknown as WorkflowEntity;
        await WorkflowRuntimeStore.rebuildRuntimeFromRows(workflow, fixture.tasks());
        await WorkflowScheduler.dispatchEntryPoints([original.taskIds.save]);
        expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(5);

        await WorkflowService.createWorkflow(definition, { deduplicationKey: key });
        expect(fixture.tasks().every(task => task.priority === 5)).toBe(true);
        await create(1);
        await WorkflowService.createWorkflow(definition, { deduplicationKey: key });
        expect(fixture.tasks().every(task => task.priority === 1)).toBe(true);
        expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(1);
    });

    it('promotes queued and future tasks monotonically while leaving executing and terminal jobs alone', async () => {
        const original = await create(10);
        for (const name of ['waiting', 'delayed', 'prioritized', 'active', 'completed', 'failed']) {
            fixture.jobs.set(original.taskIds[name], { priority: 10, state: name, data: {} });
        }
        fixture.rows.get(entities.Task)!.get(original.taskIds.active)!.status =
            TaskStatus.PROCESSING;
        fixture.rows.get(entities.Task)!.get(original.taskIds.completed)!.status =
            TaskStatus.COMPLETED;
        fixture.rows.get(entities.Task)!.get(original.taskIds.failed)!.status = TaskStatus.FAILED;
        fixture.capacity = 0;

        let effectivePriority = 10;
        for (const priority of [5, 1, 5, 10]) {
            effectivePriority = Math.min(effectivePriority, priority);
            const reused = await create(priority);
            expect(reused).toEqual({ ...original, deduplicated: true });
            expect(fixture.tasks().map(task => task.priority)).toEqual(
                Array(definition.tasks.length).fill(effectivePriority)
            );
        }
        for (const name of ['save', 'waiting', 'delayed', 'prioritized']) {
            expect(fixture.jobs.get(original.taskIds[name])!.priority).toBe(1);
        }
        for (const name of ['active', 'completed', 'failed']) {
            expect(fixture.jobs.get(original.taskIds[name])!.priority).toBe(10);
        }
        expect(fixture.addCount).toBe(1);

        fixture.capacity = 100;
        fixture.rows.get(entities.Task)!.get(original.taskIds.save)!.status = TaskStatus.COMPLETED;
        fixture.jobs.get(original.taskIds.save)!.state = 'completed';
        await WorkflowScheduler.releaseDescendants(original.taskIds.save);
        expect(fixture.jobs.get(original.taskIds.future)!.priority).toBe(1);
        expect(fixture.addCount).toBe(2);
    });

    it('promotes an existing claim before its creator initializes runtime state', async () => {
        const initializing = signal();
        const resume = signal();
        fixture.beforeRuntimeInit = async () => {
            initializing.resolve();
            await resume.promise;
        };
        const pending = create(10);
        await initializing.promise;
        const reused = await create(1);
        expect(fixture.redis.size).toBe(0);
        expect(fixture.tasks().every(task => task.priority === 1)).toBe(true);
        resume.resolve();
        const original = await pending;
        expect(reused).toEqual({ ...original, deduplicated: true });
        expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(1);
        expect((await WorkflowRuntimeStore.getRuntimeTask(original.taskIds.save)).priority).toBe(
            10
        );
    });

    it.each([
        { label: 'duplicate-key', details: { code: 'ER_DUP_ENTRY', errno: 1062 } },
        {
            label: 'MariaDB snapshot',
            details: { driverError: { code: 'ER_CHECKREAD', errno: 1020 } }
        }
    ])(
        'promotes the winner after a $label claim conflict and rolls back the losing rows',
        async ({ details }) => {
            fixture.claimConflictError = Object.assign(new Error('Claim insert conflict'), details);
            const missedClaim = signal();
            const resume = signal();
            let firstRead = true;
            fixture.afterClaimRead = async row => {
                if (row || !firstRead) return;
                firstRead = false;
                missedClaim.resolve();
                await resume.promise;
            };
            const highPriority = create(1);
            await missedClaim.promise;
            const original = await create(10);
            resume.resolve();
            const reused = await highPriority;
            expect(reused).toEqual({ ...original, deduplicated: true });
            expect(fixture.rows.get(entities.Workflow)!.size).toBe(1);
            expect(fixture.tasks()).toHaveLength(definition.tasks.length);
            expect(fixture.tasks().every(task => task.priority === 1)).toBe(true);
            expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(1);
            expect(fixture.addCount).toBe(1);
        }
    );

    it('preserves a claim insertion failure when no winning workflow exists', async () => {
        const failure = Object.assign(new Error('Record has changed since last read'), {
            driverError: { code: 'ER_CHECKREAD', errno: 1020 }
        });
        fixture.beforeClaimInsert = async () => {
            throw failure;
        };

        await expect(create(1)).rejects.toBe(failure);
        expect(fixture.rows.get(entities.Workflow)!.size).toBe(0);
        expect(fixture.rows.get(entities.WorkflowDeduplication)!.size).toBe(0);
        expect(fixture.tasks()).toHaveLength(0);
        expect(fixture.jobs.size).toBe(0);
        expect(fixture.redis.size).toBe(0);
    });

    it('serializes concurrent promotions through their queue writes', async () => {
        const original = await create(10);
        const changing = signal();
        const resume = signal();
        const lockWait = signal();
        fixture.beforeChange = async (_id, priority) => {
            if (priority !== 5) return;
            changing.resolve();
            await resume.promise;
        };
        const guest = create(5);
        await changing.promise;
        fixture.onLockWait = lockWait.resolve;
        const authenticated = create(1);
        await Promise.race([lockWait.promise, authenticated]);
        resume.resolve();
        await Promise.all([guest, authenticated]);
        expect(fixture.tasks().every(task => task.priority === 1)).toBe(true);
        expect(fixture.jobs.get(original.taskIds.save)!.priority).toBe(1);
        expect(fixture.addCount).toBe(1);
    });

    it('serializes a stale dispatch read with promotion and preserves SQL priority during reconstruction', async () => {
        const original = await create(10);
        fixture.rows.get(entities.Task)!.get(original.taskIds.save)!.status = TaskStatus.COMPLETED;
        fixture.jobs.get(original.taskIds.save)!.state = 'completed';
        const adding = signal();
        const resume = signal();
        const lockWait = signal();
        fixture.beforeAdd = async id => {
            if (id !== original.taskIds.waiting) return;
            adding.resolve();
            await resume.promise;
        };
        const dispatch = WorkflowScheduler.releaseDescendants(original.taskIds.save);
        await adding.promise;
        fixture.onLockWait = lockWait.resolve;
        const promotion = create(1);
        await Promise.race([lockWait.promise, promotion]);
        resume.resolve();
        await Promise.all([dispatch, promotion]);
        expect(fixture.jobs.get(original.taskIds.waiting)!.priority).toBe(1);
        expect(fixture.tasks().every(task => task.priority === 1)).toBe(true);

        fixture.redis.clear();
        // The real service authored this workflow in the fixture's SQL repository.
        const workflow = fixture.rows
            .get(entities.Workflow)!
            .get(original.workflowId)! as unknown as WorkflowEntity;
        await WorkflowRuntimeStore.rebuildRuntimeFromRows(workflow, fixture.tasks());
        const runtimeTask = await WorkflowRuntimeStore.getRuntimeTask(original.taskIds.waiting);
        expect(runtimeTask.priority).toBe(1);
        const addCount = fixture.addCount;
        await WorkflowScheduler.dispatchReadyTasksForWorkflow(workflow, fixture.tasks());
        expect(fixture.addCount).toBe(addCount);
        expect(fixture.jobs.get(original.taskIds.future)!.priority).toBe(1);
    });
});
