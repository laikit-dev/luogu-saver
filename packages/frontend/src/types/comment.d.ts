import type { UserIdentity } from './user';

export interface ArticleComment {
    id: string;
    content: string;
    time: number; // unix seconds
    author: UserIdentity;
}

export interface ArticleCommentsResponse {
    comments: ArticleComment[];
    commentsStale: boolean;
    commentsFetchedAt: string | null;
}
