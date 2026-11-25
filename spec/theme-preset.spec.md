# Theme Preset System Specification

## 1. Overview

The theme preset system allows users to choose between `system` (automatic light/dark switching
following the OS color scheme) and curated static color schemes (presets). Manual overrides are
persisted independently and reset when the preset changes.

## 2. Presets

### 2.1 Preset Definitions

There SHALL be one dynamic preset (`system`) and five static predefined presets:

| Preset Name | Label    | Kind    | Source                                                     |
| ----------- | -------- | ------- | ---------------------------------------------------------- |
| `system`    | 跟随系统 | dynamic | Follows `prefers-color-scheme: dark` (`dark` or `light`)   |
| `light`     | 浅色     | static  | luogu-saver-next built-in light theme (formerly `default`) |
| `dark`      | 深色     | static  | luogu-saver-next built-in low-contrast dark theme          |
| `modern`    | 现代     | static  | luogu-saver-pr47 light theme                               |
| `recall`    | 追忆     | static  | luogu-saver-recall light color palette                     |
| `archive`   | 洛谷仓库 | static  | luogu-archive light color palette                          |

Each static preset SHALL define a single complete `UiThemeVars` object (`vars`) and a boolean
`isDark` flag (`false` for light presets, `true` for `dark`). When the resolved static preset has
`isDark === true`, the root `NConfigProvider` SHALL use Naive UI `darkTheme` as its base theme
before applying `themeOverrides`, and `document.documentElement.style.colorScheme` SHALL be set to
`dark` (otherwise `light`).

### 2.2 Preset Storage

The active preset name SHALL be persisted in `localStorage` under the key `ui_theme_preset`.
On application load, the system SHALL read this key:

- If the stored value is `'default'`, it SHALL be normalized to `'light'` for backward compatibility.
- If the value is missing or does not match a valid preset name, the system SHALL default to
  `'system'`.

## 3. System Color Scheme Synchronization

When the active preset is `'system'`:

- The frontend SHALL subscribe to `window.matchMedia('(prefers-color-scheme: dark)')`.
- When `matches` is `true`, the resolved static preset SHALL be `'dark'`; otherwise `'light'`.
- When the media query emits a `change` event while the active preset is `'system'`, the frontend
  SHALL immediately recompute the effective `UiThemeVars`, Naive UI base theme, and `colorScheme`
  from the newly resolved static preset.
- The frontend SHALL NOT read or write a separate `localStorage['ui_theme_mode']` key and SHALL NOT
  provide a separate `uiThemeModeKey`.

## 4. Theme Computation

### 4.1 Resolution Order

The effective `UiThemeVars` SHALL be computed as:

```
resolvedPreset = presetName === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : presetName
base = presets[resolvedPreset].vars      // base theme variables of resolved static preset
overrides = localStorage['ui_theme']     // user customisations (partial UiThemeVars)
result = merge(base, overrides)          // overrides take precedence
```

### 4.2 CSS Variable Injection

Every property of the effective `UiThemeVars` SHALL be written as a corresponding CSS custom
property on `document.documentElement.style`. The mapping follows the existing convention
(e.g., `bodyColor` → `--ui-body-color`).

## 5. User Interface

### 5.1 Drawer Trigger

The theme editor drawer SHALL be triggered from the global navigation shell (desktop sidebar
utility footer and mobile navigation drawer) so that it is accessible from every route.
No floating circular trigger button SHALL be rendered at the bottom-right of the viewport.

### 5.2 Drawer Header

The drawer title SHALL be "主题编辑器".

### 5.3 Preset Select Box

A single select box SHALL appear at the top of the drawer (and SHALL also be available in the
Settings page under appearance preferences):

1. **主题预设** — options: 跟随系统, 浅色, 深色, 现代, 追忆, 洛谷仓库

### 5.4 Manual Colour Editor

The full colour editor (collapsible sections with color pickers, code theme selector, shadow
inputs, and radius inputs) SHALL be displayed and interactive.

### 5.5 Reset Button

A single "重置为预设" button SHALL appear in the drawer footer. Clicking it SHALL replace the
current `uiThemeVars` with `presets[resolvedPreset].vars`, discarding all manual overrides.

## 6. Interaction Rules

### 6.1 Changing the Preset

When the user selects a different preset:

- `localStorage['ui_theme']` SHALL be cleared (all manual overrides discarded).
- The effective theme SHALL be recomputed from the new preset's `vars`.

### 6.2 Manual Override Persistence

Whenever the user modifies any value in the editor, the diff relative to
`presets[resolvedPreset].vars` SHALL be persisted to `localStorage` under `ui_theme` (or cleared
when no property differs from the resolved base preset).

## 7. Injection Keys

The following injection keys SHALL be provided by `App.vue` for child components:

| Key                | Type                     | Purpose                      |
| ------------------ | ------------------------ | ---------------------------- |
| `uiThemeKey`       | `Ref<UiThemeVars>`       | Current effective theme vars |
| `uiThemePresetKey` | `Ref<UiThemePresetName>` | Current preset name          |

## 8. Non-Goals

- Presets are not editable, importable, or exportable.
- There is no "save as preset" feature.
- The user, prize, and cheater colour tokens are not affected by preset switching;
  they always use the hardcoded values from the `light` preset.
