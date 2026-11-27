import { computed, effectScope, watch, type Ref } from 'vue';
import type { ShikiThemeId } from '@luogu-saver-next/markdown-renderer';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { CODE_THEME_SETTINGS_STORAGE_KEY } from '@/utils/constants.ts';

export type CodeThemePresetId =
    | 'github'
    | 'one-dark'
    | 'vitesse'
    | 'catppuccin'
    | 'tokyo-night'
    | 'gruvbox';

export type CodeThemePreviewPalette = {
    bg: string;
    border: string;
    keyword: string;
    fn: string;
    string: string;
    number: string;
    comment: string;
    text: string;
};

export type CodeThemePreset = {
    id: CodeThemePresetId;
    label: string;
    tag: string;
    lightTheme: ShikiThemeId;
    darkTheme: ShikiThemeId;
    preview: {
        light: CodeThemePreviewPalette;
        dark: CodeThemePreviewPalette;
    };
};

export type ShikiThemeSelectOption = {
    label: string;
    value: ShikiThemeId;
};

export interface CodeThemeSettings {
    lightTheme: ShikiThemeId;
    darkTheme: ShikiThemeId;
    fontSize: number;
    lineHeight: number;
    showLineNumbers: boolean;
    wordWrap: boolean;
}

export const LIGHT_SHIKI_THEME_OPTIONS: ShikiThemeSelectOption[] = [
    { label: 'GitHub Light', value: 'github-light' },
    { label: 'One Light', value: 'one-light' },
    { label: 'Vitesse Light', value: 'vitesse-light' },
    { label: 'Catppuccin Latte', value: 'catppuccin-latte' },
    { label: 'Gruvbox Light', value: 'gruvbox-light-medium' },
    { label: 'Solarized Light', value: 'solarized-light' }
];

export const DARK_SHIKI_THEME_OPTIONS: ShikiThemeSelectOption[] = [
    { label: 'GitHub Dark', value: 'github-dark' },
    { label: 'One Dark Pro', value: 'one-dark-pro' },
    { label: 'Vitesse Dark', value: 'vitesse-dark' },
    { label: 'Catppuccin Mocha', value: 'catppuccin-mocha' },
    { label: 'Tokyo Night', value: 'tokyo-night' },
    { label: 'Nord', value: 'nord' },
    { label: 'Dracula', value: 'dracula' },
    { label: 'Gruvbox Dark', value: 'gruvbox-dark-medium' },
    { label: 'Solarized Dark', value: 'solarized-dark' },
    { label: 'Monokai', value: 'monokai' }
];

