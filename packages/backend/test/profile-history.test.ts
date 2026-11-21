import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'koa';
import { EntityManager } from 'typeorm';
import type { DataSource } from 'typeorm';
import type { User as UserEntity } from '../src/entities/user';
import type { ProfileSnapshotData } from '../src/entities/user-profile-history';
import type { SaveTask } from '../src/workers/types';
import type { UserSummary } from '../src/types/luogu-api';

const entities = vi.hoisted(() => {
    class User {
        static getRepository: () => unknown;
        static transaction: (run: (manager: EntityManager) => Promise<unknown>) => Promise<unknown>;
    }
    class UserProfileHistory {
        static getRepository: () => unknown;
    }
    return { User, UserProfileHistory };
});
const mocks = vi.hoisted(() => ({
    cache: new Map<string, string>(),
    fetch: vi.fn(),
    emit: vi.fn(),
    failEviction: false
}));

vi.mock('@/entities/user', () => ({ User: entities.User }));
vi.mock('@/entities/user-profile-history', () => ({
    UserProfileHistory: entities.UserProfileHistory
}));
vi.mock('@/lib/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));
vi.mock('@/lib/socket', () => ({ emitToRoom: mocks.emit }));
vi.mock('@/config', () => ({
    config: { network: { luoguPublicOrigin: 'https://www.luogu.com.cn' } }
}));
vi.mock('@/utils/fetch', () => ({ fetch: mocks.fetch }));
vi.mock('@/lib/workflow-templates', () => ({ WORKFLOW_TEMPLATES_PERMISSION: {} }));
vi.mock('@/services/registered-user.service', () => ({ RegisteredUserService: {} }));
vi.mock('@/services/task.service', () => ({
    TaskService: { createTask: vi.fn(), dispatchTask: vi.fn() }
}));
vi.mock('@/lib/redis', () => ({
    redisClient: {
        async get(key: string) {
            return mocks.cache.get(key) ?? null;
        },
        async set(key: string, value: string) {
            mocks.cache.set(key, value);
            return 'OK';
        },
        async del(...keys: string[]) {
            if (mocks.failEviction) throw new Error('Redis unavailable');
            return keys.filter(key => mocks.cache.delete(key)).length;
        }
    }
}));

import { UserService } from '../src/services/user.service';
import type { SaveLuoguUserProfileInput } from '../src/services/user.service';
import { UserProfileHistoryService } from '../src/services/user-profile-history.service';
import { ProfileHandler } from '../src/workers/handlers/task/save/profile.handler';
import { C3vkMode } from '../src/shared/c3vk';
import { Permission } from '../src/shared/permission';
import { buildUser } from '../src/utils/luogu-api';
import userRouter from '../src/routers/user.router';

const { User, UserProfileHistory } = entities;
const NOW = new Date('2026-09-24T12:00:00.000Z');
type UserRow = ProfileSnapshotData & {
    badge: string | null;
    profileFetchedAt: Date | null;
    profileHistoryEnabled: boolean;
    profileHistoryVersion: number;
};
type HistoryRow = {
    id: number;
    userId: number;
    version: number;
    snapshot: ProfileSnapshotData;
    createdAt: Date;
};
type State = { users: Map<number, UserRow>; history: HistoryRow[] };
type Transaction = {
    state?: State;
    readView?: State;
    uid?: number;
    lock(uid: number): Promise<void>;
};
let committed: State;
let locks: Map<number, Promise<void>>;
let nextHistoryId: number;
let beforeCommit: (attempt: number) => Promise<void>;
let attempts: number;
let managerIdentities: Set<EntityManager>;

function input(name = 'Author'): SaveLuoguUserProfileInput {
    return {
        uid: 42,
        name,
        color: 'Gray' as SaveLuoguUserProfileInput['color'],
        ccfLevel: 3,
        xcpcLevel: 0,
        slogan: null,
        introduction: '# Biography',
        prizes: [{ year: 2025, contest: 'NOI', event: null, prize: 'Gold', score: 300 }]
    };
}

function userRepository(tx?: Transaction) {
    return {
        async findOne(options: { where: { id: number }; lock?: unknown }) {
            if (options.lock && tx) await tx.lock(options.where.id);
            if (!options.lock && tx) tx.readView ??= structuredClone(committed);
            const row = (
                options.lock ? (tx?.state ?? committed) : (tx?.readView ?? committed)
            ).users.get(options.where.id);
            return row ? Object.assign(new User(), structuredClone(row)) : null;
        },
        create(data: Record<string, unknown>) {
            return Object.assign(new User(), structuredClone(data));
        },
        async insert(row: UserRow) {
            if (!tx) throw new Error('Full-profile insertion needs a transaction');
            await tx.lock(row.id);
            if (tx.state!.users.has(row.id))
                throw Object.assign(new Error('Duplicate UID'), { errno: 1062 });
            tx.state!.users.set(row.id, structuredClone(row));
        },
        async update(uid: number, values: Partial<UserRow>) {
            if (!tx) throw new Error('Full-profile update needs a transaction');
            await tx.lock(uid);
            const row = tx.state!.users.get(uid);
            if (row) tx.state!.users.set(uid, { ...row, ...structuredClone(values) });
        },
        async upsert(row: Partial<UserRow> & { id: number }) {
            const previous = committed.users.get(row.id);
            committed.users.set(row.id, {
                badge: null,
                profileFetchedAt: null,
                profileHistoryEnabled: true,
                profileHistoryVersion: 0,
                slogan: null,
                introduction: null,
                prizes: [],
                ...previous,
                ...structuredClone(row)
            } as UserRow);
        }
    };
}

function historyRepository(tx?: Transaction) {
    return {
        async findOne(options: { where: { userId: number; version?: number }; lock?: unknown }) {
            // InnoDB consistent reads retain the initial snapshot; locking reads see current commits.
            const state = options.lock ? (tx?.state ?? committed) : (tx?.readView ?? committed);
            const rows = state.history.filter(row => row.userId === options.where.userId);
            const row =
                options.where.version === undefined
                    ? rows.sort((left, right) => right.version - left.version)[0]
                    : rows.find(item => item.version === options.where.version);
            return row ? structuredClone(row) : null;
        },
        async insert(row: Omit<HistoryRow, 'id'>) {
            if (!tx?.state || tx.uid !== row.userId)
                throw new Error('History insertion requires a locked user');
            if (
                tx.state.history.some(
                    item => item.userId === row.userId && item.version === row.version
                )
            ) {
                throw Object.assign(new Error('Duplicate version'), { errno: 1062 });
            }
            tx.state.history.push({ ...structuredClone(row), id: nextHistoryId++ });
        },
        createQueryBuilder() {
            let uid: number;
            const query = {
                select() {
                    return query;
                },
                addSelect() {
                    return query;
                },
                where(_condition: string, parameters: { uid: number }) {
                    uid = parameters.uid;
                    return query;
                },
                orderBy() {
                    return query;
                },
                async getRawMany() {
                    return committed.history
                        .filter(row => row.userId === uid)
                        .sort((left, right) => right.version - left.version)
                        .map(row => ({
                            version: row.version,
                            observedAt: row.createdAt,
                            name: row.snapshot.name
                        }));
                }
            };
            return query;
        }
    };
}

async function request(
    path: string,
    options: {
        method?: string;
        user?: { id: number; luoguUid: number; role: number };
        body?: unknown;
    } = {}
) {
    let status = 404;
    let data: unknown;
    const ctx = {
        path,
        method: options.method ?? 'GET',
        request: { body: options.body },
        user: options.user,
        params: {},
        success(value: unknown) {
            status = 200;
            data = value;
        },
        fail(code: number) {
            status = code;
        }
    } as unknown as Context;
    await userRouter.routes()(ctx, async () => {});
    return { status, data };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.clear();
    mocks.failEviction = false;
    committed = { users: new Map(), history: [] };
    locks = new Map();
    nextHistoryId = 1;
    attempts = 0;
    managerIdentities = new Set();
    beforeCommit = async () => {};
    User.getRepository = () => userRepository();
    UserProfileHistory.getRepository = () => historyRepository();
    User.transaction = async run => {
        const attempt = ++attempts;
        let release: (() => void) | undefined;
        const tx: Transaction = {
            async lock(uid) {
                if (tx.uid === uid) return;
                if (tx.uid !== undefined) throw new Error('Fixture transaction can lock one UID');
                const previous = locks.get(uid) ?? Promise.resolve();
                const current = new Promise<void>(resolve => {
                    release = resolve;
                });
                locks.set(
                    uid,
                    previous.then(() => current)
                );
                await previous;
                tx.uid = uid;
                tx.state = structuredClone(committed);
            }
        };
        const manager = new EntityManager({} as DataSource);
        managerIdentities.add(manager);
        vi.spyOn(manager, 'getRepository').mockImplementation(
            entity => (entity === User ? userRepository(tx) : historyRepository(tx)) as never
        );
        try {
            const result = await run(manager);
            await beforeCommit(attempt);
            if (tx.state && tx.uid !== undefined) {
                const row = tx.state.users.get(tx.uid);
                if (row) committed.users.set(tx.uid, row);
                committed.history = [
                    ...committed.history.filter(item => item.userId !== tx.uid),
                    ...tx.state.history.filter(item => item.userId === tx.uid)
                ];
            }
            return result;
        } finally {
            release?.();
        }
    };
});

