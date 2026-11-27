import { computed, effectScope, watch, type Ref } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { SURFACE_STYLE_STORAGE_KEY } from '@/utils/constants.ts';

export type UiSurfaceStyle = 'card' | 'flat';

export interface UiSurfaceStyleOption {
    label: string;
    value: UiSurfaceStyle;
}

export const DEFAULT_SURFACE_STYLE: UiSurfaceStyle = 'card';

export const SURFACE_STYLE_OPTIONS: readonly UiSurfaceStyleOption[] = [
    { label: '卡片式', value: 'card' },
    { label: '扁平式', value: 'flat' }
];

let surfaceStyleStorage: Ref<UiSurfaceStyle | null> | null = null;
let initialized = false;
const syncScope = effectScope(true);

function isUiSurfaceStyle(value: unknown): value is UiSurfaceStyle {
    return value === 'card' || value === 'flat';
}

function normalizeSurfaceStyle(value: unknown): UiSurfaceStyle {
    return isUiSurfaceStyle(value) ? value : DEFAULT_SURFACE_STYLE;
}

function applySurfaceStyleToDocument(style: UiSurfaceStyle) {
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.uiSurface = style;
    }
}

function getSurfaceStyleStorage(): Ref<UiSurfaceStyle | null> {
    surfaceStyleStorage ??= useLocalStorage<UiSurfaceStyle>(
        SURFACE_STYLE_STORAGE_KEY,
        DEFAULT_SURFACE_STYLE
    );
    return surfaceStyleStorage;
}

/**
 * Initializes reactive synchronization between the persisted surface style
 * and `html[data-ui-surface]` before initial app mount.
 */
export function initSurfaceStyle() {
    const storage = getSurfaceStyleStorage();
    if (initialized) return;
    initialized = true;

    syncScope.run(() => {
        watch(
            storage,
            value => {
                applySurfaceStyleToDocument(normalizeSurfaceStyle(value));
            },
            { immediate: true, flush: 'sync' }
        );
    });
}

/**
 * Returns the reactive UI surface style selection (`card` or `flat`) and display options.
 */
export function useSurfaceStyle() {
    initSurfaceStyle();
    const storage = getSurfaceStyleStorage();

    const surfaceStyle = computed<UiSurfaceStyle>({
        get: () => normalizeSurfaceStyle(storage.value),
        set: next => {
            storage.value = normalizeSurfaceStyle(next);
        }
    });

    return {
        surfaceStyle,
        surfaceStyleOptions: SURFACE_STYLE_OPTIONS
    };
}
