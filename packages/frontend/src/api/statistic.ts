import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';

export interface QueueStatsCounts {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
    prioritized: number;
    waitingChildren: number;
}

export interface QueueStatsItem {
    name: string;
    taskType: string;
    label: string;
    concurrency: number;
    isPaused: boolean;
    counts: QueueStatsCounts;
}

export interface QueueStatsResponse {
    generatedAt: string;
    queuePoolSize: number;
    queues: QueueStatsItem[];
}

export interface SiteStatsSummary {
    articles: number;
    pastes: number;
    users: number;
    articleRevisions: number;
    comments: number;
    judgements: number;
    totalViews: number;
    totalUpvotes: number;
    totalFavors: number;
    publishedTimeKnown: number;
}

export interface CategoryStatItem {
    category: number;
    count: number;
    totalViews: number;
    totalUpvotes: number;
    totalFavors: number;
}

export interface DailyArchivePoint {
    date: string;
    count: number;
}

export interface HourlyPublishPoint {
    hour: number;
    count: number;
}

export interface YearlyPublishPoint {
    year: number;
    count: number;
}

export interface UserColorStatItem {
    color: string;
    count: number;
}

export interface CcfLevelStatItem {
    level: number;
    count: number;
}

export interface TopProblemStatItem {
    pid: string;
    solutionCount: number;
}

export interface StatsAuthorIdentity {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

export interface TopAuthorStatItem extends StatsAuthorIdentity {
    articleCount: number;
    totalUpvotes: number;
    totalViews: number;
}

export interface TopArticleStatItem {
    id: string;
    title: string;
    category: number;
    upvote: number;
    favorCount: number;
    viewCount: number;
    author: StatsAuthorIdentity | null;
}

export interface SiteStatsOverviewResponse {
    generatedAt: string;
    cachedTtlSeconds: number;
    summary: SiteStatsSummary;
    categories: CategoryStatItem[];
    recentDailyArchives: DailyArchivePoint[];
    publishHourDistribution: HourlyPublishPoint[];
    publishYearDistribution: YearlyPublishPoint[];
    userColors: UserColorStatItem[];
    ccfLevels: CcfLevelStatItem[];
    topProblems: TopProblemStatItem[];
    topAuthors: TopAuthorStatItem[];
    topArticlesByUpvote: TopArticleStatItem[];
    topArticlesByView: TopArticleStatItem[];
}

export async function getSiteStatsOverview() {
    return (await apiFetch('/stats/overview')) as ApiResponse<SiteStatsOverviewResponse>;
}

export async function getQueueStats() {
    return (await apiFetch('/stats/queues')) as ApiResponse<QueueStatsResponse>;
}
