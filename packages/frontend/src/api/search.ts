import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { UserIdentity } from '@/types/user';

export type ArticleSearchSort =
    | 'relevance'
    | 'updated_desc'
    | 'updated_asc'
    | 'views_desc'
    | 'priority_desc';

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

export interface ArticleSearchParams {
    q?: string;
    page?: number;
    limit?: number;
    category?: number | number[] | null;
    authorId?: number | null;
    tags?: string[];
    updatedAfter?: number | null;
    updatedBefore?: number | null;
    minViews?: number | null;
    sort?: ArticleSearchSort | null;
}

export async function searchArticles(params: ArticleSearchParams, signal?: AbortSignal) {
    const queryParams: Record<string, string | number | undefined> = {
        q: params.q,
        page: params.page,
        limit: params.limit,
        authorId: params.authorId ?? undefined,
        updatedAfter: params.updatedAfter ?? undefined,
        updatedBefore: params.updatedBefore ?? undefined,
        minViews: params.minViews ?? undefined,
        sort: params.sort && params.sort !== 'relevance' ? params.sort : undefined
    };

    if (Array.isArray(params.category)) {
        if (params.category.length > 0) {
            queryParams.category = params.category.join(',');
        }
    } else if (params.category !== null && params.category !== undefined) {
        queryParams.category = params.category;
    }

    if (params.tags?.length) {
        queryParams.tags = params.tags.join(',');
    }

    return (await apiFetch('/search/articles', {
        params: queryParams,
        signal
    })) as ApiResponse<ArticleSearchResponse>;
}