describe('public full-profile snapshots', () => {
    it('records an unchanged rollout baseline and then skips only when retained values match', async () => {
        const profile = input();
        const { uid, ...values } = profile;
        committed.users.set(uid, {
            ...values,
            id: uid,
            badge: null,
            profileFetchedAt: NOW,
            profileHistoryEnabled: true,
            profileHistoryVersion: 0
        });
        mocks.fetch.mockResolvedValue({
            data: { user: { ...values, uid }, prizes: profile.prizes.map(prize => ({ prize })) }
        });
        const task = { payload: { targetId: '42' } } as SaveTask;
        const handler = new ProfileHandler();
        expect(await handler.handle(task)).toEqual({
            skipNextStep: false,
            data: { text: '# Biography' }
        });
        expect(await handler.handle(task)).toEqual({ skipNextStep: true, data: { text: '' } });
        expect(committed.history.map(row => row.version)).toEqual([1]);
        expect(mocks.emit).toHaveBeenCalledTimes(1);
        expect(mocks.emit).toHaveBeenCalledWith('user_42', 'user:42:profile-updated');
    });

    it('keeps historical values immutable and never captures inline-only or private fields', async () => {
        const first = input();
        await UserService.saveLuoguUserProfile(
            Object.assign(first, { token: 'secret', actorId: 9 })
        );
        first.prizes[0].prize = 'Mutated caller value';
        await UserService.upsertLuoguUser({
            id: 42,
            name: 'Inline name',
            color: first.color,
            ccfLevel: 5,
            introduction: 'Do not clobber',
            prizes: [],
            profileHistoryEnabled: false,
            profileHistoryVersion: 99
        } as Partial<UserEntity>);
        expect(committed.history[0].snapshot).toEqual({
            id: 42,
            name: 'Author',
            color: 'Gray',
            ccfLevel: 3,
            xcpcLevel: 0,
            slogan: null,
            introduction: '# Biography',
            prizes: [{ year: 2025, contest: 'NOI', event: null, prize: 'Gold', score: 300 }]
        });
        expect(committed.users.get(42)).toMatchObject({
            name: 'Inline name',
            introduction: '# Biography',
            profileHistoryEnabled: true,
            profileHistoryVersion: 1
        });
        const restored = await UserService.saveLuoguUserProfile(input());
        expect({ changed: restored.changed, recorded: restored.recorded }).toEqual({
            changed: true,
            recorded: false
        });
        expect(committed.history.map(row => row.version)).toEqual([1]);
    });

    it('pauses without hiding retained versions', async () => {
        await UserService.saveLuoguUserProfile(input());
        await UserProfileHistoryService.setRecordingEnabled(42, false);
        const paused = await UserService.saveLuoguUserProfile(input('Paused current name'));
        expect({ changed: paused.changed, recorded: paused.recorded }).toEqual({
            changed: true,
            recorded: false
        });
        expect((await UserProfileHistoryService.getVersion(42, 1))?.profile.name).toBe('Author');
    });

    it('rolls back current profile, version allocation, and cache invalidation together', async () => {
        await UserService.saveLuoguUserProfile(input());
        const previous = structuredClone(committed);
        mocks.cache.set('user:42', 'cached baseline');
        beforeCommit = async () => {
            throw new Error('Commit failed');
        };
        await expect(UserService.saveLuoguUserProfile(input('Uncommitted name'))).rejects.toThrow(
            'Commit failed'
        );
        expect(committed).toEqual(previous);
        expect(mocks.cache.get('user:42')).toBe('cached baseline');
        beforeCommit = async () => {};
        const result = await UserService.saveLuoguUserProfile(input('Committed name'));
        expect(result.user.profileHistoryVersion).toBe(2);
        expect(mocks.cache.has('user:42')).toBe(false);
    });

    it('evicts only after commit and does not turn a committed save into a failure if Redis is unavailable', async () => {
        mocks.cache.set('user:42', 'old cache');
        beforeCommit = async () => {
            expect(mocks.cache.get('user:42')).toBe('old cache');
            expect(committed.users.has(42)).toBe(false);
        };
        mocks.failEviction = true;
        const result = await UserService.saveLuoguUserProfile(input());
        expect(result.user.profileHistoryVersion).toBe(1);
        expect(committed.history[0].snapshot.name).toBe('Author');
    });

    it('retries a conflicted transaction with a fresh manager and no version hole', async () => {
        await UserService.saveLuoguUserProfile(input());
        let conflict = true;
        beforeCommit = async () => {
            if (conflict) {
                conflict = false;
                throw Object.assign(new Error('Deadlock'), { errno: 1213 });
            }
        };
        const result = await UserService.saveLuoguUserProfile(input('After conflict'));
        expect(result.user.profileHistoryVersion).toBe(2);
        expect(committed.history.map(row => [row.version, row.snapshot.name])).toEqual([
            [1, 'Author'],
            [2, 'After conflict']
        ]);
        expect(managerIdentities.size).toBe(3);
    });

    it('serializes concurrent missing-user creation and later full-profile version allocations', async () => {
        const initial = await Promise.all([
            UserService.saveLuoguUserProfile(input()),
            UserService.saveLuoguUserProfile(input())
        ]);
        expect(initial.map(result => result.recorded).sort()).toEqual([false, true]);
        expect(committed.history.map(row => row.version)).toEqual([1]);
        const updates = await Promise.all([
            UserService.saveLuoguUserProfile(input('First edit')),
            UserService.saveLuoguUserProfile(input('Second edit'))
        ]);
        expect(updates.map(result => result.user.profileHistoryVersion).sort()).toEqual([2, 3]);
        expect(committed.history.map(row => row.version)).toEqual([1, 2, 3]);
        expect(new Set(committed.history.slice(1).map(row => row.snapshot.name))).toEqual(
            new Set(['First edit', 'Second edit'])
        );
    });
});

