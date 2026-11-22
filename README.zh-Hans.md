<div align="center">
    <h1>Luogu Saver (LGS)</h1>
    <p>一个用于保存来自 www.luogu.com.cn 的用户生成内容 (UGC) 的 Web 应用程序。</p>
    <p>
        <img src="https://img.shields.io/badge/node-v22.18.0-brightgreen" alt="Node 版本"/>
        <img src="https://img.shields.io/github/last-commit/laikit-dev/luogu-saver" alt="最后提交"/>
        <img src="https://img.shields.io/github/actions/workflow/status/laikit-dev/luogu-saver/deploy.yml" alt="构建状态">
        <img src="https://img.shields.io/github/license/laikit-dev/luogu-saver" alt="许可证"/>
    </p>
    <p><a href="README.md">English</a> | 简体中文</p>
</div>

## 项目描述

**Luogu Saver (LGS)** 是一个 Web 应用程序，旨在帮助用户保存和管理来自 [洛谷](https://www.luogu.com.cn/)（一个流行的中文算法竞赛平台）的用户生成内容。该工具允许用户存档文章、剪贴板内容和其他类型的内容，确保有价值的信息得以保存并易于访问。

## 功能特性

- **内容存档：** 直接从洛谷保存文章和剪贴板内容。
- **管理界面：** 用户友好的界面，用于组织已保存的内容。
- **广泛支持：** 高效处理多种内容类型。
- **高性能：** 利用客户端渲染提供流畅的用户体验。
- **响应式设计：** 针对桌面、平板和移动设备进行优化。
- **智能推荐：** 根据用户活动推荐相关内容。
- **陶片放逐存档：** 无需单独的网站或 API 服务，即可保存和筛选洛谷社区用户权限变更记录。
- **用户归档：** 浏览作者文章、公开资料快照及陶片放逐记录。
- **公开资料历史：** 完整资料保存默认记录公开快照，所有访问者均可切换查看历史版本。
- **版本对比：** 对比任意两个文章归档版本的 Markdown 源码差异。

## 保存内容

- 同一队列中的等待任务优先处理登录用户请求，再处理未登录用户请求；已经开始的任务不会被中断。
- 未登录用户提交保存前可选择通过 CP OAuth 登录或直接继续保存，并可记住当前浏览器的选择。
- 同一目标已有进行中的保存流程时会复用该流程，并在收到更高优先级请求时提升其排队与后续任务优先级。

`queue` 的各个队列段（`save`、`ai`、`update`、`search`、`read`）均可设置非负整数 `extraCapacity`（默认 `0`），为登录用户保留超出 `maxQueueLength` 的额外排队容量：

```yaml
queue:
    save:
        extraCapacity: 100
    ai:
        extraCapacity: 50
```

## 用户归档

- 公开用户归档：`/user/<洛谷 UID>`（历史资料快照链接使用 `?version=N`）。
- 文章版本对比链接：`/article/<文章 ID>?compareFrom=N&compareTo=M`。

## 架构

本项目是一个由 npm workspaces 管理的 **Monorepo**：

- **根目录：** 管理共享的开发依赖（Prettier、TypeScript 等）和编排。
- **`packages/frontend`：** Vue 3 + Vite 应用程序（Naive UI）。
- **`packages/backend`：** Koa + TypeScript API 服务。
- **陶片放逐模块：** 后端统一负责定时抓取、MariaDB 存储和只读 API；Vue 页面只访问同源 `/api/judgement`。
- **基础设施：** 外部服务（数据库等）通过 Docker Compose 管理。

## 前置要求

确保已安装以下软件：

- [Node.js](https://nodejs.org/)（版本 22.18.0 或更高）
- [Docker](https://www.docker.com/) 和 Docker Compose（用于基础设施服务）

## 基础设施设置

在本地构建或运行应用程序之前，需要初始化底层基础设施。根目录 `docker-compose.yml` 是开发和单机测试配置，所有服务端口仅绑定到 `127.0.0.1`。

> **注意：** 此 Compose 文件 **仅** 管理外部基础设施，Node.js 应用程序在主机上单独运行。生产环境不得直接使用这份 Compose 配置。

在后台启动基础设施：

```bash
docker compose up -d
```

MariaDB 使用项目级 Docker 命名卷 `mariadb-data`，不再把主机的 `./mysql-data` 目录绑定到容器。这可避开已在 MariaDB 13.0.2 与 Windows 大小写不敏感绑定目录组合上复现的外键 DDL 重命名失败。两份 Compose 配置首次初始化时均会创建 `luogu_saver` 数据库；请将 `packages/backend/config.yml` 的 `db.database` 设为 `luogu_saver`，或自行创建配置中指定的其他数据库。

从旧绑定目录切换时，先停止后端。旧的 `./mysql-data` 目录会保留，但新卷初始为空，不会自动导入旧数据。如需保留数据，必须在重建数据库容器前用 `mariadb-dump` 做逻辑备份，并在切换后恢复到新实例。无需保留本地数据时，执行：

```bash
docker compose up -d --force-recreate db
```

使用另一份本地配置时，改为执行 `docker compose -f docker-compose.local.yml up -d --force-recreate saver-db`。等待 MariaDB 就绪后再启动后端。除非确定要删除命名卷及其中的数据库，否则不要执行 `docker compose down -v`。

## 构建说明

### 1. 克隆仓库

```bash
git clone https://github.com/laikit-dev/luogu-saver.git
cd luogu-saver
```

### 2. 安装依赖

一次性安装根目录和所有工作区的依赖：

```bash
npm install
```

### 3. 构建

可以使用单个命令构建整个项目（前端和后端）：

```bash
npm run build
```

或者使用 npm workspaces 分别构建：

**仅构建前端：**

```bash
# 可选：内联设置环境变量
# VITE_API_URL=https://api.example.com npm run build -w @luogu-saver/frontend
npm run build -w @luogu-saver/frontend
```

_编译后的静态文件将位于 `packages/frontend/dist` 目录中。_

**仅构建后端：**

```bash
npm run build -w @luogu-saver/backend
```

_编译后的后端文件将位于 `packages/backend/dist` 目录中。_

## 开发

我们使用 `concurrently` 通过单个命令在监视模式下同时运行前端和后端。

### 1. 启动基础设施

确保数据库和其他服务正在运行：

```bash
docker compose up -d
```

### 2. 启动开发服务器

在项目根目录中运行：

```bash
npm run dev
```

这将：

1. 在监视模式下启动 **前端**（Vite）。
2. 在监视模式下启动 **后端**（ts-node-dev）。
3. 在同一终端中输出两个服务的日志（颜色编码）。

## 部署

### 1. 准备基础设施

使用托管服务、生产专用 Compose 或 Kubernetes 部署 MariaDB、Redis、Chroma 和 Meilisearch。不要把仓库根目录的 `docker-compose.yml` 当作生产方案。依赖服务必须只允许后端主机或私有网络访问，并在启动后端前更换所有默认凭据。

### 2. 运行后端服务器

导航到后端工作区或直接从根目录运行：

```bash
cd packages/backend
# 仅安装生产依赖
npm install --production
# 启动服务器
node dist/index.js
```

服务器将在配置的端口（默认为 `3000`）上启动。

### 3. 提供前端服务

需要一个 Web 服务器（例如 **Nginx** 或 **Caddy**）来提供位于以下目录的静态文件：
`packages/frontend/dist`

### 4. 配置与代理

如果在构建前端时未设置 `VITE_API_URL` 变量，应用程序默认将请求发送到同一域名的 `/api`。

**关键步骤：** 必须配置 Web 服务器（Nginx/Caddy）将以 `/api` 开头的请求反向代理到正在运行的后端服务（例如 `localhost:3000`）。

#### 多前端域名的 OAuth 配置

在 CP OAuth 中仍只登记一个固定的后端回调地址。将下列配置合并到后端 `config.yml` 已有的 `auth.cpOAuth` 中，保留原有的 client ID 和 secret：

```yaml
auth:
    cpOAuth:
        redirectUri: https://api.luogu.me/auth/cp/callback
        frontendRedirectUri: https://www.luogu.me/auth/callback
        allowedFrontendOrigins:
            - https://mirror.example
```

将 `https://mirror.example` 替换为实际的备用前端 origin，可填写多项。每项只能包含协议、域名和可选的非默认端口，不得包含末尾斜杠、路径、账号密码、查询参数、片段或通配符。生产环境使用 HTTPS。

绝对地址 `frontendRedirectUri` 自身的 origin 默认允许，其路径、查询参数和片段作为所有前端的回调模板。如果该项使用 `/auth/callback` 等相对路径，必须在 `allowedFrontendOrigins` 中明确列出所有前端 origin。每个前端都需要提供对应的回调路由；跨域请求时，API 反向代理的 CORS 配置还需要允许这些 origin 和前端使用的请求头。

前端发起登录时传递自身 origin，后端校验后将其与一次性 OAuth state 一起保存。登录成功、取消授权和登录失败均返回该 origin，不能通过修改回调查询参数更换目标域名。过期、重复使用或其他无效 state 直接返回 API 错误，不执行跳转。无需增加 `landing` 域名；授权和兑换授权码时的 `redirectUri` 始终保持固定。

新版前后端需要一起部署，配置修改后重启后端。旧版页面需要刷新后再登录；升级前已经发起的登录因 state 缺少来源 origin，需要重新发起。各前端域名仍分别保存浏览器中的登录 token，不会自动共享跨域登录状态。

### 5. 自动部署

配置好 `production` 环境 Secrets 后，每次推送到 `master` 都会先构建 Markdown renderer、前端和后端，再开始部署。工作流先部署前端，在当前后端继续运行时暂存并验证新后端，随后显式停止旧 PM2 进程并启动已暂存的后端。后端切换期间会在进程停止、数据库结构同步和启动阶段产生有限的计划内中断。

## 陶片放逐

后端会在启动时以及之后每 20 分钟固定抓取 `https://www.luogu.com.cn/judgement`，不再读取 `config.yml` 中的 `judgement` 配置。

经 `/api` 反向代理公开的只读接口为：

- `GET /api/judgement`
- `GET /api/judgement/logs`
- `GET /api/judgement/stats`

## 贡献

欢迎贡献！要为 Luogu Saver 做出贡献：

1. **Fork** GitHub 上的仓库。
2. **创建** 一个新的分支用于你的功能或错误修复。
3. **提交** 你的更改，并附上清晰、描述性的提交信息。
4. **推送** 你的更改到你的 fork 仓库。
5. **打开** 一个 Pull Request 到主仓库。

请确保你的代码符合项目的编码标准（Prettier）并包含适当的测试。
