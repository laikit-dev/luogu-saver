export interface UserIdentity {
    id: number;
    name?: string;
    color?: string;
    ccfLevel?: number;
    xcpcLevel?: number;
    badge?: string | null;
}

export interface User extends UserIdentity {
    createdAt: number;
    updatedAt: number;
}

export interface UserPrize {
    year: number;
    contest: string;
    event: string | null;
    prize: string;
    score?: number;
    rank?: number;
}

export interface UserProfile {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[] | null;
    profileFetchedAt: string | null;
    profileStale: boolean;
    profileRefreshTaskId: string | null;
    createdAt: string;
    updatedAt: string;
}
