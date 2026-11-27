import { computed, effectScope, ref, watch, type Ref } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { CODE_FONT_STORAGE_KEY, CUSTOM_CODE_FONT_STORAGE_KEY } from '@/utils/constants.ts';

export type CodeFontPreset = 'jetbrains-mono' | 'system' | 'cascadia' | 'fira-code' | 'custom';

export type CodeFontOption = {
    label: string;
    value: CodeFontPreset;
};

export const DEFAULT_CODE_FONT: CodeFontPreset = 'jetbrains-mono';

export const CODE_FONT_OPTIONS: CodeFontOption[] = [
    { label: 'JetBrains Mono', value: 'jetbrains-mono' },
    { label: '系统等宽字体', value: 'system' },
    { label: 'Cascadia Code', value: 'cascadia' },
    { label: 'Fira Code', value: 'fira-code' },
    { label: '自定义字体', value: 'custom' }
];

const MONO_FALLBACK_STACK =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', var(--ui-font-family-cjk), monospace";

let codeFontStorage: Ref<CodeFontPreset | null> | null = null;
let customCodeFontStorage: Ref<string | null> | null = null;
let initialized = false;
const customInputActive = ref(false);
const syncScope = effectScope(true);

function isCodeFontPreset(value: unknown): value is CodeFontPreset {
    return (
        value === 'jetbrains-mono' ||
        value === 'system' ||
        value === 'cascadia' ||
        value === 'fira-code' ||
        value === 'custom'
    );
}

function normalizeCodeFont(value: unknown): CodeFontPreset {
    return isCodeFontPreset(value) ? value : DEFAULT_CODE_FONT;
}

function normalizeCustomCodeFont(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function applyCodeFontToDocument(preset: CodeFontPreset, customFamily: string) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.uiCodeFont = preset;

    const trimmed = customFamily.trim();
    if (preset === 'custom' && trimmed) {
        root.style.setProperty('--ui-font-family-mono', `${trimmed}, ${MONO_FALLBACK_STACK}`);
        customInputActive.value = true;
    } else {
        root.style.removeProperty('--ui-font-family-mono');
        customInputActive.value = false;
    }
}

function getCodeFontStorage(): Ref<CodeFontPreset | null> {
    codeFontStorage ??= useLocalStorage<CodeFontPreset>(CODE_FONT_STORAGE_KEY, DEFAULT_CODE_FONT);
    return codeFontStorage;
}

function getCustomCodeFontStorage(): Ref<string | null> {
    customCodeFontStorage ??= useLocalStorage<string>(CUSTOM_CODE_FONT_STORAGE_KEY, '');
    return customCodeFontStorage;
}

export function initCodeFont() {
    const presetStorage = getCodeFontStorage();
    const customStorage = getCustomCodeFontStorage();
    if (initialized) return;
    initialized = true;

    syncScope.run(() => {
        watch(
            [presetStorage, customStorage],
            ([preset, custom]) => {
                applyCodeFontToDocument(normalizeCodeFont(preset), normalizeCustomCodeFont(custom));
            },
            { immediate: true, flush: 'sync' }
        );
    });
}

export function useCodeFont() {
    initCodeFont();
    const presetStorage = getCodeFontStorage();
    const customStorage = getCustomCodeFontStorage();

    const codeFont = computed<CodeFontPreset>({
        get: () => normalizeCodeFont(presetStorage.value),
        set: value => {
            presetStorage.value = normalizeCodeFont(value);
        }
    });

    const customCodeFont = computed<string>({
        get: () => normalizeCustomCodeFont(customStorage.value),
        set: value => {
            customStorage.value = normalizeCustomCodeFont(value);
        }
    });

    return {
        codeFont,
        customCodeFont,
        codeFontOptions: CODE_FONT_OPTIONS,
        customInputActive
    };
}
