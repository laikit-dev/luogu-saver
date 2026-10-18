import { useLocalStorage } from '@/composables/useLocalStorage';
import { ref, computed, onBeforeUnmount } from 'vue';

export type ViewMode = 'default' | 'focus';

const VIEW_MODE_KEY = 'content_view_mode';
const VIEW_MODE_HINT_DISMISSED_KEY = 'content_view_mode_hint_dismissed';
const FOCUS_VIEW_MIN_WIDTH = 768;

export function canUseFocusView(viewportWidth: number): boolean {
    return viewportWidth >= FOCUS_VIEW_MIN_WIDTH;
}

export function normalizeViewMode(value: unknown, viewportWidth?: number): ViewMode {
    if (value !== 'focus') return 'default';
    return viewportWidth === undefined || canUseFocusView(viewportWidth) ? 'focus' : 'default';
}

export function useViewMode() {
    const stored = useLocalStorage<ViewMode>(VIEW_MODE_KEY, 'default');
    const viewportWidth = typeof window === 'undefined' ? undefined : window.innerWidth;
    const viewMode = ref<ViewMode>(normalizeViewMode(stored.value, viewportWidth));
    const hintDismissed = useLocalStorage<boolean>(VIEW_MODE_HINT_DISMISSED_KEY, false);

    const isFocus = computed(() => viewMode.value === 'focus');

    const setViewMode = (mode: ViewMode) => {
        viewMode.value = mode;
        stored.value = mode;
    };

    const dismissHint = () => {
        hintDismissed.value = true;
    };

    // Focus view is rejected below the minimum width when chosen, so leave it when the
    // viewport shrinks too. The stored preference is kept for wider screens.
    const handleResize = () => {
        if (viewMode.value === 'focus' && !canUseFocusView(window.innerWidth)) {
            viewMode.value = 'default';
        }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize);
        onBeforeUnmount(() => window.removeEventListener('resize', handleResize));
    }

    return {
        viewMode,
        isFocus,
        setViewMode,
        dismissHint,
        hintDismissed
    };
}
