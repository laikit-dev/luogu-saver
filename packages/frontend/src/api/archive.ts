import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { UserPrize, UserProfile } from '@/types/user';

const UINT32_MAX = 4_294_967_295;

export function parsePositiveIntId(value: unknown): number | null {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed <= UINT32_MAX ? parsed : null;
}
export interface ArchiveStats {
    articles: number;
    versions: number;
    profiles: number;
}

export interface AuthorArticlesQuery {
    cursor?: string;
    limit?: number;
    category?: number;
    sort?: 'archived' | 'published';
}

export interface ArchiveArticleSummary {
    id: string;
    title: string;
    category: number;
    summary: string | null;
    createdAt: string;
    publishedAt: string | null;
}

export interface ArchiveArticlePage {
    items: ArchiveArticleSummary[];
    nextCursor: string | null;
}

export type ProfileSnapshotData = Pick<
    UserProfile,
    'id' | 'name' | 'color' | 'ccfLevel' | 'xcpcLevel' | 'slogan' | 'introduction'
> & { prizes: UserPrize[] };

export interface ProfileVersionMetadata {
    version: number;
    observedAt: string;
    name: string;
}

export interface ProfileVersionSnapshot {
    version: number;
    observedAt: string;
    profile: ProfileSnapshotData;
}

export async function getUserArchiveStats(uid: number) {
    return (await apiFetch(`/archive/user/${uid}/stats`)) as ApiResponse<ArchiveStats>;
}

export async function getAuthorArticles(
    uid: number,
    query: AuthorArticlesQuery = {},
    signal?: AbortSignal
) {
    return (await apiFetch(`/archive/user/${uid}/articles`, {
        params: query,
        signal
    })) as ApiResponse<ArchiveArticlePage>;
}

export async function getProfileVersions(uid: number) {
    return (await apiFetch(`/user/history/${uid}`)) as ApiResponse<{
        versions: ProfileVersionMetadata[];
        latestVersion: number | null;
    }>;
}

export async function getProfileVersion(uid: number, version: number) {
    return (await apiFetch(
        `/user/history/${uid}/${version}`
    )) as ApiResponse<ProfileVersionSnapshot>;
}
