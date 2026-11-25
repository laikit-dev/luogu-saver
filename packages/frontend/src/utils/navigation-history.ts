import type { Router } from 'vue-router';

const ENTRY_ID_KEY = '__lgsEntryId';
const HASH_STEP_KEY = '__lgsHashStep';

let initialized = false;
let entrySeq = 0;
let currentEntryId = 0;
let trackedPath = '';
let samePathHashDepth = 0;

function readHashStep(): number {
    const step = window.history.state?.[HASH_STEP_KEY];
    return typeof step === 'number' && Number.isInteger(step) && step > 0 ? step : 0;
}

function tagCurrentHistoryEntry(entryId: number, step: number): void {
    window.history.replaceState(
        {
            ...(window.history.state || {}),
            [ENTRY_ID_KEY]: entryId,
            [HASH_STEP_KEY]: step
        },
        ''
    );
}

/**
 * Intercepts same-page `#anchor` clicks (Markdown headings, TOC links) so the URL hash updates
 * via `replaceState` instead of pushing redundant history entries that trap the Back button.
 */
export function handleInPageHashClick(event: MouseEvent, reducedMotion = false): boolean {
    if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return false;
    }

    const anchor = (event.target as Element | null)?.closest('a[href^="#"]');
    if (!(anchor instanceof HTMLAnchorElement)) return false;

    const rawHash = anchor.getAttribute('href');
    if (!rawHash || rawHash === '#') return false;

    let targetId = rawHash.slice(1);
    try {
        targetId = decodeURIComponent(targetId);
    } catch {
        // Keep raw fragment when percent-encoding is malformed.
    }

    const target = document.getElementById(targetId);
    if (!target) return false;

    event.preventDefault();
    window.history.replaceState(window.history.state, '', rawHash);
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    return true;
}

/**
 * Tracks same-path hash pushes (e.g. manual URL hash edits or native anchor jumps) so
 * `goBackIgnoringHash` can skip over all same-page hash entries in a single history jump.
 */
export function initNavigationHistory(router: Router): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    const resetForPath = (path: string) => {
        trackedPath = path;
        const existingId = window.history.state?.[ENTRY_ID_KEY];
        if (typeof existingId === 'number' && existingId > 0) {
            currentEntryId = existingId;
            samePathHashDepth = readHashStep();
        } else {
            currentEntryId = ++entrySeq;
            samePathHashDepth = 0;
            tagCurrentHistoryEntry(currentEntryId, 0);
        }
    };

    const trackSamePathHashPush = () => {
        if (window.location.pathname !== trackedPath) return;
        if (window.history.state?.[ENTRY_ID_KEY] === currentEntryId) {
            samePathHashDepth = readHashStep();
            return;
        }
        samePathHashDepth += 1;
        tagCurrentHistoryEntry(currentEntryId, samePathHashDepth);
    };

    resetForPath(window.location.pathname);

    router.afterEach((to, from) => {
        if (to.path !== from.path || from.matched.length === 0) {
            resetForPath(to.path);
            return;
        }
        if (to.hash !== from.hash) {
            trackSamePathHashPush();
        }
    });

    window.addEventListener('hashchange', trackSamePathHashPush);
}

/**
 * Navigates back to the actual previous page, skipping over any same-page `#hash` entries.
 */
export function goBackIgnoringHash(router: Router, fallbackPath = '/'): void {
    const hashStep = readHashStep();
    const delta = -(hashStep + 1);
    const hasHistoryBack =
        Boolean(window.history.state?.back) || hashStep > 0 || window.history.length > hashStep + 1;

    if (hasHistoryBack) {
        router.go(delta);
        return;
    }

    void router.push(fallbackPath);
}
