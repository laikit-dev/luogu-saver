import { useLocalStorage } from '@/composables/useLocalStorage';
import { CONTENT_BOOKMARK_STORAGE_PREFIX } from '@/utils/constants';
import { ref, watch } from 'vue';

export interface Bookmark {
    id: string;
    name: string;
    headingId: string;
    headingText: string;
    createdAt: number;
}

export type BookmarkContentType = 'article' | 'paste';

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

// Legacy keys (`content_bookmarks_<id>`) did not record the content type, so paste bookmarks
// stored under an id that collides with an article are indistinguishable from article bookmarks;
// they are all migrated as article bookmarks. Legacy ids (`bm-<id>-<n>`) are rewritten to the
// typed prefix so the numeric counter continues from the migrated bookmarks.
function migrateLegacyArticleBookmarks(contentId: string, key: string, idPrefix: string) {
    const legacyKey = `${CONTENT_BOOKMARK_STORAGE_PREFIX}${contentId}`;
    try {
        const legacyValue = localStorage.getItem(legacyKey);
        if (legacyValue === null) return;
        if (localStorage.getItem(key) === null) {
            const legacyIdPrefix = `bm-${contentId}-`;
            const legacyBookmarks: unknown = JSON.parse(legacyValue);
            if (Array.isArray(legacyBookmarks)) {
                const migrated = (legacyBookmarks as Bookmark[]).map(bookmark =>
                    typeof bookmark?.id === 'string' && bookmark.id.startsWith(legacyIdPrefix)
                        ? { ...bookmark, id: idPrefix + bookmark.id.slice(legacyIdPrefix.length) }
                        : bookmark
                );
                localStorage.setItem(key, JSON.stringify(migrated));
            }
        }
        localStorage.removeItem(legacyKey);
    } catch (e) {
        console.error(`Error migrating localStorage key "${legacyKey}":`, e);
    }
}

export function useBookmarks(type: BookmarkContentType, contentId: string) {
    const key = `${CONTENT_BOOKMARK_STORAGE_PREFIX}${type}_${contentId}`;
    const idPrefix = `bm-${type}-${contentId}-`;
    if (type === 'article') migrateLegacyArticleBookmarks(contentId, key, idPrefix);
    const stored = useLocalStorage<Bookmark[]>(key, []);
    const bookmarks = ref<Bookmark[]>(stored.value ?? []);

    watch(
        bookmarks,
        newVal => {
            stored.value = newVal;
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
        const bookmark: Bookmark = {
            id: `${idPrefix}${idCounter}`,
            name: `段落收藏 #${idCounter}`,
            headingId,
            headingText,
            createdAt: Date.now()
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
