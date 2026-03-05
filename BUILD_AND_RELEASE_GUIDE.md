# MantisBot 构建与发布指南 / Build & Release Guide

> 基于项目根目录 `Makefile` 编写，重点说明 `make` 指令使用方式。  
> Based on the root `Makefile`, focusing on practical `make` command usage.

---

## 1. 前置要求 / Prerequisites

### 中文
- 已安装 Docker（支持 `docker build`、`docker buildx`、`docker push`）。
- 已安装 Docker Compose（用于本地运行）。
- 已安装 Node.js（发布流程会修改 `package.json` 版本号）。
- 已登录镜像仓库（可执行 `make login`）。

### English
- Docker is installed (`docker build`, `docker buildx`, `docker push` available).
- Docker Compose is installed (for local runtime).
- Node.js is installed (release flow updates `package.json` version).
- Logged in to container registry (you can run `make login`).

---

## 2. 快速查看可用命令 / List Available Commands

```bash
make help
```

### 中文
显示 Makefile 中所有带说明的目标命令。

### English
Shows all documented Make targets.

---

## 3. 配置变量（可覆盖）/ Config Variables (Overridable)

默认变量来自 `Makefile`：

- `REGISTRY`（默认 `docker.io`）
- `IMAGE_PREFIX`（默认 `mantis`）
- `VERSION`（默认读取 `package.json` 的 version）
- `PLATFORMS`（默认 `linux/arm64,linux/amd64`）

### 用法示例 / Example

```bash
make build REGISTRY=ghcr.io IMAGE_PREFIX=myteam VERSION=1.2.3
```

### 中文
可以在命令行临时覆盖变量，不会永久修改 Makefile。

### English
You can override variables per command without modifying the Makefile permanently.

---

## 4. 常用构建命令 / Common Build Commands

### 4.1 构建全部镜像 / Build all images

```bash
make build
```

- 中文：等价于先后执行 `build-backend` 和 `build-webui`，本地单平台构建。
- English: Equivalent to `build-backend` + `build-webui`, local single-platform build.

### 4.2 仅构建后端 / Build backend only

```bash
make build-backend
```

### 4.3 仅构建前端 / Build Web UI only

```bash
make build-webui
```

---

## 5. 推送命令 / Push Commands

### 5.1 推送全部镜像 / Push all images

```bash
make push
```

### 5.2 分别推送 / Push individually

```bash
make push-backend
make push-webui
```

### 注意 / Note
- 中文：`push` 目标推送的是 `:$(VERSION)` 标签。  
- English: `push` targets push the `:$(VERSION)` tag.

---

## 6. 多平台构建与发布 / Multi-platform Build & Release

### 6.1 多平台构建并推送（全部）/ Multi-platform build & push (all)

```bash
make buildx
```

- 中文：会为后端和 Web UI 执行 `docker buildx build --platform ... --push`，并打 `VERSION` 与 `latest` 标签。
- English: Runs `docker buildx build --platform ... --push` for backend and Web UI, tagging both `VERSION` and `latest`.

### 6.2 完整发布（patch）/ Full release (patch)

```bash
make release
```

- 中文：先执行 `bump-version`（例如 `1.0.0 -> 1.0.1`），再执行 `buildx`。
- English: Runs `bump-version` first (e.g., `1.0.0 -> 1.0.1`), then `buildx`.

### 6.3 发布 minor / Release minor

```bash
make release-minor
```

- 中文：例如 `1.0.x -> 1.1.0`
- English: Example `1.0.x -> 1.1.0`

### 6.4 发布 major / Release major

```bash
make release-major
```

- 中文：例如 `1.x.x -> 2.0.0`
- English: Example `1.x.x -> 2.0.0`

### 6.5 只发布单个组件 / Release single component

```bash
make release-backend
make release-webui
```

- 中文：仅多平台构建并推送对应镜像，不自动递增版本号。
- English: Only builds/pushes the selected image with buildx; does not auto-bump version.

---

## 7. 版本号相关命令 / Version Bump Commands

```bash
make bump-version   # patch
make bump-minor     # minor
make bump-major     # major
```

### 中文
以上命令会直接修改 `package.json` 的 `version` 字段。

### English
These commands directly update the `version` field in `package.json`.

---

## 8. Docker Compose 配置指南 / Docker Compose Configuration Guide

