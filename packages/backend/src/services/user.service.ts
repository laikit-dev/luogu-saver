import { Cacheable } from '@/decorators/cacheable';
import { CacheEvict, evictCache } from '@/decorators/cache-evict';
import { User, type UserPrize } from '@/entities/user';
import { UserProfileHistory, type ProfileSnapshotData } from '@/entities/user-profile-history';
import { toProfileSnapshot } from '@/services/helpers/profile-snapshot.helper';
import { EntityManager } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { UserColor } from '@/shared/user';
import { isDuplicateKeyError, retryOnTransactionConflict } from '@/utils/db-errors';

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SaveLuoguUserProfileInput {
    uid: number;
    name: string;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    badge?: string | null;
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[];
}

export interface SaveLuoguUserProfileResult {
    user: User;
    changed: boolean;
    recorded: boolean;
}

function normalizeBadge(badge: unknown): string | null | undefined {
    return typeof badge === 'string' ? badge.trim() || null : badge === null ? null : undefined;
}

function profilesEqual(left: ProfileSnapshotData, right: ProfileSnapshotData): boolean {
    return (
        left.id === right.id &&
        left.name === right.name &&
        left.color === right.color &&
        left.ccfLevel === right.ccfLevel &&
        left.xcpcLevel === right.xcpcLevel &&
        left.slogan === right.slogan &&
        left.introduction === right.introduction &&
        left.prizes.length === right.prizes.length &&
        left.prizes.every((prize, index) => {
            const other = right.prizes[index];
            return (
                prize.year === other.year &&
                prize.contest === other.contest &&
                prize.event === other.event &&
                prize.prize === other.prize &&
                prize.score === other.score &&
                prize.rank === other.rank
            );
        })
    );
}

export class UserService {
    /*
     * Get user by ID with caching
     *
     * Result will be cached for 10 minutes
     *
     * @param id User ID
     * @returns User object or null if not found
     */
    @Cacheable(600, id => `user:${id}`, User)
    static async getUserById(id: number, manager?: EntityManager): Promise<User | null> {
        return await getServiceRepository<User>(User, manager).findOne({ where: { id } });
    }

    static async getUserByIdWithoutCache(id: number): Promise<User | null> {
        return await this.getUserById(id, User.getRepository().manager);
    }

    /*
     * Save a user
     *
     * Will evict the cache for this user ID
     *
     * @param user User object to save
     * @returns Saved user object
     */
    @CacheEvict((user: User) => `user:${user.id}`)
    static async saveUser(user: User, manager?: EntityManager): Promise<User> {
        return await getServiceRepository<User>(User, manager).save(user);
    }

    static createUser(data: Partial<User>, manager?: EntityManager): User {
        return getServiceRepository<User>(User, manager).create(data);
    }

    /*
     * Upsert from the inline content path (article, paste, and comment authors).
     *
     * Only writes identity, levels, and the optional badge, never `prizes` or `profile_fetched_at`.
     * This is what preserves richer profile data between inline upserts and the dedicated
     * `save:profile` task; see `spec/user-system.spec.md` Section 3.
     */
    @CacheEvict((data: Partial<User>) => (data.id === undefined ? [] : `user:${data.id}`))
    static async upsertLuoguUser(data: Partial<User>, manager?: EntityManager): Promise<User> {
        if (data.id === undefined) {
            throw new Error('User ID is required');
        }

        const repository = getServiceRepository<User>(User, manager);
        const badge = normalizeBadge(data.badge);
        const restricted: Partial<User> = {
            id: data.id,
            name: data.name,
            color: data.color,
            ccfLevel: data.ccfLevel ?? 0,
            xcpcLevel: data.xcpcLevel ?? 0,
            ...(badge === undefined ? {} : { badge })
        };
        const user = repository.create(restricted);
        await repository.upsert(user, {
            conflictPaths: ['id'],
            skipUpdateIfNoValuesChanged: true
        });
        return user;
    }

    /*
     * Own the transaction so conflict retries and cache eviction follow its commit.
     * Inline author summaries never enter this full-profile history path.
     */
    static async saveLuoguUserProfile(
        input: SaveLuoguUserProfileInput
    ): Promise<SaveLuoguUserProfileResult> {
        const snapshot = toProfileSnapshot({ ...input, id: input.uid });
        const incomingBadge = normalizeBadge(input.badge);
        const result = await retryOnTransactionConflict(() =>
            User.transaction(async manager => {
                const repository = manager.getRepository(User);
                const historyRepository = manager.getRepository(UserProfileHistory);
                const observedAt = new Date();
                let user = await repository.findOne({ where: { id: input.uid } });
                let created = false;

                if (!user) {
                    const candidate = repository.create({
                        ...snapshot,
                        badge: incomingBadge ?? null,
                        profileFetchedAt: observedAt,
                        profileHistoryEnabled: true,
                        profileHistoryVersion: 0
                    });
                    try {
                        // Insert before taking any missing-row gap lock.
                        await repository.insert(candidate);
                        user = candidate;
                        created = true;
                    } catch (error) {
                        if (!isDuplicateKeyError(error)) throw error;
                    }
                }

                if (!created) {
                    user = await repository.findOne({
                        where: { id: input.uid },
                        lock: { mode: 'pessimistic_write' }
                    });
                }
                if (!user) throw new Error(`User ${input.uid} disappeared before profile save`);

                const currentBadge = user.badge ?? null;
                const badge = incomingBadge === undefined ? currentBadge : incomingBadge;
                const changed =
                    created ||
                    badge !== currentBadge ||
                    !profilesEqual(toProfileSnapshot(user), snapshot);
                let recorded = false;
                if (user.profileHistoryEnabled) {
                    // A locking read sees commits newer than the initial existence read.
                    const latest = await historyRepository.findOne({
                        where: { userId: input.uid },
                        order: { version: 'DESC' },
                        select: { snapshot: true },
                        lock: { mode: 'pessimistic_read' }
                    });
                    if (!latest || !profilesEqual(latest.snapshot, snapshot)) {
                        const version = user.profileHistoryVersion + 1;
                        if (version > 4294967295) throw new Error('Profile version limit reached');
                        await historyRepository.insert({
                            userId: input.uid,
                            version,
                            snapshot,
                            createdAt: observedAt
                        });
                        user.profileHistoryVersion = version;
                        recorded = true;
                    }
                }

                const values = {
                    ...snapshot,
                    badge,
                    profileFetchedAt: observedAt,
                    profileHistoryVersion: user.profileHistoryVersion
                };
                await repository.update(input.uid, values);
                return {
                    user: repository.create({ ...user, ...values }),
                    changed,
                    recorded
                };
            })
        );
        await evictCache(`user:${input.uid}`);
        return result;
    }

    static isProfileStale(user: User | null): boolean {
        if (!user) return true;
        if (user.prizes === null || user.prizes === undefined) return true;
        if (!user.profileFetchedAt) return true;
        const fetchedAt =
            user.profileFetchedAt instanceof Date
                ? user.profileFetchedAt.getTime()
                : new Date(user.profileFetchedAt).getTime();
        return Date.now() - fetchedAt > PROFILE_TTL_MS;
    }
}
