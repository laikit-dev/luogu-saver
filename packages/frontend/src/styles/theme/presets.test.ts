import { describe, expect, it } from 'vitest';
import {
    normalizeThemeMode,
    normalizeThemePresetName,
    presets,
    resolveEffectiveColorScheme,
    resolvePresetThemeVars,
    resolveStoredThemeSelection,
    THEME_MODE_OPTIONS,
    THEME_PRESET_OPTIONS
} from '@/styles/theme/presets.ts';
import type { UiThemePresetName } from '@/styles/theme/themeKeys.ts';

describe('theme presets and color mode resolution', () => {
    const presetNames: UiThemePresetName[] = ['default', 'modern', 'recall', 'archive'];

    it('provides complete light and dark palettes for every preset', () => {
        const expectedKeys = Object.keys(presets.default.light).sort();

        for (const name of presetNames) {
            const preset = presets[name];
            expect(Object.keys(preset.light).sort()).toEqual(expectedKeys);
            expect(Object.keys(preset.dark).sort()).toEqual(expectedKeys);
            expect(preset.light.codeTheme).toBe('light');
            expect(preset.dark.codeTheme).toBe('dark');
            expect(preset.light.bodyColor).not.toBe(preset.dark.bodyColor);
            expect(preset.dark.userBlueColor).toBe(presets.default.light.userBlueColor);
            expect(preset.dark.userCheaterColor).toBe(presets.default.light.userCheaterColor);
        }
    });

    it('exposes independent preset and mode options', () => {
        expect(THEME_PRESET_OPTIONS.map(option => option.value)).toEqual(presetNames);
        expect(THEME_MODE_OPTIONS.map(option => option.value)).toEqual(['auto', 'light', 'dark']);
    });

    it('normalizes preset names and modes with backward compatibility', () => {
        expect(normalizeThemePresetName('modern')).toBe('modern');
        expect(normalizeThemePresetName('unknown')).toBe('default');
        expect(normalizeThemePresetName(null)).toBe('default');

        expect(normalizeThemeMode('auto')).toBe('auto');
        expect(normalizeThemeMode('light')).toBe('light');
        expect(normalizeThemeMode('dark')).toBe('dark');
        expect(normalizeThemeMode('manual')).toBe('light');
        expect(normalizeThemeMode('system')).toBe('auto');
        expect(normalizeThemeMode('invalid')).toBe('auto');
    });

    it('migrates legacy merged preset values while preserving non-default presets with independent mode', () => {
        expect(resolveStoredThemeSelection(null, null)).toEqual({
            preset: 'default',
            mode: 'auto'
        });
        expect(resolveStoredThemeSelection('system', 'dark')).toEqual({
            preset: 'default',
            mode: 'auto'
        });
        expect(resolveStoredThemeSelection('light', 'auto')).toEqual({
            preset: 'default',
            mode: 'light'
        });
        expect(resolveStoredThemeSelection('dark', 'light')).toEqual({
            preset: 'default',
            mode: 'dark'
        });
        expect(resolveStoredThemeSelection('archive', 'dark')).toEqual({
            preset: 'archive',
            mode: 'dark'
        });
        expect(resolveStoredThemeSelection('modern', 'manual')).toEqual({
            preset: 'modern',
            mode: 'light'
        });
        expect(resolveStoredThemeSelection('recall', null)).toEqual({
            preset: 'recall',
            mode: 'auto'
        });
    });

    it('resolves dark mode for non-default presets both explicitly and via system auto mode', () => {
        expect(resolveEffectiveColorScheme('auto', true)).toBe('dark');
        expect(resolveEffectiveColorScheme('auto', false)).toBe('light');
        expect(resolveEffectiveColorScheme('dark', false)).toBe('dark');
        expect(resolveEffectiveColorScheme('light', true)).toBe('light');

        for (const name of presetNames) {
            expect(resolvePresetThemeVars(name, 'dark', false)).toEqual(presets[name].dark);
            expect(resolvePresetThemeVars(name, 'auto', true)).toEqual(presets[name].dark);
            expect(resolvePresetThemeVars(name, 'light', true)).toEqual(presets[name].light);
            expect(resolvePresetThemeVars(name, 'auto', false)).toEqual(presets[name].light);
        }
    });
});