项目使用 `docker-compose.yml` 定义本地开发与测试环境。以下是关键配置说明。

### 8.1 服务架构 / Services

| 服务名 | 用途 | 构建方式 | 端口 |
|------|------|--------|------|
| **mantis** | 后端 API + AI 机器人核心 | 本地构建 | 8118 |
| **web-ui** | Web 前端界面 | 本地构建 | 3091 |
| **onlyoffice-local** | 文档编辑服务 | 预构建镜像 | 8081 |

### 8.2 必需的环境变量 / Required Environment Variables

#### 中文
`FIRECRAWL_API_KEY` 是启动 mantis 服务的必填变量，用于网页爬虫功能。

```bash
FIRECRAWL_API_KEY=your_api_key_here docker-compose up -d
```

或在 `.env` 文件中定义（与 `docker-compose.yml` 同目录）：

```env
FIRECRAWL_API_KEY=your_api_key_here
```

#### English
`FIRECRAWL_API_KEY` is required for the mantis service and enables web crawling functionality.

```bash
FIRECRAWL_API_KEY=your_api_key_here docker-compose up -d
```

Or define in `.env` file (same directory as `docker-compose.yml`):

```env
FIRECRAWL_API_KEY=your_api_key_here
```

### 8.3 卷挂载（持久化）/ Volume Mounts

#### mantis 后端服务卷

| 本地路径 | 容器路径 | 说明 | 类型 |
|---------|---------|------|------|
| `./config` | `/app/config` | 配置文件目录 | 绑定卷 |
| `./data` | `/app/data` | 数据存储目录 | 绑定卷 |
| `./skills` | `/app/skills` | 技能插件目录 | 绑定卷 |
| `python-venv` | `/app/python-venv` | Python 虚拟环境（命名卷） | 命名卷 |
| `~/` | `/root` | 宿主机用户主目录 | 绑定卷 |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker 套接字（容器内 Docker 操作） | 套接字 |

#### 中文
- **绑定卷**：与宿主机实时同步，开发时修改本地文件立即生效。
- **命名卷**：Docker 管理的持久化存储，`python-venv` 用于保存用户安装的 Python 包，加快容器重启。
- **Docker 套接字**：允许容器内执行 Docker 命令（如 DDNSTO 功能）。

#### English
- **Bind Volumes**: Sync with host in real-time; local changes take effect immediately during development.
- **Named Volumes**: Docker-managed persistent storage; `python-venv` preserves user-installed Python packages for faster container restart.
- **Docker Socket**: Allows running Docker commands inside containers (e.g., DDNSTO feature).

### 8.4 服务依赖与启动顺序 / Service Dependencies

#### 中文
web-ui 依赖 mantis 启动：

```yaml
depends_on:
  - mantis
```

启动顺序：mantis → web-ui → onlyoffice-local（独立）

#### English
web-ui depends on mantis:

```yaml
depends_on:
  - mantis
```

Startup order: mantis → web-ui → onlyoffice-local (independent)

### 8.5 环境变量详解 / Environment Variables

#### mantis 后端

```yaml
environment:
  - NODE_ENV=production          # 运行环境
  - CONFIG_PATH=/app/config/config.json  # 配置文件路径
  - FIRECRAWL_API_KEY=${FIRECRAWL_API_KEY}  # 必填：网页爬虫 API 密钥
```

#### web-ui 前端

```yaml
environment:
  - VITE_API_URL=http://localhost:8118  # 后端 API 地址
```

#### 中文
- `VITE_API_URL` 需与 mantis 服务的实际访问地址一致，否则前端无法调用后端 API。
- 若在不同网络环境运行，需调整为实际的后端服务 IP 或域名。

#### English
- `VITE_API_URL` must match the actual backend service address, otherwise the frontend cannot call backend APIs.
- Adjust to your backend's IP or domain if running in different network environments.

### 8.6 网络配置 / Network Configuration

#### 中文
Docker Compose 会自动创建默认网络（通常为 `<项目目录名>_default`，例如 `mantisbot_default`），服务间可通过服务名进行 DNS 解析：

- 前端访问后端：`http://mantis:8118`（容器内）
- 宿主机访问：`http://localhost:8118`、`http://localhost:3091`、`http://localhost:8081`

