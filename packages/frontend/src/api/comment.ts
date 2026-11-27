import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { ArticleCommentsQuery, ArticleCommentsResponse } from '@/types/comment';

export async function getArticleComments(
    id: string,
    query: ArticleCommentsQuery = {},
    signal?: AbortSignal
) {
    return (await apiFetch(`/article/comments/${id}`, {
        params: query,
        signal
    })) as ApiResponse<ArticleCommentsResponse>;
}

export async function refreshArticleComments(id: string) {
    return (await apiFetch(`/article/comments/${id}/refresh`, {
        method: 'POST'
    })) as ApiResponse<{ taskId: string }>;
}
