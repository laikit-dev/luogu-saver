import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    clearAllContentBookmarks,
    deleteContentBookmark,
    getNextBookmarkCounter,
    listAllContentBookmarks,
    useBookmarks
} from './useBookmarks';
import { CONTENT_BOOKMARK_STORAGE_PREFIX } from '@/utils/constants';

function createMemoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear() {
            store.clear();
        },
        getItem(key: string) {
            return store.get(key) ?? null;
        },
        key(index: number) {
            return [...store.keys()][index] ?? null;
        },
        removeItem(key: string) {
            store.delete(key);
        },
        setItem(key: string, value: string) {
            store.set(key, value);
        }
    };
}

describe('useBookmarks helpers', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: createMemoryStorage()
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('computes the next bookmark counter from existing ids', () => {
        expect(
            getNextBookmarkCounter('bm-article-abc-', [
                {
                    id: 'bm-article-abc-2',
                    name: '段落收藏 #2',
                    headingId: 'h2',
                    headingText: 'Two',
                    createdAt: 200
                },
                {
                    id: 'bm-article-abc-7',
                    name: '段落收藏 #7',
                    headingId: 'h7',
                    headingText: 'Seven',
                    createdAt: 300
                }
            ])
        ).toBe(7);
    });

    it('lists, deletes, and clears stored paragraph bookmark groups', () => {
        const key1 = `${CONTENT_BOOKMARK_STORAGE_PREFIX}article_a1b2c3d4`;
        const key2 = `${CONTENT_BOOKMARK_STORAGE_PREFIX}paste_p9q8r7s6`;

        localStorage.setItem(
            key1,
            JSON.stringify([
                {
                    id: 'bm-article-a1b2c3d4-1',
                    name: '段落收藏 #1',
                    headingId: 'sec-1',
                    headingText: 'DP 状态定义',
                    createdAt: 1000,
                    contentTitle: 'P1001 题解'
                },
                {
                    id: 'bm-article-a1b2c3d4-2',
                    name: '段落收藏 #2',
                    headingId: 'sec-2',
                    headingText: '复杂度分析',
                    createdAt: 2000
                }
            ])
        );
        localStorage.setItem(
            key2,
            JSON.stringify([
                {
                    id: 'bm-paste-p9q8r7s6-1',
                    name: '段落收藏 #1',
                    headingId: 'notes',
                    headingText: '注意事项',
                    createdAt: 3000,
                    contentTitle: '剪贴板 p9q8r7s6'
                }
            ])
        );
        localStorage.setItem('unrelated_key', '[]');

        const groups = listAllContentBookmarks();
        expect(groups).toHaveLength(2);
        expect(groups[0]?.type).toBe('paste');
        expect(groups[1]?.contentTitle).toBe('P1001 题解');
        expect(groups[1]?.bookmarks.map(b => b.id)).toEqual([
            'bm-article-a1b2c3d4-2',
            'bm-article-a1b2c3d4-1'
        ]);

        deleteContentBookmark('article', 'a1b2c3d4', 'bm-article-a1b2c3d4-1');
        expect(
            listAllContentBookmarks().find(g => g.contentId === 'a1b2c3d4')?.bookmarks
        ).toHaveLength(1);

        deleteContentBookmark('article', 'a1b2c3d4', 'bm-article-a1b2c3d4-2');
        expect(localStorage.getItem(key1)).toBeNull();

        expect(clearAllContentBookmarks()).toBe(1);
        expect(listAllContentBookmarks()).toEqual([]);
        expect(localStorage.getItem('unrelated_key')).toBe('[]');
    });

    it('stores contentTitle when toggling a new bookmark', () => {
        const { bookmarks, toggleBookmark } = useBookmarks('article', 'xyz', () => '树形 DP 笔记');
        expect(toggleBookmark('intro', '前置知识')).toBe('added');
        expect(bookmarks.value).toHaveLength(1);
        expect(bookmarks.value[0]?.contentTitle).toBe('树形 DP 笔记');
        expect(toggleBookmark('intro', '前置知识')).toBe('removed');
        expect(bookmarks.value).toHaveLength(0);
    });
});
