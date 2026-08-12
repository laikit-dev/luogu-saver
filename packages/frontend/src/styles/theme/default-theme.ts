import type { UiThemeVars } from '@/styles/theme/themeKeys.ts';
import { presets } from '@/styles/theme/presets.ts';

export const defaultTheme: UiThemeVars = { ...presets.default.light };
export const darkTheme: UiThemeVars = { ...presets.default.dark };
