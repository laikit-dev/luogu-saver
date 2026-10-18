import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

const fixtures = vi.hoisted(() => {
    class ArchiveDigestPreference {
        static getRepository: () => unknown;
        static transaction: (run: (manager: EntityManager) => Promise<unknown>) => Promise<unknown>;
    }
    class UserNotification {
        static getRepository: () => unknown;
    }
    return {
        ArchiveDigestPreference,
        UserNotification,
        countForOwner: vi.fn(async () => 2)
    };
});

vi.mock('@/entities/archive-digest-preference', () => ({
    ArchiveDigestPreference: fixtures.ArchiveDigestPreference
}));
vi.mock('@/entities/user-notification', () => ({ UserNotification: fixtures.UserNotification }));
vi.mock('@/entities/article', () => ({ Article: class Article {} }));
vi.mock('@/entities/saved-article', () => ({ SavedArticle: class SavedArticle {} }));
vi.mock('@/entities/user-follow', () => ({ UserFollow: class UserFollow {} }));
vi.mock('@/entities/user', () => ({ User: class User {} }));
vi.mock('@/config', () => ({ config: { archive: { digestPollIntervalMs: 900_000 } } }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/services/user-timeline.service', () => ({
    UserTimelineService: { countForOwner: fixtures.countForOwner }
}));

import { ArchiveDigestScheduler } from '../src/services/archive-digest-scheduler.service';
import { LibraryService } from '../src/services/library.service';

type PreferenceRow = {
    ownerId: number;
    enabled: boolean;
    lastDigestAt: Date | null;
    nextDigestAt: Date | null;
};
type NotificationRow = {
    recipientId: number;
    type: string;
    title: string;
    content: string | null;
    metadata: Record<string, unknown> | null;
    readAt: Date | null;
};

const NOW = new Date('2026-10-01T12:00:00.123Z');
const DAY_MS = 86_400_000;
const FROM = new Date(NOW.getTime() - DAY_MS);
let preferences: Map<number, PreferenceRow>;
let notifications: NotificationRow[];
let locks: Map<number, Promise<void>>;
let failCheckpointOwner: number | null;
let onLockAttempt: (ownerId: number) => void;

function seedDue(ownerId: number): void {
    preferences.set(ownerId, {
        ownerId,
        enabled: true,
        lastDigestAt: new Date(FROM),
        nextDigestAt: new Date(NOW)
    });
}

function notificationRepository(target: NotificationRow[]) {
    return {
        create: (input: NotificationRow) => ({ ...input }),
        async save(row: NotificationRow) {
            target.push(structuredClone(row));
            return row;
        }
    };
}

async function transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    let ownerId: number | null = null;
    let preference: PreferenceRow | null = null;
    let release: (() => void) | undefined;
    const pendingNotifications: NotificationRow[] = [];

    function readOwner(id: number): void {
        ownerId = id;
        preference = structuredClone(preferences.get(id) ?? null);
    }

    async function lockOwner(id: number): Promise<void> {
        if (release) return;
        onLockAttempt(id);
        const previous = locks.get(id) ?? Promise.resolve();
        const held = new Promise<void>(resolve => {
            release = resolve;
        });
        const chain = previous.then(() => held);
        locks.set(id, chain);
        await previous;
        readOwner(id);
    }

    const preferenceRepository = {
        createQueryBuilder() {
            let input: { ownerId: number };
            return {
                insert() {
                    return this;
                },
                values(value: { ownerId: number }) {
                    input = value;
                    return this;
                },
                orUpdate() {
                    return this;
                },
                async execute() {
                    await lockOwner(input.ownerId);
                    preference ??= {
                        ownerId: input.ownerId,
                        enabled: false,
                        lastDigestAt: null,
                        nextDigestAt: null
                    };
                    return {};
                }
            };
        },
        async findOne(options: { where: { ownerId: number }; lock?: { mode: string } }) {
            if (options.lock?.mode === 'pessimistic_write') {
                await lockOwner(options.where.ownerId);
            } else {
                readOwner(options.where.ownerId);
            }
            return preference;
        },
        async findOneOrFail(options: { where: { ownerId: number }; lock?: { mode: string } }) {
            const row = await this.findOne(options);
            if (!row) throw new Error('Preference not found');
            return row;
        },
        async save(row: PreferenceRow) {
            if (row.ownerId === failCheckpointOwner) {
                failCheckpointOwner = null;
                throw new Error('Checkpoint write failed');
            }
            preference = structuredClone(row);
            return row;
        }
    };
    const manager = {
        getRepository(entity: unknown) {
            return entity === fixtures.ArchiveDigestPreference
                ? preferenceRepository
                : notificationRepository(pendingNotifications);
        }
    } as unknown as EntityManager;
    try {
        const result = await run(manager);
        if (ownerId !== null && preference) preferences.set(ownerId, structuredClone(preference));
        notifications.push(...pendingNotifications);
        return result;
    } finally {
        release?.();
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    preferences = new Map();
    notifications = [];
    locks = new Map();
    failCheckpointOwner = null;
    onLockAttempt = () => {};
    fixtures.countForOwner.mockReset();
    fixtures.countForOwner.mockResolvedValue(2);
    fixtures.ArchiveDigestPreference.transaction = transaction;
    fixtures.ArchiveDigestPreference.getRepository = () => ({
        async find(options: {
            where: { ownerId: { value: number }; nextDigestAt: { value: Date } };
            take: number;
        }) {
            return [...preferences.values()]
                .filter(
                    row =>
                        row.ownerId > options.where.ownerId.value &&
                        row.enabled &&
                        row.nextDigestAt !== null &&
                        row.nextDigestAt <= options.where.nextDigestAt.value
                )
                .sort((left, right) => left.ownerId - right.ownerId)
                .slice(0, options.take)
                .map(row => ({ ownerId: row.ownerId }));
        },
        async findOne(options: { where: { ownerId: number } }) {
            return structuredClone(preferences.get(options.where.ownerId) ?? null);
        }
    });
    fixtures.UserNotification.getRepository = () => notificationRepository(notifications);
});

