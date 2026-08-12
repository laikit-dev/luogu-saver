# Theme Preset System Specification

## 1. Overview

The theme preset system allows users to switch between curated color schemes (presets) and
a color mode (light, dark, or system-follow). Manual color overrides are persisted independently
and reset when the preset changes.

## 2. Presets

### 2.1 Preset Definitions

There SHALL be exactly four predefined presets:

| Preset Name | Label    | Source                           |
| ----------- | -------- | -------------------------------- |
| `default`   | 默认     | luogu-saver-next built-in theme  |
| `modern`    | 现代     | luogu-saver-pr47 theme           |
| `recall`    | 追忆     | luogu-saver-recall color palette |
| `archive`   | 洛谷仓库 | luogu-archive color palette      |

Each preset SHALL define two complete `UiThemeVars` objects: one for light mode and one for
dark mode.

### 2.2 Preset Storage

The active preset name SHALL be persisted in `localStorage` under the key `ui_theme_preset`.
On application load, the system SHALL read this key. If the value is missing or does not
match a valid preset name, the system SHALL default to `default`.

## 3. Color Mode

### 3.1 Mode Values

The color mode (`UiThemeMode`) SHALL be one of:

| Value   | Behavior                                         |
| ------- | ------------------------------------------------ |
| `auto`  | Follow `prefers-color-scheme` system media query |
| `light` | Force light variant of the active preset         |
| `dark`  | Force dark variant of the active preset          |

### 3.2 Mode Storage

The mode SHALL be persisted in `localStorage` under the key `ui_theme_mode`.
On application load, the system SHALL read this key. If missing, the mode SHALL default to
`auto`.

### 3.3 Backward Compatibility

If `ui_theme_mode` contains the legacy value `manual`, the system SHALL treat it as `light`.

## 4. Theme Computation

### 4.1 Resolution Order

The effective `UiThemeVars` SHALL be computed as:

```
base = presets[presetName][mode]         // light or dark variant of chosen preset
overrides = localStorage['ui_theme']     // user customisations (partial UiThemeVars)
result = merge(base, overrides)          // overrides take precedence
```

When `mode === 'auto'`:

- `mode` in the resolution above SHALL be `light` or `dark` based on
  `window.matchMedia('(prefers-color-scheme: dark)').matches`.
- `overrides` SHALL be ignored (user cannot edit when in auto mode).

### 4.2 Reactivity

A watcher on the system `prefers-color-scheme` media query SHALL reapply the base theme
when the mode is `auto` and the system preference changes.

### 4.3 CSS Variable Injection

Every property of the effective `UiThemeVars` SHALL be written as a corresponding CSS custom
property on `document.documentElement.style`. The mapping follows the existing convention
(e.g., `bodyColor` → `--ui-body-color`).

## 5. User Interface

### 5.1 Drawer Trigger

A floating circular button SHALL be fixed at the bottom-right of the viewport. Clicking it
SHALL open the theme editor drawer.

### 5.2 Drawer Header

The drawer title SHALL be "主题编辑器".

### 5.3 Two Select Boxes

Two select boxes SHALL appear side by side at the top of the drawer, each taking equal width:

1. **主题预设** — options: 默认, 现代, 追忆, 洛谷仓库
2. **配色模式** — options: 浅色, 深色, 跟随系统

### 5.4 Manual Colour Editor

When `mode !== 'auto'`, the full colour editor (collapsible sections with color pickers,
shadow inputs, radius inputs) SHALL be displayed and interactive.

When `mode === 'auto'`, the colour editor SHALL be visually disabled (opacity 0.5,
pointer-events none) to indicate that colours are read-only.

### 5.5 Reset Button

A single "重置为预设" button SHALL appear in the drawer footer when `mode !== 'auto'`.
Clicking it SHALL replace the current `uiThemeVars` with the base variant of the active
preset (light or dark depending on mode), discarding all manual overrides.

There SHALL NOT be separate reset buttons for light and dark.

## 6. Interaction Rules

### 6.1 Changing the Preset

When the user selects a different preset:

- `localStorage['ui_theme']` SHALL be cleared (all manual overrides discarded).
- The effective theme SHALL be recomputed from the new preset's base.

### 6.2 Changing the Mode

When the user switches `mode`:

- The effective theme SHALL be recomputed from the active preset using the new mode.
- If the previous mode was not `auto`, stored manual overrides SHALL be preserved
  and merged on top of the new base.

### 6.3 Manual Override Persistence

Whenever the user modifies any colour in the editor, the full effective `UiThemeVars`
SHALL be persisted to `localStorage` under `ui_theme` (only when `mode !== 'auto'`).

## 7. Injection Keys

The following injection keys SHALL be provided by `App.vue` for child components:

| Key                | Type                     | Purpose                      |
| ------------------ | ------------------------ | ---------------------------- |
| `uiThemeKey`       | `Ref<UiThemeVars>`       | Current effective theme vars |
| `uiThemeModeKey`   | `Ref<UiThemeMode>`       | Current colour mode          |
| `uiThemePresetKey` | `Ref<UiThemePresetName>` | Current preset name          |

## 8. Non-Goals

- Presets are not editable, importable, or exportable.
- There is no "save as preset" feature.
- The user, prize, and cheater colour tokens are not affected by preset switching;
  they always use the hardcoded values from the `default` preset.
