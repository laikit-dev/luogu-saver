# About Page Specification

## 1. Overview

The About page is a static, read-only informational page served by the frontend at `/about`. It introduces the project, enumerates its features, states the technology stack, surfaces live runtime statistics, links to the open-source repository, and presents a data-source and disclaimer notice.

The page introduces NO new backend endpoints, NO new database tables, and NO new shared types. It reuses existing public count endpoints for its statistics section. All other content is static text rendered client-side.

The navigation entry already exists in `App.vue` (`menuOptions`, key `about`); selecting it invokes `router.push('/about')`. Prior to this page, that route resolved to the catch-all `NotFound` view. This specification defines the route and view that satisfy the existing entry.

## 2. Route

A single route is registered through the frontend router module auto-loader (`packages/frontend/src/routers/index.ts`, which globs `./modules/*.ts`).

| Property          | Value                                       |
| ----------------- | ------------------------------------------- |
| `path`            | `/about`                                    |
| `name`            | `about`                                     |
| `component`       | `@/views/about/AboutView.vue` (lazy-loaded) |
| `meta.activeMenu` | `about`                                     |

`meta.activeMenu` MUST equal `about` so the sidebar highlights the matching menu entry, consistent with the `App.vue` active-menu computation.

## 3. Page Sections

The view SHALL render the following sections, in this order. Section copy is in Simplified Chinese with a formal, documentation-style register.

### 3.1 Header

A page title identifying the project as Luogu Saver. The Hero SHALL retain the title and icon without a background or outer border.

### 3.2 Project Introduction (项目简介)

A prose description: LGS is a web application for archiving user-generated content (articles, pastes, and related content) from Luogu, so that valuable content remains accessible even if the original is deleted.

### 3.3 Core Features (核心功能)

A list of the application's user-facing capabilities. Each item has a short label and a one-line description. The set is sourced from the live navigation menu and MUST remain a superset accurate to shipped functionality; at minimum it includes content archiving (articles and pastes), full-text search, the article plaza, user profiles, and intelligent recommendations.

### 3.4 Technology & Architecture (技术与架构)

A concise statement of the stack: a npm-workspaces monorepo; a Vue 3 + Vite + Naive UI frontend; a Koa + TypeScript backend; supporting infrastructure managed via Docker Compose. The project is released under the AGPL-3.0 license.

### 3.5 Runtime Statistics (运行统计)

Three live figures:

1. **Days in operation** — computed client-side as `floor((now - FOUNDING_DATE) / 1 day)`, where `FOUNDING_DATE` is `2025-02-12T00:00:00Z`. This constant mirrors `foundDate` in `App.vue`; the two MUST stay equal.
2. **Total archived articles** — from `GET /article/count` via `getArticleCount()`.
3. **Total archived pastes** — from `GET /paste/count` via `getPasteCount()`.

Both counts default to `0` before their requests resolve. Request failures are non-fatal: the affected figure remains `0` and no error is surfaced to the user. The statistics section MUST render even if both requests fail.

### 3.6 Open Source & Contribution (开源与贡献)

A link to the GitHub repository (`https://github.com/laikit-dev/luogu-saver`), a statement of the AGPL-3.0 license, and a short invitation to contribute via pull request. External links MUST open in a new tab with `rel="noopener noreferrer"`.

### 3.7 Data Source & Disclaimer (数据来源与免责声明)

A notice stating that:

1. All archived content originates from Luogu and its copyright belongs to the respective original authors.
2. This project is an unofficial archive and is not affiliated with or endorsed by Luogu.
3. Content may be removed upon a legitimate request from the rights holder.

This section is rendered last and styled with reduced visual emphasis.

## 4. Data Sources

The page consumes only the following existing endpoints; it MUST NOT introduce new ones:

- `GET /article/count` → `{ count: number }` (via `getArticleCount`)
- `GET /paste/count` → `{ count: number }` (via `getPasteCount`)

The founding date is a frontend constant, not a server value.

## 5. Layout & Styling

- The view reuses the shared `Card` component (`@/components/Card.vue`) for each section, consistent with `HomeView`.
- The runtime statistics use Naive UI `NStatistic` inside a responsive `NGrid`.
- The layout is a single vertical column of cards on all breakpoints, with the statistics figures arranged horizontally within their card and collapsing to fewer columns on narrow screens.
- Colors derive from the injected theme variables (`uiThemeKey`), never hard-coded brand colors, matching the rest of the application.

## 6. Invariants

1. The page is purely presentational: it triggers only idempotent GET requests and mutates no server state.
2. No authentication is required; the page is accessible to anonymous visitors.
3. The page MUST render fully even when both count requests fail.
4. `FOUNDING_DATE` in the view MUST equal `foundDate` in `App.vue`.
5. The route's `meta.activeMenu` MUST equal `about`.
