import type { UserColor, UserPrize } from '@/shared/user';

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

export interface ArchiveStats {
    articles: number;
    versions: number;
    profiles: number;
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

export interface ProfileSnapshotData {
    id: number;
    name: string;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[];
}

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

export interface FollowedAuthor {
    uid: number;
    name: string | null;
    color: string | null;
    followedAt: string;
}

export interface SavedArticleItem {
    articleId: string;
    savedAt: string;
    available: boolean;
    article: ArchiveArticleSummary | null;
}

export interface LibraryPage<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface DigestPreference {
    enabled: boolean;
    nextDigestAt: string | null;
}
