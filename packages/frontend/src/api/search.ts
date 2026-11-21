import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { UserIdentity } from '@/types/user';

export interface ArticleSearchHit {
    id: string;
    title: string;
    summary: string;
    authorId: number;
    authorName: string;
    author?: Required<UserIdentity> | null;
    category: number;
    tags: string[];
    updatedAt: number;
    viewCount: number;
    priority: number;
    formatted?: Partial<Record<'title' | 'summary' | 'authorName', string>>;
}

export interface ArticleSearchResponse {
    hits: ArticleSearchHit[];
    page: number;
    limit: number;
    total: number;
    processingTimeMs: number;
}

export async function searchArticles(params: {
    q?: string;
    page?: number;
    limit?: number;
    category?: number | null;
    authorId?: number | null;
}) {
    return (await apiFetch('/search/articles', { params })) as ApiResponse<ArticleSearchResponse>;
}