describe('current Luogu user badges', () => {
    it('normalizes inline badges and preserves them when the upstream field is missing or invalid', async () => {
        const summary = { uid: 42, name: 'Author', color: 'Purple', ccfLevel: 6 } as UserSummary;
        const sync = (fields: object = {}) =>
            UserService.upsertLuoguUser(buildUser({ ...summary, ...fields }));

        await sync();
        expect(committed.users.get(42)?.badge).toBeNull();
        await sync({ badge: ' Aya ' });
        expect(committed.users.get(42)?.badge).toBe('Aya');
        await sync();
        await sync({ badge: 123 });
        expect(committed.users.get(42)?.badge).toBe('Aya');
        await sync({ badge: ' New tag ' });
        expect(committed.users.get(42)?.badge).toBe('New tag');
        await sync({ badge: '   ' });
        expect(committed.users.get(42)?.badge).toBeNull();
        await sync({ badge: 'Aya' });
        await sync({ badge: null });
        expect(committed.users.get(42)?.badge).toBeNull();
        expect(committed.history).toEqual([]);
    });

    it('emits updates for badge-only changes without recording them in profile history', async () => {
        const profile = input();
        const handler = new ProfileHandler();
        const task = { payload: { targetId: String(profile.uid) } } as SaveTask;
        const refresh = (fields: object = {}) => {
            mocks.fetch.mockResolvedValue({
                data: {
                    user: { ...profile, ...fields },
                    prizes: profile.prizes.map(prize => ({ prize }))
                }
            });
            return handler.handle(task);
        };

        await refresh({ badge: ' Aya ' });
        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://www.luogu.com.cn/user/42',
            C3vkMode.MODERN
        );
        expect(committed.users.get(42)?.badge).toBe('Aya');
        expect(committed.history.map(row => row.version)).toEqual([1]);
        expect(committed.history[0].snapshot).not.toHaveProperty('badge');
        mocks.emit.mockClear();

        expect((await refresh({ badge: 'New tag' })).skipNextStep).toBe(false);
        expect(committed.users.get(42)?.badge).toBe('New tag');
        expect(mocks.emit).toHaveBeenCalledExactlyOnceWith('user_42', 'user:42:profile-updated');
        mocks.emit.mockClear();

        expect((await refresh()).skipNextStep).toBe(true);
        expect((await refresh({ badge: false })).skipNextStep).toBe(true);
        expect((await refresh({ badge: ' New tag ' })).skipNextStep).toBe(true);
        expect(committed.users.get(42)?.badge).toBe('New tag');
        expect(mocks.emit).not.toHaveBeenCalled();

        expect((await refresh({ badge: null })).skipNextStep).toBe(false);
        expect(committed.users.get(42)?.badge).toBeNull();
        await refresh({ badge: 'Aya' });
        expect((await refresh({ badge: '   ' })).skipNextStep).toBe(false);
        expect(committed.users.get(42)?.badge).toBeNull();
        expect(committed.history.map(row => row.version)).toEqual([1]);
        expect(committed.users.get(42)?.profileHistoryVersion).toBe(1);
    });
});

