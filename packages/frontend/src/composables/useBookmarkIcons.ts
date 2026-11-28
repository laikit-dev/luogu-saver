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
    enabled: Ref<ViewMode | boolean>,
    bookmarks: Ref<Bookmark[]>,
    onToggleBookmark: (headingId: string, headingText: string) => void
) {
    let observer: MutationObserver | null = null;
    let justBookmarkedId: string | null = null;
    let mutationScheduled = false;
    const isActive = () => enabled.value === true || enabled.value === 'focus';

    const attachIcons = () => {
        const container = document.querySelector(contentContainerSelector);
        if (!container) {
            setupObserver();
            return;
        }

        const headings = [...container.querySelectorAll<HTMLElement>(headingSelector)].filter(h =>
            Boolean(h.getAttribute('id'))
        );
        const bookmarkedIds = new Set(bookmarks.value.map(b => b.headingId));
        const existingButtons = container.querySelectorAll('.bookmark-heading-btn');
        const alreadySynced =
            existingButtons.length === headings.length &&
            headings.every(heading => {
                const id = heading.getAttribute('id')!;
                const btn = heading.querySelector<HTMLButtonElement>(
                    ':scope > .bookmark-heading-btn'
                );
                if (!btn) return false;
                if (id === justBookmarkedId && !btn.classList.contains('is-just-bookmarked')) {
                    return false;
                }
                return btn.classList.contains('is-bookmarked') === bookmarkedIds.has(id);
            });

        if (alreadySynced) {
            justBookmarkedId = null;
            setupObserver();
            return;
        }

        observer?.disconnect();
        existingButtons.forEach(btn => btn.remove());

        headings.forEach(heading => {
            const id = heading.getAttribute('id')!;
            const isBookmarked = bookmarkedIds.has(id);

            const btn = document.createElement('button');
            btn.className = isBookmarked
                ? id === justBookmarkedId
                    ? 'bookmark-heading-btn is-bookmarked is-just-bookmarked'
                    : 'bookmark-heading-btn is-bookmarked'
                : 'bookmark-heading-btn';
            btn.setAttribute('aria-label', isBookmarked ? '已收藏' : '收藏段落');
            btn.innerHTML = isBookmarked ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
            btn.title = isBookmarked ? '点击取消收藏' : '点击收藏段落';

            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (!isBookmarked) {
                    justBookmarkedId = id;
                }
                onToggleBookmark(id, getHeadingTitle(heading));
            });

            heading.style.position = 'relative';
            heading.style.paddingLeft = '24px';
            heading.insertBefore(btn, heading.firstChild);
        });

        justBookmarkedId = null;
        setupObserver();
    };

    const setupObserver = () => {
        if (observer) return;

        observer = new MutationObserver(() => {
            if (!isActive() || mutationScheduled) return;
            mutationScheduled = true;
            void nextTick(() => {
                mutationScheduled = false;
                if (isActive()) attachIcons();
            });
        });

        // Observe the App-level route container, which outlives the page: MarkdownViewer is
        // re-keyed per article version and replaces `.md-body` together with its own root, so an
        // observer attached inside the viewer would be detached with it.
        observer.observe(document.querySelector('.router-view') ?? document.body, {
            childList: true,
            subtree: true
        });
    };

    const cleanup = () => {
        mutationScheduled = false;
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

    // Single watcher covers enabled state changes and all bookmark mutations (add/remove/rename)
    watch(
        [() => enabled.value, bookmarks],
        () => {
            nextTick(() => {
                if (isActive()) {
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
