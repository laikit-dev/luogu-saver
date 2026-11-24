# Theme Preset System Specification

## 1. Overview

The theme preset system allows users to switch between curated light color schemes (presets).
Manual overrides are persisted independently and reset when the preset changes. Site-wide
light/dark theme switching is not provided.

## 2. Presets

### 2.1 Preset Definitions

There SHALL be exactly four predefined presets:

| Preset Name | Label    | Source                           |
| ----------- | -------- | -------------------------------- |
| `default`   | 默认     | luogu-saver-next built-in theme  |
| `modern`    | 现代     | luogu-saver-pr47 theme           |
| `recall`    | 追忆     | luogu-saver-recall color palette |
| `archive`   | 洛谷仓库 | luogu-archive color palette      |

Each preset SHALL define a single complete `UiThemeVars` object (`vars`).

### 2.2 Preset Storage

The active preset name SHALL be persisted in `localStorage` under the key `ui_theme_preset`.
On application load, the system SHALL read this key. If the value is missing or does not
match a valid preset name, the system SHALL default to `default`.

## 3. Removed Color Mode

The frontend SHALL NOT expose site-wide light/dark/system color mode switching, SHALL NOT read or
write `localStorage['ui_theme_mode']`, SHALL NOT subscribe to `prefers-color-scheme`, and SHALL NOT
provide `uiThemeModeKey` or `UiThemeMode`.

## 4. Theme Computation

### 4.1 Resolution Order

The effective `UiThemeVars` SHALL be computed as:

```
base = presets[presetName].vars          // base theme variables of chosen preset
overrides = localStorage['ui_theme']     // user customisations (partial UiThemeVars)
result = merge(base, overrides)          // overrides take precedence
```

### 4.2 CSS Variable Injection

Every property of the effective `UiThemeVars` SHALL be written as a corresponding CSS custom
property on `document.documentElement.style`. The mapping follows the existing convention
(e.g., `bodyColor` → `--ui-body-color`).

## 5. User Interface

### 5.1 Drawer Trigger

A floating circular button SHALL be fixed at the bottom-right of the viewport. Clicking it
SHALL open the theme editor drawer.

### 5.2 Drawer Header

The drawer title SHALL be "主题编辑器".

### 5.3 Preset Select Box

A single select box SHALL appear at the top of the drawer:

1. **主题预设** — options: 默认, 现代, 追忆, 洛谷仓库

### 5.4 Manual Colour Editor

The full colour editor (collapsible sections with color pickers, code theme selector, shadow
inputs, and radius inputs) SHALL be displayed and interactive.

### 5.5 Reset Button

A single "重置为预设" button SHALL appear in the drawer footer. Clicking it SHALL replace the
current `uiThemeVars` with `presets[presetName].vars`, discarding all manual overrides.

## 6. Interaction Rules

### 6.1 Changing the Preset

When the user selects a different preset:

- `localStorage['ui_theme']` SHALL be cleared (all manual overrides discarded).
- The effective theme SHALL be recomputed from the new preset's `vars`.

### 6.2 Manual Override Persistence

Whenever the user modifies any value in the editor, the diff relative to `presets[presetName].vars`
SHALL be persisted to `localStorage` under `ui_theme` (or cleared when no property differs from the
base preset).

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
  they always use the hardcoded values from the `default` preset.
