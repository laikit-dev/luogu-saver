import type { UserIdentity } from './user';

export interface ArticleComment {
    id: string;
    content: string;
    time: number; // unix seconds
    author: UserIdentity;
}

export interface ArticleCommentsQuery {
    cursor?: string;
    limit?: number;
}

export interface ArticleCommentsResponse {
    comments: ArticleComment[];
    nextCursor: string | null;
    commentsStale: boolean;
    commentsFetchedAt: string | null;
}
