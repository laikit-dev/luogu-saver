import { Cacheable } from '@/decorators/cacheable';
import { CacheEvict, evictCache } from '@/decorators/cache-evict';
import { User } from '@/entities/user';
import { UserProfileHistory } from '@/entities/user-profile-history';
import { EntityManager } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { PROFILE_TTL_MS, UserColor, UserPrize } from '@/shared/user';
import type { ProfileSnapshotData } from '@/shared/archive';
import { isDuplicateKeyError, retryOnTransactionConflict } from '@/utils/db-errors';

export interface SaveLuoguUserProfileInput {
    uid: number;
    name: string;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[];
}

export interface SaveLuoguUserProfileResult {
    user: User;
    changed: boolean;
    recorded: boolean;
}

function normalizeProfile(
    data: Omit<ProfileSnapshotData, 'prizes'> & { prizes: UserPrize[] | null }
): ProfileSnapshotData {
    return {
        id: data.id,
        name: data.name,
        color: data.color,
        ccfLevel: data.ccfLevel ?? 0,
        xcpcLevel: data.xcpcLevel ?? 0,
        slogan: typeof data.slogan === 'string' && data.slogan.length > 0 ? data.slogan : null,
        introduction:
            typeof data.introduction === 'string' && data.introduction.length > 0
                ? data.introduction
                : null,
        prizes: (data.prizes ?? []).map(prize => ({
            year: prize.year,
            contest: prize.contest,
            event: typeof prize.event === 'string' ? prize.event : null,
            prize: prize.prize,
            ...(typeof prize.score === 'number' ? { score: prize.score } : {}),
            ...(typeof prize.rank === 'number' ? { rank: prize.rank } : {})
        }))
    };
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
     * Upsert from the inline content path (article / paste authors).
     *
     * Only writes identity + dynamic-level fields, never `prizes` or `profile_fetched_at`.
     * This is what preserves richer profile data between inline upserts and the dedicated
     * `save:profile` task; see `spec/user-system.spec.md` Section 3.
     */
    @CacheEvict((data: Partial<User>) => (data.id === undefined ? [] : `user:${data.id}`))
    static async upsertLuoguUser(data: Partial<User>, manager?: EntityManager): Promise<User> {
        if (data.id === undefined) {
            throw new Error('User ID is required');
        }

        const repository = getServiceRepository<User>(User, manager);
        const restricted: Partial<User> = {
            id: data.id,
            name: data.name,
            color: data.color,
            ccfLevel: data.ccfLevel ?? 0,
            xcpcLevel: data.xcpcLevel ?? 0
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
        if (!Number.isInteger(input.uid) || input.uid < 1 || input.uid > 4294967295) {
            throw new Error('Invalid user ID');
        }
        const snapshot = normalizeProfile({ ...input, id: input.uid });
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

                const changed = created || !profilesEqual(normalizeProfile(user), snapshot);
                let recorded = false;
                if (user.profileHistoryEnabled) {
                    // A locking read sees commits newer than the initial existence read.
                    const latest = await historyRepository.findOne({
                        where: { userId: input.uid },
                        order: { version: 'DESC' },
                        select: { snapshot: true },
                        lock: { mode: 'pessimistic_read' }
                    });
                    if (!latest || !profilesEqual(normalizeProfile(latest.snapshot), snapshot)) {
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
