import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { PlazaArticle } from '@/types/article';

export type PersonaTagTone = 'primary' | 'info' | 'success' | 'warning' | 'purple';

export interface PersonaTag {
    id: string;
    label: string;
    description: string;
    tone: PersonaTagTone;
}

export interface TopicTag {
    tag: string;
    count: number;
    score: number;
    share: number;
}

export interface ProfileCategoryStat {
    category: number;
    count: number;
    share: number;
}

export interface ProfileClusterArticle {
    id: string;
    title: string;
    category: number;
}

export interface ProfileInterestCluster {
    label: string;
    weight: number;
    share: number;
    dominantCategory: number | null;
    keywords: string[];
    sampleArticles: ProfileClusterArticle[];
}

export interface ProfileFavoriteAuthor {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
    count: number;
}

export type ReadingRhythmPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ReadingRhythmBucket {
    period: ReadingRhythmPeriod;
    count: number;
    share: number;
}

export interface ProfileRecentArticle {
    id: string;
    title: string;
    category: number;
    viewedAt: string;
}

export interface InterestProfileSummary {
    trackingEnabled: boolean;
    subjectKind: 'user' | 'device' | null;
    viewedCount: number;
    retentionDays: number;
    personaTags: PersonaTag[];
    topicTags: TopicTag[];
    categories: ProfileCategoryStat[];
    clusters: ProfileInterestCluster[];
    favoriteAuthors: ProfileFavoriteAuthor[];
    readingRhythm: ReadingRhythmBucket[];
    recentArticles: ProfileRecentArticle[];
}

export async function getRecommendations(exclude: string[] = []) {
    return (await apiFetch('/plaza/get', {
        params: {
            exclude: exclude.join(',')
        }
    })) as ApiResponse<PlazaArticle[]>;
}

export async function getInterestProfile() {
    return (await apiFetch('/plaza/profile')) as ApiResponse<InterestProfileSummary>;
}

export async function clearInterestProfile() {
    return (await apiFetch.delete('/plaza/profile')) as ApiResponse<{ cleared: boolean }>;
}
