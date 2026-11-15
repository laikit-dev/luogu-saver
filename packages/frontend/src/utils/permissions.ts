export enum Permission {
    LOGIN = 1 << 0,
    CREATE_WORKFLOW = 1 << 1,
    CREATE_TASK = 1 << 2,
    MANAGE_SEARCH = 1 << 3,
    MANAGE_USERS = 1 << 4,
    MANAGE_ANNOUNCEMENTS = 1 << 5,
    MANAGE_CONTENT = 1 << 7
}

export const ROLE_ADMIN = -1;

export function hasPermission(role: number | null | undefined, permission: Permission) {
    if (role === ROLE_ADMIN) return true;
    if (role === null || role === undefined) return false;
    return (role & permission) === permission;
}

export function hasAnyPermission(role: number | null | undefined, permissions: Permission[]) {
    return permissions.some(permission => hasPermission(role, permission));
}
