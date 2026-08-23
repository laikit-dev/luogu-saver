<div align="center">
    <h1>Luogu Saver (LGS)</h1>
    <p>A web application for saving user-generated content (UGC) from www.luogu.com.cn.</p>
    <p>
        <img src="https://img.shields.io/badge/node-v22.18.0-brightgreen" alt="Node Version"/>
        <img src="https://img.shields.io/github/last-commit/laikit-dev/luogu-saver" alt="Last Commit"/>
        <img src="https://img.shields.io/github/actions/workflow/status/laikit-dev/luogu-saver/deploy.yml" alt="Build Status">
        <img src="https://img.shields.io/github/license/laikit-dev/luogu-saver" alt="License"/>
    </p>
    <p>English | <a href="README.zh-Hans.md">简体中文</a></p>
</div>

## Description

**Luogu Saver (LGS)** is a web application designed to help users save and manage user-generated content from [Luogu](https://www.luogu.com.cn/), a popular Chinese competitive programming platform. This tool allows users to archive articles, pastes, and other content types, ensuring that valuable information is preserved and remains easily accessible.

## Features

- **Content Archiving:** Save articles and pastes directly from Luogu.
- **Management UI:** User-friendly interface for organizing saved content.
- **Broad Support:** Handles multiple content types efficiently.
- **High Performance:** Utilizes client-side rendering for a smooth user experience.
- **Responsive Design:** Optimized for use on desktops, tablets, and mobile devices.
- **Intelligent Recommendations:** Suggests related content based on user activity.
- **Judgement Archive:** Stores and filters Luogu community permission-change history without a separate website or API service.

## Architecture

This project is a **Monorepo** managed by npm workspaces:

- **Root:** Manages shared dev-dependencies (Prettier, TypeScript, etc.) and orchestration.
- **`packages/frontend`:** Vue 3 + Vite application (Naive UI).
- **`packages/backend`:** Koa + TypeScript API service.
- **Judgement module:** The backend owns scheduled Luogu fetching, MariaDB persistence, read-only APIs, and the legacy SQLite import adapter; the Vue page uses the same-origin `/api/judgement` endpoint.
- **Infrastructure:** External services (Database, etc.) managed via Docker Compose.

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (version 22.18.0 or higher)
- [Docker](https://www.docker.com/) & Docker Compose (for infrastructure services)

## Infrastructure Setup

Before building or running the application for local development, initialize the required external services. The root `docker-compose.yml` is a local infrastructure profile for development and single-host testing. It binds service ports to `127.0.0.1` so MariaDB, Redis, Chroma, and Meilisearch are reachable from the host only.

> **Note:** This Compose file **only** manages external infrastructure. The Node.js application itself is run separately on the host. Do not use this file as a production infrastructure plan without replacing all default credentials and keeping service ports off public interfaces.

Start the local infrastructure in the background:

```bash
docker compose up -d
```

## Build Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/laikit-dev/luogu-saver.git
cd luogu-saver
```

### 2. Install Dependencies

Install dependencies for the root and all workspaces in one go:

```bash
npm install
```

### 3. Build

You can build the entire project (Frontend & Backend) with a single command:

```bash
npm run build
```

Or build them individually using npm workspaces:

**Frontend Only:**

```bash
# Optional: Set environment variables inline
# VITE_API_URL=https://api.example.com npm run build -w @luogu-saver/frontend
npm run build -w @luogu-saver/frontend
```

_The compiled static files will be located in `packages/frontend/dist`._

**Backend Only:**

```bash
npm run build -w @luogu-saver/backend
```

_The compiled backend files will be located in `packages/backend/dist`._

## Development

We use `concurrently` to run both frontend and backend in watch mode with a single command.

### 1. Start Infrastructure

Ensure your database and other services are running:

```bash
docker compose up -d
```

### 2. Start Development Server

In the project root, run:

```bash
npm run dev
```

This will:

1. Start the **Frontend** (Vite) in watch mode.
2. Start the **Backend** (ts-node-dev) in watch mode.
3. Output logs from both services in the same terminal (color-coded).

## Deployment

### 1. Prepare Infrastructure

Provision production MariaDB, Redis, Chroma, and Meilisearch instances using a managed service or a production-specific Compose/Kubernetes configuration. Do not run the repository root `docker-compose.yml` as the production infrastructure plan.

Before starting the backend, ensure all of the following conditions are true:

- MariaDB, Redis, Chroma, and Meilisearch accept connections only from the backend host or from a private network.
- Public internet clients cannot connect directly to ports `3306`, `6379`, `8000`, or `7700`.
- MariaDB, Redis, and Meilisearch use non-default secrets.
- Chroma is protected by the network boundary used for backend-only infrastructure access.

### 2. Run the Backend Server

Navigate to the backend workspace or run directly from the root:

```bash
cd packages/backend
# Install production dependencies only
npm install --production
# Start the server
node dist/index.js
```

The server will start on the configured port (default is `3000`).

### 3. Serve the Frontend

You need a web server (e.g., **Nginx** or **Caddy**) to serve the static files located in:
`packages/frontend/dist`

### 4. Configuration & Proxying

If you did not set the `VITE_API_URL` variable during the frontend build, the application defaults to sending requests to `/api` on the same domain.

**Crucial Step:** You must configure your web server (Nginx/Caddy) to reverse proxy requests starting with `/api` to the running backend service (e.g., `localhost:3000`).

### 5. Automatic Deployment

After the `production` environment secrets are configured, every push to `master` builds the Markdown renderer, frontend, and backend before deployment. The workflow deploys the frontend, stages and validates the backend while the current backend remains running, then explicitly stops the old PM2 process and starts the staged backend. The backend cutover has a bounded outage during process stop, schema synchronization, and startup.

## Judgement Migration

Back up and stop the legacy `luogu-judgement-saver` scheduler. Run the importer before starting the new backend, or stop the new backend while the importer runs, then import the untracked `data/judgements.db`. The offset must be the old server's local time zone:

```bash
npm run build -w @luogu-saver/backend
npm run import:judgement -w @luogu-saver/backend -- \
  --db /secure/path/judgements.db \
  --source-time-zone +08:00
```

The production deployment already contains the compiled backend and production dependencies. Run the importer there without rebuilding:

```bash
cd /opt/luogu-saver-backend
npm run import:judgement -- \
  --db /secure/path/judgements.db \
  --source-time-zone +08:00
```

The importer is idempotent and prints a count/key/time-range audit. After it passes, start the backend and observe a successful `/judgement/logs` entry. The backend always fetches `https://www.luogu.com.cn/judgement` at startup and every 20 minutes; no `judgement` section in `config.yml` is used. Keep the old service read-only during a rollback window; never commit the SQLite file or production configuration.

Public read-only endpoints behind the `/api` reverse proxy are:

- `GET /api/judgement`
- `GET /api/judgement/logs`
- `GET /api/judgement/stats`

## Contributing

Contributions are welcome! To contribute to Luogu Saver:

1. **Fork** the repository on GitHub.
2. **Create** a new branch for your feature or bug fix.
3. **Commit** your changes with clear, descriptive messages.
4. **Push** your changes to your forked repository.
5. **Open** a Pull Request to the main repository.

Please ensure your code adheres to the project's coding standards (Prettier) and includes appropriate tests.