export const CODE_THEME_PRESETS: ReadonlyArray<CodeThemePreset> = [
    {
        id: 'github',
        label: 'GitHub',
        tag: '默认',
        lightTheme: 'github-light',
        darkTheme: 'github-dark',
        preview: {
            light: {
                bg: '#f6f8fa',
                border: 'rgba(27, 31, 36, 0.12)',
                keyword: '#cf222e',
                fn: '#8250df',
                string: '#0a3069',
                number: '#0550ae',
                comment: '#6e7781',
                text: '#24292f'
            },
            dark: {
                bg: '#161b22',
                border: 'rgba(240, 246, 252, 0.14)',
                keyword: '#ff7b72',
                fn: '#d2a8ff',
                string: '#a5d6ff',
                number: '#79c0ff',
                comment: '#8b949e',
                text: '#e6edf3'
            }
        }
    },
    {
        id: 'one-dark',
        label: 'One Dark',
        tag: '经典',
        lightTheme: 'one-light',
        darkTheme: 'one-dark-pro',
        preview: {
            light: {
                bg: '#fafafa',
                border: 'rgba(56, 58, 66, 0.12)',
                keyword: '#a626a4',
                fn: '#4078f2',
                string: '#50a14f',
                number: '#986801',
                comment: '#a0a1a7',
                text: '#383a42'
            },
            dark: {
                bg: '#282c34',
                border: 'rgba(171, 178, 191, 0.16)',
                keyword: '#c678dd',
                fn: '#61afef',
                string: '#98c379',
                number: '#d19a66',
                comment: '#5c6370',
                text: '#abb2bf'
            }
        }
    },
    {
        id: 'vitesse',
        label: 'Vitesse',
        tag: '现代',
        lightTheme: 'vitesse-light',
        darkTheme: 'vitesse-dark',
        preview: {
            light: {
                bg: '#fafafa',
                border: 'rgba(57, 58, 52, 0.12)',
                keyword: '#1e754f',
                fn: '#59873a',
                string: '#b56959',
                number: '#2f798a',
                comment: '#a0ada0',
                text: '#393a34'
            },
            dark: {
                bg: '#121212',
                border: 'rgba(219, 215, 202, 0.15)',
                keyword: '#4d9375',
                fn: '#80a665',
                string: '#c98a7d',
                number: '#4c9a91',
                comment: '#758575',
                text: '#dbd7ca'
            }
        }
    },
    {
        id: 'catppuccin',
        label: 'Catppuccin',
        tag: '柔和',
        lightTheme: 'catppuccin-latte',
        darkTheme: 'catppuccin-mocha',
        preview: {
            light: {
                bg: '#eff1f5',
                border: 'rgba(76, 79, 105, 0.14)',
                keyword: '#8839ef',
                fn: '#1e66f5',
                string: '#40a02b',
                number: '#fe640b',
                comment: '#9ca0b0',
                text: '#4c4f69'
            },
            dark: {
                bg: '#1e1e2e',
                border: 'rgba(205, 214, 244, 0.16)',
                keyword: '#cba6f7',
                fn: '#89b4fa',
                string: '#a6e3a1',
                number: '#fab387',
                comment: '#6c7086',
                text: '#cdd6f4'
            }
        }
    },
    {
        id: 'tokyo-night',
        label: 'Tokyo Night',
        tag: '暗夜',
        lightTheme: 'github-light',
        darkTheme: 'tokyo-night',
        preview: {
            light: {
                bg: '#f6f8fa',
                border: 'rgba(27, 31, 36, 0.12)',
                keyword: '#cf222e',
                fn: '#8250df',
                string: '#0a3069',
                number: '#0550ae',
                comment: '#6e7781',
                text: '#24292f'
            },
            dark: {
                bg: '#1a1b26',
                border: 'rgba(169, 177, 214, 0.18)',
                keyword: '#bb9af7',
                fn: '#7aa2f7',
                string: '#9ece6a',
                number: '#ff9e64',
                comment: '#565f89',
                text: '#c0caf5'
            }
        }
    },
    {
        id: 'gruvbox',
        label: 'Gruvbox',
        tag: '暖纸',
        lightTheme: 'gruvbox-light-medium',
        darkTheme: 'gruvbox-dark-medium',
        preview: {
            light: {
                bg: '#fbf1c7',
                border: 'rgba(60, 56, 54, 0.16)',
                keyword: '#9d0006',
                fn: '#79740e',
                string: '#427b58',
                number: '#8f3f71',
                comment: '#928374',
                text: '#3c3836'
            },
            dark: {
                bg: '#282828',
                border: 'rgba(235, 219, 178, 0.16)',
                keyword: '#fb4934',
                fn: '#b8bb26',
                string: '#8ec07c',
                number: '#d3869b',
                comment: '#928374',
                text: '#ebdbb2'
            }
        }
    }
];

export const DEFAULT_CODE_THEME_SETTINGS: CodeThemeSettings = {
    lightTheme: 'github-light',
    darkTheme: 'github-dark',
    fontSize: 13.5,
    lineHeight: 1.6,
    showLineNumbers: true,
    wordWrap: false
};

const LIGHT_THEME_SET = new Set<ShikiThemeId>(LIGHT_SHIKI_THEME_OPTIONS.map(opt => opt.value));
const DARK_THEME_SET = new Set<ShikiThemeId>(DARK_SHIKI_THEME_OPTIONS.map(opt => opt.value));

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

