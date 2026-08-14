import { User } from './user';

export interface Article {
    id: string;
    title: string;
    content?: string;
    authorId?: number;
    category?: number;
    upvote?: number;
    favorCount?: number;
    solutionForPid?: string;
    priority: number;
    deleted: boolean;
    tags?: string;
    createdAt: string;
    updatedAt: string;
    deleteReason?: string | null;
    contentHash?: string;
    publishTime?: number | null;
    viewCount: number;
    author?: User;
    renderedContent?: string;
}

export interface PlazaArticle {
    id: string;
    title: string;
    summary: string;
    category?: number;
    author?: User;
    updatedAt: string;
    tags?: string;
    reason?: string;
}

export interface TocItem {
    title: string;
    href: string;
    children?: TocItem[];
}

export interface ArticleHistory {
    id: number;
    articleId: string;
    version: number;
    title: string;
    content: string;
    createdAt: string;
}
