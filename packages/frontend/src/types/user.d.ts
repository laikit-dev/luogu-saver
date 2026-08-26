export interface User {
    id: number;
    name?: string;
    color?: string;
    ccfLevel?: number;
    xcpcLevel?: number;
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
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[] | null;
    profileFetchedAt: string | null;
    profileStale: boolean;
    createdAt: string;
    updatedAt: string;
}
