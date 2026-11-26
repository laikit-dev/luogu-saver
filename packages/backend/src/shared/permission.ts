export enum UserRole {
    BANNED = 0,
    USER = 1,
    MODERATOR = 2,
    ADMIN = -1
}

export const ROLE_ADMIN = UserRole.ADMIN;
export const ROLE_DEFAULT = UserRole.USER;

const ROLE_RANK: Record<UserRole, number> = {
    [UserRole.BANNED]: 0,
    [UserRole.USER]: 1,
    [UserRole.MODERATOR]: 2,
    [UserRole.ADMIN]: 3
};

export function isValidUserRole(value: unknown): value is UserRole {
    return (
        value === UserRole.BANNED ||
        value === UserRole.USER ||
        value === UserRole.MODERATOR ||
        value === UserRole.ADMIN
    );
}

/** Maps legacy bitmask roles (e.g. `3 = LOGIN | CREATE_WORKFLOW`) to the 4-state enum without DB migration. */
export function normalizeUserRole(rawRole: unknown): UserRole {
    if (typeof rawRole !== 'number' || !Number.isInteger(rawRole)) {
        return UserRole.BANNED;
    }
    if (rawRole === UserRole.ADMIN) return UserRole.ADMIN;
    if (rawRole === UserRole.BANNED || rawRole < 0) return UserRole.BANNED;
    if (rawRole === UserRole.MODERATOR) return UserRole.MODERATOR;
    return UserRole.USER;
}

export function hasRole(rawRole: unknown, requiredRole: UserRole): boolean {
    const actual = normalizeUserRole(rawRole);
    if (actual === UserRole.BANNED) return false;
    return ROLE_RANK[actual] >= ROLE_RANK[requiredRole];
}