function normalizeSettings(raw: unknown): CodeThemeSettings {
    const obj = raw && typeof raw === 'object' ? (raw as Partial<CodeThemeSettings>) : {};
    return {
        lightTheme:
            obj.lightTheme && LIGHT_THEME_SET.has(obj.lightTheme)
                ? obj.lightTheme
                : DEFAULT_CODE_THEME_SETTINGS.lightTheme,
        darkTheme:
            obj.darkTheme && DARK_THEME_SET.has(obj.darkTheme)
                ? obj.darkTheme
                : DEFAULT_CODE_THEME_SETTINGS.darkTheme,
        fontSize: clampNumber(obj.fontSize, 12, 18, DEFAULT_CODE_THEME_SETTINGS.fontSize),
        lineHeight: clampNumber(obj.lineHeight, 1.3, 2.0, DEFAULT_CODE_THEME_SETTINGS.lineHeight),
        showLineNumbers:
            typeof obj.showLineNumbers === 'boolean'
                ? obj.showLineNumbers
                : DEFAULT_CODE_THEME_SETTINGS.showLineNumbers,
        wordWrap:
            typeof obj.wordWrap === 'boolean' ? obj.wordWrap : DEFAULT_CODE_THEME_SETTINGS.wordWrap
    };
}

let settingsStorage: Ref<CodeThemeSettings | null> | null = null;
let initialized = false;
const syncScope = effectScope(true);

function getSettingsStorage(): Ref<CodeThemeSettings | null> {
    settingsStorage ??= useLocalStorage<CodeThemeSettings>(CODE_THEME_SETTINGS_STORAGE_KEY, {
        ...DEFAULT_CODE_THEME_SETTINGS
    });
    return settingsStorage;
}

function applyCodeThemeSettingsToDocument(settings: CodeThemeSettings) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--ui-code-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--ui-code-line-height', String(settings.lineHeight));
    root.dataset.uiCodeLineNumbers = settings.showLineNumbers ? 'on' : 'off';
    root.dataset.uiCodeWrap = settings.wordWrap ? 'on' : 'off';
}

export function initCodeTheme() {
    const storage = getSettingsStorage();
    if (initialized) return;
    initialized = true;

    syncScope.run(() => {
        watch(
            storage,
            raw => {
                applyCodeThemeSettingsToDocument(normalizeSettings(raw));
            },
            { immediate: true, flush: 'sync', deep: true }
        );
    });
}

export function useCodeTheme() {
    initCodeTheme();
    const storage = getSettingsStorage();

    const settings = computed<CodeThemeSettings>(() => normalizeSettings(storage.value));

    const updateSettings = (patch: Partial<CodeThemeSettings>) => {
        storage.value = normalizeSettings({ ...settings.value, ...patch });
    };

    const lightShikiTheme = computed<ShikiThemeId>({
        get: () => settings.value.lightTheme,
        set: value => updateSettings({ lightTheme: value })
    });

    const darkShikiTheme = computed<ShikiThemeId>({
        get: () => settings.value.darkTheme,
        set: value => updateSettings({ darkTheme: value })
    });

    const codeFontSize = computed<number>({
        get: () => settings.value.fontSize,
        set: value => updateSettings({ fontSize: value })
    });

    const codeLineHeight = computed<number>({
        get: () => settings.value.lineHeight,
        set: value => updateSettings({ lineHeight: value })
    });

    const codeShowLineNumbers = computed<boolean>({
        get: () => settings.value.showLineNumbers,
        set: value => updateSettings({ showLineNumbers: value })
    });

    const codeWordWrap = computed<boolean>({
        get: () => settings.value.wordWrap,
        set: value => updateSettings({ wordWrap: value })
    });

    const activeCodeThemePreset = computed<CodeThemePresetId | null>(() => {
        const matched = CODE_THEME_PRESETS.find(
            item =>
                item.lightTheme === settings.value.lightTheme &&
                item.darkTheme === settings.value.darkTheme
        );
        return matched ? matched.id : null;
    });

    const selectCodeThemePreset = (presetId: CodeThemePresetId) => {
        const preset = CODE_THEME_PRESETS.find(item => item.id === presetId);
        if (!preset) return;
        updateSettings({
            lightTheme: preset.lightTheme,
            darkTheme: preset.darkTheme
        });
    };

    const resetCodeThemeSettings = () => {
        storage.value = { ...DEFAULT_CODE_THEME_SETTINGS };
    };

    return {
        codeThemePresets: CODE_THEME_PRESETS,
        lightShikiThemeOptions: LIGHT_SHIKI_THEME_OPTIONS,
        darkShikiThemeOptions: DARK_SHIKI_THEME_OPTIONS,
        activeCodeThemePreset,
        lightShikiTheme,
        darkShikiTheme,
        codeFontSize,
        codeLineHeight,
        codeShowLineNumbers,
        codeWordWrap,
        selectCodeThemePreset,
        resetCodeThemeSettings
    };
}
