import { Cacheable } from '@/decorators/cacheable';
import { CacheEvict } from '@/decorators/cache-evict';
import { User } from '@/entities/user';
import { EntityManager } from 'typeorm';
import {
    createServiceEntity,
    findOneServiceEntity,
    getServiceRepository,
    saveServiceEntity
} from '@/services/helpers/repository.helper';
import { PROFILE_TTL_MS, UserColor, UserPrize } from '@/shared/user';

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
        return await findOneServiceEntity<User>(User, { where: { id } }, manager);
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
        return await saveServiceEntity<User>(User, user, manager);
    }

    static createUser(data: Partial<User>, manager?: EntityManager): User {
        return createServiceEntity<User>(User, data, manager);
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
     * Profile-task write path. Authoritative for the moment: bumps `profile_fetched_at`
     * and replaces the `prizes` array wholesale. See `spec/user-system.spec.md` Section 4.4.
     */
    @CacheEvict((input: SaveLuoguUserProfileInput) => `user:${input.uid}`)
    static async saveLuoguUserProfile(
        input: SaveLuoguUserProfileInput,
        manager?: EntityManager
    ): Promise<User> {
        const repository = getServiceRepository<User>(User, manager);
        const user = repository.create({
            id: input.uid,
            name: input.name,
            color: input.color,
            ccfLevel: input.ccfLevel,
            xcpcLevel: input.xcpcLevel,
            slogan: input.slogan,
            introduction: input.introduction,
            prizes: input.prizes,
            profileFetchedAt: new Date()
        });
        await repository.upsert(user, {
            conflictPaths: ['id'],
            skipUpdateIfNoValuesChanged: false
        });
        return user;
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
