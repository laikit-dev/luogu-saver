import { computed, effectScope, ref, watch, type Ref } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { READING_FONT_STORAGE_KEY } from '@/utils/constants.ts';

export type ReadingFontPreset = 'sans' | 'serif' | 'kai';

export interface ReadingFontOption {
    label: string;
    value: ReadingFontPreset;
    description: string;
}

export const DEFAULT_READING_FONT: ReadingFontPreset = 'sans';

export const READING_FONT_OPTIONS: ReadingFontOption[] = [
    {
        label: '现代无衬线',
        value: 'sans',
        description:
            'Plus Jakarta Sans 与 PingFang / 思源黑体，与全站界面一致，代码与公式混排清晰利落。'
    },
    {
        label: '典雅衬线体',
        value: 'serif',
        description: 'Source Serif 4 与思源宋体，层次分明，契合长文与数学公式阅读。'
    },
    {
        label: '霞鹜文楷',
        value: 'kai',
        description: '屏幕优化楷体，温润柔和，适合题解、游记与闲话深度阅读。'
    }
];

let readingFontStorage: Ref<ReadingFontPreset | null> | null = null;
let initialized = false;
let serifFontPromise: Promise<void> | null = null;
let kaiFontPromise: Promise<void> | null = null;
const readingFontLoading = ref(false);
const syncScope = effectScope(true);

function isReadingFontPreset(value: unknown): value is ReadingFontPreset {
    return value === 'sans' || value === 'serif' || value === 'kai';
}

function normalizeReadingFont(value: unknown): ReadingFontPreset {
    return isReadingFontPreset(value) ? value : DEFAULT_READING_FONT;
}

function ensureSerifFontLoaded(): Promise<void> {
    if (serifFontPromise) return serifFontPromise;
    readingFontLoading.value = true;
    serifFontPromise = Promise.all([
        import('@fontsource-variable/source-serif-4'),
        import('@fontsource-variable/source-serif-4/wght-italic.css'),
        import('@fontsource-variable/noto-serif-sc')
    ])
        .then(() => undefined)
        .catch(error => {
            serifFontPromise = null;
            throw error;
        })
        .finally(() => {
            readingFontLoading.value = false;
        });
    return serifFontPromise;
}

function ensureKaiFontLoaded(): Promise<void> {
    if (kaiFontPromise) return kaiFontPromise;
    readingFontLoading.value = true;
    kaiFontPromise = import('lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css')
        .then(() => undefined)
        .catch(error => {
            kaiFontPromise = null;
            throw error;
        })
        .finally(() => {
            readingFontLoading.value = false;
        });
    return kaiFontPromise;
}

function applyReadingFontToDocument(preset: ReadingFontPreset) {
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.uiReadingFont = preset;
    }
    if (preset === 'serif') {
        void ensureSerifFontLoaded();
    } else if (preset === 'kai') {
        void ensureKaiFontLoaded();
    }
}

function getReadingFontStorage(): Ref<ReadingFontPreset | null> {
    readingFontStorage ??= useLocalStorage<ReadingFontPreset>(
        READING_FONT_STORAGE_KEY,
        DEFAULT_READING_FONT
    );
    return readingFontStorage;
}

export function initReadingFont() {
    const storage = getReadingFontStorage();
    if (initialized) return;
    initialized = true;

    syncScope.run(() => {
        watch(
            storage,
            value => {
                applyReadingFontToDocument(normalizeReadingFont(value));
            },
            { immediate: true, flush: 'sync' }
        );
    });
}

export function useReadingFont() {
    initReadingFont();
    const storage = getReadingFontStorage();

    const readingFont = computed<ReadingFontPreset>({
        get: () => normalizeReadingFont(storage.value),
        set: value => {
            storage.value = normalizeReadingFont(value);
        }
    });

    const currentReadingFontOption = computed(
        () =>
            READING_FONT_OPTIONS.find(option => option.value === readingFont.value) ??
            READING_FONT_OPTIONS[0]!
    );

    const readingFontSelectOptions = READING_FONT_OPTIONS.map(({ label, value }) => ({
        label,
        value
    }));

    return {
        readingFont,
        readingFontOptions: READING_FONT_OPTIONS,
        readingFontSelectOptions,
        currentReadingFontOption,
        readingFontLoading
    };
}