afterEach(() => {
    ArchiveDigestScheduler.stop();
    vi.useRealTimers();
});

describe('archive digest checkpoints', () => {
    it('starts fresh on enable/re-enable and preserves checkpoints on repeated state changes', async () => {
        expect(await LibraryService.getDigestPreference(1)).toEqual({
            enabled: false,
            nextDigestAt: null
        });
        const enabled = await LibraryService.setDigestPreference(1, true);
        expect(enabled).toEqual({
            enabled: true,
            nextDigestAt: new Date(NOW.getTime() + DAY_MS).toISOString()
        });
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);

        vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
        expect(await LibraryService.setDigestPreference(1, true)).toEqual(enabled);
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);
        expect(await LibraryService.setDigestPreference(1, false)).toEqual({
            enabled: false,
            nextDigestAt: null
        });

        const resumedAt = new Date(NOW.getTime() + 2 * DAY_MS);
        vi.setSystemTime(resumedAt);
        expect(await LibraryService.setDigestPreference(1, true)).toEqual({
            enabled: true,
            nextDigestAt: new Date(resumedAt.getTime() + DAY_MS).toISOString()
        });
        expect(preferences.get(1)?.lastDigestAt).toEqual(resumedAt);
    });

    it('rolls back the notification with a failed checkpoint and sends once on a later pass', async () => {
        seedDue(1);
        failCheckpointOwner = 1;
        await ArchiveDigestScheduler.sendDueDigests(NOW);
        expect(notifications).toEqual([]);
        expect(preferences.get(1)?.lastDigestAt).toEqual(FROM);
        expect(preferences.get(1)?.nextDigestAt).toEqual(NOW);

        await ArchiveDigestScheduler.sendDueDigests(NOW);
        expect(notifications).toEqual([
            expect.objectContaining({
                recipientId: 1,
                type: 'archive_digest',
                readAt: null,
                metadata: {
                    kind: 'archive_digest',
                    eventCount: 2,
                    from: FROM.toISOString(),
                    to: NOW.toISOString()
                }
            })
        ]);
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);
        expect(preferences.get(1)?.nextDigestAt).toEqual(new Date(NOW.getTime() + DAY_MS));
        await ArchiveDigestScheduler.sendDueDigests(NOW);
        expect(notifications).toHaveLength(1);
    });

    it('advances an empty checkpoint without notification and stops after disable', async () => {
        seedDue(1);
        fixtures.countForOwner.mockResolvedValue(0);
        await ArchiveDigestScheduler.sendDueDigests(NOW);
        expect(notifications).toEqual([]);
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);
        expect(preferences.get(1)?.nextDigestAt).toEqual(new Date(NOW.getTime() + DAY_MS));

        await LibraryService.setDigestPreference(1, false);
        fixtures.countForOwner.mockResolvedValue(2);
        await ArchiveDigestScheduler.sendDueDigests(new Date(NOW.getTime() + DAY_MS));
        expect(notifications).toEqual([]);
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);
        expect(preferences.get(1)?.nextDigestAt).toBeNull();
    });

    it('rechecks the locked checkpoint across independent scheduler instances', async () => {
        seedDue(1);
        let enterCount!: () => void;
        let finishCount!: () => void;
        const entered = new Promise<void>(resolve => {
            enterCount = resolve;
        });
        const counting = new Promise<void>(resolve => {
            finishCount = resolve;
        });
        fixtures.countForOwner.mockImplementationOnce(async () => {
            enterCount();
            await counting;
            return 2;
        });
        const firstPass = ArchiveDigestScheduler.sendDueDigests(NOW);
        await entered;
        vi.resetModules();
        // A static import shares scheduler state; reloading models a separate process's scheduler.
        const { ArchiveDigestScheduler: secondScheduler } =
            await import('../src/services/archive-digest-scheduler.service');
        let attemptedLock!: () => void;
        const secondLock = new Promise<void>(resolve => {
            attemptedLock = resolve;
        });
        onLockAttempt = attemptedLock;
        const secondPass = secondScheduler.sendDueDigests(NOW);
        await secondLock;
        finishCount();
        await Promise.all([firstPass, secondPass]);
        expect(notifications).toHaveLength(1);
        expect(preferences.get(1)?.lastDigestAt).toEqual(NOW);
        expect(preferences.get(1)?.nextDigestAt).toEqual(new Date(NOW.getTime() + DAY_MS));
    });

    it('leaves a failed owner due while committing another owner independently', async () => {
        seedDue(1);
        seedDue(2);
        failCheckpointOwner = 1;
        await ArchiveDigestScheduler.sendDueDigests(NOW);
        expect(notifications.map(row => row.recipientId)).toEqual([2]);
        expect(preferences.get(1)?.lastDigestAt).toEqual(FROM);
        expect(preferences.get(1)?.nextDigestAt).toEqual(NOW);
        expect(preferences.get(2)?.lastDigestAt).toEqual(NOW);
        expect(preferences.get(2)?.nextDigestAt).toEqual(new Date(NOW.getTime() + DAY_MS));
    });
});
