# Theme Preset System Specification

## 1. Overview

The theme preset system allows users to independently choose a curated color scheme (`preset`) and
a color mode (`auto`, `light`, or `dark`). Each preset provides both light and dark palettes.
Manual overrides are persisted independently and reset when the preset, color mode, or resolved
system color scheme changes.

## 2. Presets

### 2.1 Preset Definitions

There SHALL be exactly eight predefined presets:

| Preset Name | Label    | Purpose Tag | Preview Font | Source                                                     |
| ----------- | -------- | ----------- | ------------ | ---------------------------------------------------------- |
| `default`   | 默认     | 综合        | `sans`       | luogu-saver-next built-in light and low-contrast dark sets |
| `modern`    | 现代     | 极简        | `sans`       | luogu-saver-pr47 light and dark color palettes             |
| `recall`    | 追忆     | 经典        | `sans`       | luogu-saver-recall light and dark color palettes           |
| `archive`   | 洛谷仓库 | 归档        | `sans`       | luogu-archive light and dark color palettes                |
| `paper`     | 书卷     | 护眼阅读    | `serif`      | Warm parchment light and espresso dark reading palettes    |
| `forest`    | 青松     | 清新学习    | `sans`       | Soft sage light and deep pine dark study palettes          |
| `sakura`    | 绯樱     | 轻柔随笔    | `kai`        | Blush ivory light and plum dark editorial palettes         |
| `nord`      | 极夜     | 专注刷题    | `sans`       | Arctic light and Polar Night dark focus palettes           |

Each preset SHALL define `tag`, `description`, `previewFont`, and two complete `UiThemeVars` objects: `light` and `dark`.

### 2.2 Preset Storage

The active preset name SHALL be persisted in `localStorage` under the key `ui_theme_preset`.
On application load, the system SHALL resolve `(ui_theme_preset, ui_theme_mode)` as follows:

- If `ui_theme_preset` is `'system'`, it SHALL migrate to `preset = 'default'` and `mode = 'auto'`.
- If `ui_theme_preset` is `'light'`, it SHALL migrate to `preset = 'default'` and `mode = 'light'`.
- If `ui_theme_preset` is `'dark'`, it SHALL migrate to `preset = 'default'` and `mode = 'dark'`.
- Otherwise, if `ui_theme_preset` matches a valid preset name (`default`, `modern`, `recall`,
  `archive`, `paper`, `forest`, `sakura`, `nord`), that preset SHALL be used; missing or invalid values SHALL default to `'default'`.

## 3. Color Mode

### 3.1 Mode Values

The color mode (`UiThemeMode`) SHALL be one of:

| Value   | Label    | Behavior                                               |
| ------- | -------- | ------------------------------------------------------ |
| `auto`  | 跟随系统 | Follow `prefers-color-scheme: dark` system media query |
| `light` | 浅色     | Force the `light` variant of the active preset         |
| `dark`  | 深色     | Force the `dark` variant of the active preset          |

### 3.2 Mode Storage and Backward Compatibility

The active color mode SHALL be persisted in `localStorage` under the key `ui_theme_mode`.
On application load (when not overridden by a legacy merged preset value in Section 2.2):

- `'auto'`, `'light'`, and `'dark'` SHALL be preserved as-is.
- Legacy `'manual'` SHALL be normalized to `'light'`.
- `'system'` SHALL be normalized to `'auto'`.
- Missing or unrecognized values SHALL default to `'auto'`.
- If `ui_theme_mode` was previously absent, `ui_theme_preset` was one of the previously light-only
  presets (`modern`, `recall`, `archive`), and the initial resolved color scheme is `'dark'`, the
  frontend SHALL clear `localStorage['ui_theme']` once before applying overrides so legacy light
  overrides are not merged onto the dark palette.

### 3.3 System Color Scheme Synchronization and Base Theme

The effective color scheme (`'light' | 'dark'`) SHALL be computed as:

- `prefersDark ? 'dark' : 'light'` when `mode === 'auto'`
- `'light'` when `mode === 'light'`
- `'dark'` when `mode === 'dark'`

The frontend SHALL subscribe to `window.matchMedia('(prefers-color-scheme: dark)')`. When the media
query emits a `change` event while `mode === 'auto'`, the frontend SHALL clear `localStorage['ui_theme']`
and immediately recompute the effective `UiThemeVars`, Naive UI base theme, and `colorScheme` from
the active preset and newly resolved color scheme.

When the effective color scheme is `'dark'`, the root `NConfigProvider` (and discrete dialog API)
SHALL use Naive UI `darkTheme` as its base theme before applying `themeOverrides`, and
`document.documentElement.style.colorScheme` SHALL be set to `dark` (otherwise `light`).

## 4. Theme Computation

### 4.1 Resolution Order

The effective `UiThemeVars` SHALL be computed as:

```
colorScheme = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode
base = presets[presetName][colorScheme]  // light or dark variant of chosen preset
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

### 5.3 Preset and Color Mode Controls

Two independent controls SHALL appear in the drawer (and as select boxes in the Settings page under appearance preferences):

1. **主题预设** — options: 默认, 现代, 追忆, 洛谷仓库, 书卷, 青松, 绯樱, 极夜 (rendered as a visual 2-column swatch grid in the drawer previewing surface, primary color, typography sample, and code accent under the effective color scheme)
2. **配色模式** — options: 跟随系统, 浅色, 深色

### 5.4 Manual Colour Editor

The full colour editor (collapsible sections with color pickers, code theme selector, shadow
inputs, and radius inputs) SHALL be folded inside a collapsed「高级选项」section in the drawer and remain interactive when expanded.

### 5.5 Reset Button

A single "重置为预设" button SHALL appear in the drawer footer. Clicking it SHALL replace the
current `uiThemeVars` with `presets[presetName][colorScheme]`, discarding all manual overrides.

## 6. Interaction Rules

### 6.1 Changing the Preset or Color Mode

When the user selects a different preset or color mode:

- `localStorage['ui_theme']` SHALL be cleared (all manual overrides discarded).
- The updated `ui_theme_preset` or `ui_theme_mode` SHALL be persisted.
- The effective theme SHALL be recomputed from `presets[presetName][colorScheme]`.

### 6.2 Manual Override Persistence

Whenever the user modifies any value in the editor, the diff relative to
`presets[presetName][colorScheme]` SHALL be persisted to `localStorage` under `ui_theme` (or
cleared when no property differs from the resolved base preset).

## 7. Injection Keys

The following injection keys SHALL be provided by `App.vue` for child components:

| Key                | Type                     | Purpose                      |
| ------------------ | ------------------------ | ---------------------------- |
| `uiThemeKey`       | `Ref<UiThemeVars>`       | Current effective theme vars |
| `uiThemeModeKey`   | `Ref<UiThemeMode>`       | Current color mode           |
| `uiThemePresetKey` | `Ref<UiThemePresetName>` | Current preset name          |

## 8. Non-Goals

- Presets are not editable, importable, or exportable.
- There is no "save as preset" feature.
- The user, prize, and cheater colour tokens are not affected by preset switching;
  they always use the hardcoded values from the `default` preset.
