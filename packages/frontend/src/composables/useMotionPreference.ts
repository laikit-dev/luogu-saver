import { computed, effectScope, readonly, ref, watch, type Ref } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { MOTION_PREFERENCE_STORAGE_KEY } from '@/utils/constants.ts';

export type MotionPreference = 'system' | 'standard' | 'reduce';

export type MotionPreferenceOption = {
    label: string;
    value: MotionPreference;
};

export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'system';

export const MOTION_PREFERENCE_OPTIONS: MotionPreferenceOption[] = [
    { label: '跟随系统', value: 'system' },
    { label: '标准动效', value: 'standard' },
    { label: '减少动效', value: 'reduce' }
];

let motionPreferenceStorage: Ref<MotionPreference | null> | null = null;
let initialized = false;
const systemPrefersReduced = ref(false);
const syncScope = effectScope(true);

function isMotionPreference(value: unknown): value is MotionPreference {
    return value === 'system' || value === 'standard' || value === 'reduce';
}

function normalizeMotionPreference(value: unknown): MotionPreference {
    return isMotionPreference(value) ? value : DEFAULT_MOTION_PREFERENCE;
}

function applyMotionPreferenceToDocument(preference: MotionPreference) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.uiMotion = preference;
}

function getMotionPreferenceStorage(): Ref<MotionPreference | null> {
    motionPreferenceStorage ??= useLocalStorage<MotionPreference>(
        MOTION_PREFERENCE_STORAGE_KEY,
        DEFAULT_MOTION_PREFERENCE
    );
    return motionPreferenceStorage;
}

export function initMotionPreference() {
    const storage = getMotionPreferenceStorage();
    if (initialized) return;
    initialized = true;

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        systemPrefersReduced.value = mediaQuery.matches;
        mediaQuery.addEventListener('change', event => {
            systemPrefersReduced.value = event.matches;
        });
    }

    syncScope.run(() => {
        watch(
            storage,
            value => {
                applyMotionPreferenceToDocument(normalizeMotionPreference(value));
            },
            { immediate: true, flush: 'sync' }
        );
    });
}

export function useMotionPreference() {
    initMotionPreference();
    const storage = getMotionPreferenceStorage();

    const motionPreference = computed<MotionPreference>({
        get: () => normalizeMotionPreference(storage.value),
        set: value => {
            storage.value = normalizeMotionPreference(value);
        }
    });

    const reducedMotion = computed(() => {
        if (motionPreference.value === 'reduce') return true;
        if (motionPreference.value === 'standard') return false;
        return systemPrefersReduced.value;
    });

    return {
        motionPreference,
        motionPreferenceOptions: MOTION_PREFERENCE_OPTIONS,
        reducedMotion: readonly(reducedMotion)
    };
}
