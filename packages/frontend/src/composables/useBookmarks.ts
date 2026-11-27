import { useLocalStorage } from '@/composables/useLocalStorage';
import { CONTENT_BOOKMARK_STORAGE_PREFIX } from '@/utils/constants';
import { ref, watch } from 'vue';

export interface Bookmark {
    id: string;
    name: string;
    headingId: string;
    headingText: string;
    createdAt: number;
    contentTitle?: string;
}

export type BookmarkContentType = 'article' | 'paste';

export interface ContentBookmarkGroup {
    type: BookmarkContentType;
    contentId: string;
    contentTitle?: string;
    bookmarks: Bookmark[];
    updatedAt: number;
}

const BOOKMARK_KEY_SUFFIX_PATTERN = /^(article|paste)_(.+)$/;

function isBookmarkRecord(value: unknown): value is Bookmark {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return (
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.headingId === 'string' &&
        typeof item.headingText === 'string' &&
        typeof item.createdAt === 'number'
    );
}

function normalizeBookmarkList(raw: unknown): Bookmark[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isBookmarkRecord);
}

function areBookmarkListsEqual(a: readonly Bookmark[], b: readonly Bookmark[]): boolean {
    if (a.length !== b.length) return false;
    return a.every(
        (item, index) =>
            item.id === b[index]?.id &&
            item.name === b[index]?.name &&
            item.headingId === b[index]?.headingId
    );
}

/** Highest numeric suffix among bookmark ids of the form `<idPrefix><n>`; 0 when none match. */
export function getNextBookmarkCounter(idPrefix: string, bookmarks: Bookmark[]): number {
    return bookmarks.reduce((maximum, bookmark) => {
        if (!bookmark.id.startsWith(idPrefix)) return maximum;
        const suffix = bookmark.id.slice(idPrefix.length);
        if (!/^[1-9]\d*$/.test(suffix)) return maximum;
        const counter = Number(suffix);
        return Number.isSafeInteger(counter) && counter > maximum ? counter : maximum;
    }, 0);
}

/** Enumerate all stored paragraph bookmark groups across articles and pastes, sorted by recency. */
export function listAllContentBookmarks(): ContentBookmarkGroup[] {
    if (typeof localStorage === 'undefined') return [];

    const groups: ContentBookmarkGroup[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(CONTENT_BOOKMARK_STORAGE_PREFIX)) continue;

        const suffix = key.slice(CONTENT_BOOKMARK_STORAGE_PREFIX.length);
        const match = BOOKMARK_KEY_SUFFIX_PATTERN.exec(suffix);
        if (!match?.[1] || !match[2]) continue;

        const type = match[1] as BookmarkContentType;
        const contentId = match[2];
        const rawValue = localStorage.getItem(key);
        if (!rawValue) continue;

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawValue);
        } catch {
            continue;
        }

        const validBookmarks = normalizeBookmarkList(parsed).sort(
            (a, b) => b.createdAt - a.createdAt
        );
        if (validBookmarks.length === 0) continue;

        const contentTitle = validBookmarks.find(b => b.contentTitle?.trim())?.contentTitle?.trim();
        groups.push({
            type,
            contentId,
            contentTitle,
            bookmarks: validBookmarks,
            updatedAt: validBookmarks[0]!.createdAt
        });
    }

    return groups.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete a single bookmark from storage via the shared `useLocalStorage` ref so active views stay synced. */
export function deleteContentBookmark(
    type: BookmarkContentType,
    contentId: string,
    bookmarkId: string
): void {
    const key = `${CONTENT_BOOKMARK_STORAGE_PREFIX}${type}_${contentId}`;
    const stored = useLocalStorage<Bookmark[] | null>(key, null);
    const remaining = normalizeBookmarkList(stored.value).filter(b => b.id !== bookmarkId);
    stored.value = remaining.length > 0 ? remaining : null;
}

/** Clear all paragraph bookmark groups through `useLocalStorage` refs; returns count of cleared groups. */
export function clearAllContentBookmarks(): number {
    if (typeof localStorage === 'undefined') return 0;

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CONTENT_BOOKMARK_STORAGE_PREFIX)) {
            keys.push(key);
        }
    }
    for (const key of keys) {
        useLocalStorage<Bookmark[] | null>(key, null).value = null;
    }
    return keys.length;
}

export function useBookmarks(
    type: BookmarkContentType,
    contentId: string,
    getContentTitle?: () => string | undefined
) {
    const key = `${CONTENT_BOOKMARK_STORAGE_PREFIX}${type}_${contentId}`;
    const idPrefix = `bm-${type}-${contentId}-`;
    const stored = useLocalStorage<Bookmark[] | null>(key, null);
    const bookmarks = ref<Bookmark[]>(normalizeBookmarkList(stored.value));

    watch(
        bookmarks,
        newVal => {
            stored.value = newVal.length > 0 ? newVal : null;
        },
        { deep: true }
    );

    watch(
        stored,
        newStored => {
            const normalized = normalizeBookmarkList(newStored);
            if (!areBookmarkListsEqual(bookmarks.value, normalized)) {
                bookmarks.value = normalized;
            }
        },
        { deep: true }
    );

    let idCounter = getNextBookmarkCounter(idPrefix, bookmarks.value);

    const addBookmark = (headingId: string, headingText: string): Bookmark | null => {
        // Prevent duplicate bookmarks for the same heading
        if (bookmarks.value.some(b => b.headingId === headingId)) {
            return null;
        }
        idCounter++;
        const resolvedTitle = getContentTitle?.()?.trim();
        const bookmark: Bookmark = {
            id: `${idPrefix}${idCounter}`,
            name: `段落收藏 #${idCounter}`,
            headingId,
            headingText,
            createdAt: Date.now(),
            ...(resolvedTitle ? { contentTitle: resolvedTitle } : {})
        };
        bookmarks.value = [...bookmarks.value, bookmark];
        return bookmark;
    };

    const removeBookmark = (bookmarkId: string) => {
        bookmarks.value = bookmarks.value.filter(b => b.id !== bookmarkId);
    };

    /**
     * Toggle bookmark: add if not present, remove if already bookmarked.
     * Returns 'added' | 'removed' | null (null when add failed for other reasons).
     */
    const toggleBookmark = (headingId: string, headingText: string): 'added' | 'removed' | null => {
        if (bookmarks.value.some(b => b.headingId === headingId)) {
            bookmarks.value = bookmarks.value.filter(b => b.headingId !== headingId);
            return 'removed';
        }
        const result = addBookmark(headingId, headingText);
        return result ? 'added' : null;
    };

    const renameBookmark = (bookmarkId: string, newName: string) => {
        bookmarks.value = bookmarks.value.map(b =>
            b.id === bookmarkId ? { ...b, name: newName } : b
        );
    };

    return {
        bookmarks,
        toggleBookmark,
        removeBookmark,
        renameBookmark
    };
}