describe('public history routes and owner isolation', () => {
    it('lists and selects arbitrary retained versions and never substitutes the current profile for missing history', async () => {
        for (let version = 1; version <= 6; version++)
            await UserService.saveLuoguUserProfile(input(`Version ${version}`));
        const metadata = await request('/user/history/42');
        expect(metadata.status).toBe(200);
        expect(metadata.data).toEqual({
            latestVersion: 6,
            versions: [6, 5, 4, 3, 2, 1].map(version => ({
                version,
                name: `Version ${version}`,
                observedAt: expect.any(String)
            }))
        });
        const historical = await request('/user/history/42/5');
        expect(historical.status).toBe(200);
        expect(historical.data).toMatchObject({
            version: 5,
            profile: { id: 42, name: 'Version 5' }
        });
        expect((await request('/user/history/42/7')).status).toBe(404);
        expect((await request('/user/history/99/5')).status).toBe(404);
        expect((await request('/user/history/99')).status).toBe(404);
        expect((await request('/user/history/42/4294967296')).status).toBe(400);
        expect((await request('/user/history/0')).status).toBe(400);
    });

    it('uses linked Luogu identity rather than account id and keeps static settings routes distinct from versions', async () => {
        await UserService.saveLuoguUserProfile(input());
        const wrongOwner = { id: 42, luoguUid: 99, role: Permission.LOGIN };
        const owner = { id: 7, luoguUid: 42, role: Permission.LOGIN };
        expect((await request('/user/history/42/settings')).status).toBe(401);
        expect(
            (await request('/user/history/42/settings', { user: { ...owner, role: 0 } })).status
        ).toBe(403);
        for (const [method, path] of [
            ['GET', 'settings'],
            ['POST', 'settings']
        ]) {
            expect(
                (
                    await request(`/user/history/42/${path}`, {
                        method,
                        user: wrongOwner,
                        body: { recordingEnabled: false }
                    })
                ).status
            ).toBe(403);
        }
        expect((await request('/user/history/99/settings', { user: wrongOwner })).status).toBe(404);
        expect(await request('/user/history/42/settings', { user: owner })).toEqual({
            status: 200,
            data: { recordingEnabled: true }
        });
        expect(
            (
                await request('/user/history/42/settings', {
                    method: 'POST',
                    user: owner,
                    body: { recordingEnabled: 'false' }
                })
            ).status
        ).toBe(400);
        expect(
            await request('/user/history/42/settings', {
                method: 'POST',
                user: owner,
                body: { recordingEnabled: false }
            })
        ).toEqual({ status: 200, data: { recordingEnabled: false } });
        expect((await request('/user/history/42/1')).status).toBe(200);
    });
});
