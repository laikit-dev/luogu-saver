export enum UserRole {
    BANNED = 0,
    USER = 1,
    MODERATOR = 2,
    ADMIN = -1
}

export const ROLE_ADMIN = UserRole.ADMIN;

const ROLE_RANK: Record<UserRole, number> = {
    [UserRole.BANNED]: 0,
    [UserRole.USER]: 1,
    [UserRole.MODERATOR]: 2,
    [UserRole.ADMIN]: 3
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
    [UserRole.BANNED]: '已封禁',
    [UserRole.USER]: '普通用户',
    [UserRole.MODERATOR]: '协管员',
    [UserRole.ADMIN]: '超级管理员'
};

export const USER_ROLE_OPTIONS = [
    { label: USER_ROLE_LABELS[UserRole.BANNED], value: UserRole.BANNED },
    { label: USER_ROLE_LABELS[UserRole.USER], value: UserRole.USER },
    { label: USER_ROLE_LABELS[UserRole.MODERATOR], value: UserRole.MODERATOR },
    { label: USER_ROLE_LABELS[UserRole.ADMIN], value: UserRole.ADMIN }
];

export function normalizeUserRole(rawRole: number | null | undefined): UserRole {
    if (typeof rawRole !== 'number' || !Number.isInteger(rawRole)) {
        return UserRole.BANNED;
    }
    if (rawRole === UserRole.ADMIN) return UserRole.ADMIN;
    if (rawRole === UserRole.BANNED || rawRole < 0) return UserRole.BANNED;
    if (rawRole === UserRole.MODERATOR) return UserRole.MODERATOR;
    return UserRole.USER;
}

export function hasRole(role: number | null | undefined, requiredRole: UserRole): boolean {
    if (role === null || role === undefined) return false;
    const actual = normalizeUserRole(role);
    if (actual === UserRole.BANNED) return false;
    return ROLE_RANK[actual] >= ROLE_RANK[requiredRole];
}
