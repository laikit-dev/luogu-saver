import { watch, onUnmounted, nextTick, type Ref } from 'vue';
import type { ViewMode } from '@/composables/useViewMode';
import type { Bookmark } from '@/composables/useBookmarks';
import { getHeadingTitle } from '@/utils/article';

// Star icon matching Lucide's Star component for consistency with TOC collect buttons
const STAR_OUTLINE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
</svg>
`;

const STAR_FILLED_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
</svg>
`;

export function useBookmarkIcons(
    contentContainerSelector: string,
    headingSelector: string,
    viewMode: Ref<ViewMode>,
    bookmarks: Ref<Bookmark[]>,
    onToggleBookmark: (headingId: string, headingText: string) => void
) {
    let observer: MutationObserver | null = null;

    const attachIcons = () => {
        observer?.disconnect();

        const container = document.querySelector(contentContainerSelector);
        if (!container) {
            setupObserver();
            return;
        }

        container.querySelectorAll('.bookmark-heading-btn').forEach(btn => btn.remove());

        const headings = container.querySelectorAll<HTMLElement>(headingSelector);

        headings.forEach(heading => {
            const id = heading.getAttribute('id');
            if (!id) return;

            const isBookmarked = bookmarks.value.some(b => b.headingId === id);

            const btn = document.createElement('button');
            btn.className = 'bookmark-heading-btn';
            btn.setAttribute('aria-label', isBookmarked ? '已收藏' : '收藏段落');
            btn.innerHTML = isBookmarked ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
            btn.title = isBookmarked ? '点击取消收藏' : '点击收藏段落';

            btn.addEventListener('click', e => {
                e.stopPropagation();
                onToggleBookmark(id, getHeadingTitle(heading));
            });

            heading.style.position = 'relative';
            heading.style.paddingLeft = '24px';
            heading.insertBefore(btn, heading.firstChild);
        });

        setupObserver();
    };

    const setupObserver = () => {
        const container = document.querySelector(contentContainerSelector);

        if (observer) {
            observer.disconnect();
            observer = null;
        }

        observer = new MutationObserver(() => {
            if (viewMode.value === 'focus') {
                nextTick(() => attachIcons());
            }
        });

        // Observe the target container if present, otherwise fall back to document.body
        // to catch the container when it appears (e.g. on initial page load).
        observer.observe(container ?? document.body, { childList: true, subtree: true });
    };

    const cleanup = () => {
        observer?.disconnect();
        observer = null;
        const container = document.querySelector(contentContainerSelector);
        const headings = (container ?? document).querySelectorAll<HTMLElement>(headingSelector);
        headings.forEach(heading => {
            heading.style.removeProperty('position');
            heading.style.removeProperty('padding-left');
        });
        document.querySelectorAll('.bookmark-heading-btn').forEach(btn => btn.remove());
    };

    // Single watcher covers viewMode changes and all bookmark mutations (add/remove/rename)
    watch(
        [() => viewMode.value, bookmarks],
        () => {
            nextTick(() => {
                if (viewMode.value === 'focus') {
                    attachIcons();
                } else {
                    cleanup();
                }
            });
        },
        { deep: true, immediate: true }
    );

    onUnmounted(cleanup);

    return {};
}