#### English
Docker Compose automatically creates a default network (usually `<project-directory>_default`, e.g. `mantisbot_default`) for service discovery:

- Frontend → Backend: `http://mantis:8118` (within containers)
- From host: `http://localhost:8118`, `http://localhost:3091`, `http://localhost:8081`

### 8.7 重启策略与健康检查 / Restart Policy & Health Check

#### 中文
所有服务配置 `restart: unless-stopped`：

- 容器异常退出时自动重启。
- 手动停止（`docker-compose stop` / `make stop`）后不再启动。

仅 onlyoffice-local 配置健康检查：

```yaml
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://localhost/"]
  interval: 30s
  timeout: 10s
  retries: 3
```

#### English
All services have `restart: unless-stopped`:

- Auto-restart on failure.
- Won't restart after manual stop (`docker-compose stop` / `make stop`).

Only onlyoffice-local has a health check:

```yaml
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://localhost/"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### 8.8 常见配置修改 / Common Configuration Changes

#### 中文

**修改 mantis 服务端口**

修改 `docker-compose.yml` 中 mantis 服务的 `ports` 字段：

```yaml
ports:
  - "9999:8118"  # 从 8118 改为 9999
```

**修改 Web UI 端口**

修改 web-ui 服务的 `ports` 字段：

```yaml
ports:
  - "3000:80"  # 从 3091 改为 3000
```

**添加新的环境变量**

在 mantis 的 `environment` 部分添加：

```yaml
environment:
  - NEW_VAR=value
```

#### English

**Change mantis service port**

Edit `ports` under the mantis service in `docker-compose.yml`:

```yaml
ports:
  - "9999:8118"  # Change from 8118 to 9999
```

**Change Web UI port**

Edit `ports` under the web-ui service:

```yaml
ports:
  - "3000:80"  # Change from 3091 to 3000
```

**Add a new environment variable**

Add to the mantis `environment` section:

```yaml
environment:
  - NEW_VAR=value
```

### 8.9 与 Makefile 集成 / Integration with Makefile

| Makefile 命令 | 执行内容 | docker-compose 关联 |
|-------------|--------|----------------|
| `make run` | `docker-compose up -d` | 启动所有服务（后台） |
| `make stop` | `docker-compose down` | 停止并移除容器 |
| `make logs` | `docker-compose logs -f` | 实时查看所有服务日志 |

> 注意 / Note: `docker-compose.yml` 中 Web UI 端口映射为 `3091:80`，而 `make run` 的提示文案当前显示 `3081`，如有需要可同步修正 Makefile 文案。

---

## 9. 本地运行与排查 / Local Run & Troubleshooting

### 启动服务 / Start services

```bash
make run
```

### 停止服务 / Stop services

```bash
make stop
```

### 查看日志 / View logs

```bash
make logs
```

### 查看构建信息 / Show build info

```bash
make info
```

### 清理本地镜像 / Clean local images

```bash
make clean
```

---

## 10. 推荐发布流程 / Recommended Release Flow

### 中文
1. `make info` 检查当前构建参数。  
2. `make login` 登录仓库（如尚未登录）。  
3. 选择发布级别：`make release` / `make release-minor` / `make release-major`。  
4. 发布完成后，用 `make info` 或镜像仓库页面确认标签。

### English
1. Run `make info` to verify current build settings.  
2. Run `make login` if not logged in.  
3. Choose release level: `make release` / `make release-minor` / `make release-major`.  
4. Verify tags via `make info` or your registry UI.

---

## 11. 常见问题 / FAQ

### Q1: 如何临时指定版本发布？/ How to release with a custom version?
```bash
make buildx VERSION=1.2.3
```
- 中文：直接覆盖 `VERSION` 变量即可。  
- English: Override `VERSION` inline.

### Q2: 如何指定私有仓库地址？/ How to use a private registry?
```bash
make buildx REGISTRY=registry.example.com IMAGE_PREFIX=myteam
```
- 中文：同时设置 `REGISTRY` 与 `IMAGE_PREFIX`。  
- English: Set both `REGISTRY` and `IMAGE_PREFIX`.

### Q3: 想只构建 ARM64 怎么做？/ Build only ARM64?
```bash
make buildx PLATFORMS=linux/arm64
```
- 中文：覆盖 `PLATFORMS` 即可。  
- English: Override `PLATFORMS`.
