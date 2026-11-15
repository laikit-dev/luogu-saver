import { apiFetch } from '@/utils/request.ts';
import { getPublicApiBaseUrl } from '@/utils/api-base-url.ts';
import type { ApiResponse } from '@/types/common';
import type { UserPrize, UserProfile } from '@/types/user';

export type ArchiveKind = 'article' | 'version' | 'profile';

export interface TimelineQuery {
    kinds?: ArchiveKind[];
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
}

export interface ArchiveEvent {
    eventId: string;
    kind: ArchiveKind;
    observedAt: string;
    uid: number;
    title: string;
    articleId: string | null;
    version: number | null;
    publishedAt: string | null;
}

export interface TimelinePage {
    items: ArchiveEvent[];
    nextCursor: string | null;
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

export interface ArticleVersionMetadata {
    version: number;
    createdAt: string;
    title: string;
}

export interface ArticleVersionSnapshot extends ArticleVersionMetadata {
    content: string;
}

export interface ArticleVersionComparison {
    from: ArticleVersionSnapshot;
    to: ArticleVersionSnapshot;
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

export async function getUserArchiveTimeline(uid: number, query: TimelineQuery = {}) {
    return (await apiFetch(`/archive/user/${uid}/timeline`, {
        params: { ...query, kinds: query.kinds?.length ? query.kinds.join(',') : undefined }
    })) as ApiResponse<TimelinePage>;
}

export async function getUserArchiveStats(uid: number) {
    return (await apiFetch(`/archive/user/${uid}/stats`)) as ApiResponse<ArchiveStats>;
}

export async function getAuthorArticles(uid: number, query: AuthorArticlesQuery = {}) {
    return (await apiFetch(`/archive/user/${uid}/articles`, {
        params: query
    })) as ApiResponse<ArchiveArticlePage>;
}

export async function getArticleVersions(articleId: string) {
    return (await apiFetch(
        `/archive/article/${encodeURIComponent(articleId)}/versions`
    )) as ApiResponse<{
        versions: ArticleVersionMetadata[];
        latestVersion: number | null;
    }>;
}

export async function getArticleVersionComparison(articleId: string, from: number, to: number) {
    return (await apiFetch(`/archive/article/${encodeURIComponent(articleId)}/compare`, {
        params: { from, to }
    })) as ApiResponse<ArticleVersionComparison>;
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

export function getUserRssUrl(uid: number, kinds?: ArchiveKind[]): string {
    const url = new URL(`archive/user/${uid}/rss`, getPublicApiBaseUrl());
    if (kinds?.length) url.searchParams.set('kinds', kinds.join(','));
    return url.href;
}
