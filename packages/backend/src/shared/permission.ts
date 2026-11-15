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
export const ROLE_DEFAULT = Permission.LOGIN | Permission.CREATE_WORKFLOW;
