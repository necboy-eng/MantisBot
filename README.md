# MantisBot

<img src="assets/logo.png" alt="MantisBot Logo" width="200">

<!-- GitHub 显示 -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/necboy/MantisBot/main/assets/logo.svg">
  <img src="https://raw.githubusercontent.com/necboy/MantisBot/main/assets/logo.svg" alt="MantisBot Logo" width="200">
</picture>

**An AI Agent platform for personal and work use, optimized and built based on the OpenClaw framework and concepts**

Supports multiple communication channels and LLM models, with 40+ built-in practical skills (including PDF + Office suite integration), OnlyOffice integration for online Office file editing, and the ability to use your personal computer as a remote storage NAS to build personal and work AI knowledge bases

---

**一个基于OpenClaw框架和思路优化并构建的个人+工作 AI Agent 平台**

支持多种通信渠道和 LLM 模型，内置 40+ 实用技能（包括集成PDF+Office三件套技能），集成 OnlyOffice 实现在线 Office 文件编辑，同时可以将安装的个人电脑作为远程存储 NAS 进行使用，构建个人及工作的 AI 知识库

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.22.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

[English](#english) | [中文文档](#中文文档)

</div>

---

## English

### 🎯 Introduction

MantisBot is a **modular AI Agent platform** for individual users, developers, and enterprises. Unlike OpenClaw and other consumer-focused products, MantisBot focuses on:

- **Enterprise Architecture** - Highly modular design, easy to extend and customize
- **Convenient Configuration** - Highly configurable frontend interface
- **Unified Multi-Model Management** - Supports OpenAI, Claude, Qwen, MiniMax, GLM, and more, better suited for China's domestic ecosystem
- **Skill Ecosystem** - 40+ built-in skills, ready to use
- **Smart Memory System** - Hybrid retrieval (vector + full-text), better understanding

### ✨ Features

- **🔌 Channel-First Architecture** - Unified IChannel interface supporting Web UI, Feishu, DingTalk, Slack, and more (Overseas IM tools not yet tested, use with caution)
- **🤖 Multi-Model Support** - OpenAI, Claude, Qwen, MiniMax, GLM, etc.
- **🛠️ 40+ Built-in Skills** - Document processing, office automation, deep research, etc.
- **🧠 Smart Memory System** - Hybrid search with vector + full-text retrieval
- **⏰ Scheduled Tasks** - Cron, interval, and one-time scheduling
- **📦 Plugin System** - Dynamic plugin loading with MCP protocol support
- **🛡️ Reliability** - Circuit breaker, retry management, global error handling
- **🌐 Tunnel Services and Domain Forwarding** - DDNS.to, Cloudflare Tunnel, FRP support

### 📸 System Preview

**System Interface**
![System Interface](assets/screenshot1.png)

**Skill Packages**
![Skill Marketplace](assets/screenshot2.png)

**Feishu & IM Integration**
![Feishu & IM Integration](assets/screenshot3.png)

### 💡 Typical Use Cases

MantisBot's 40+ skills cover various aspects of work and life:

#### 📄 Document Processing & Office Automation

| Scenario                                              | Skill                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Read/analyze PDF, extract text/tables                 | `pdf` - Read, OCR, extract, merge                                                                |
| Create research report PPT, market analysis           | `pptx` + `deep-research` - Deep research + PPT                                                 |
| Create product demos, company profiles                | `pptx` + `docx` - Doc organization + PPT                                                       |
| Create data analysis reports, charts                  | `xlsx` + `pptx` - Excel analysis + PPT charts                                                  |
| Handle Word documents, contracts                      | `docx` - Word document operations                                                                |
| Excel data processing, statistics                     | `xlsx` - Excel operations & data processing                                                      |
| Write internal communications, weekly/monthly reports | `internal-comms` - Internal communications                                                       |
| Batch process multiple PDFs                           | `pdf` - Batch merge, split, extract                                                              |
| Convert PDF to editable documents                     | `pdf` + `docx` - OCR + Word conversion                                                         |
| **Online Edit Word/Excel/PPT**                  | **OnlyOffice Integration** - Edit Office files directly in browser, multi-user collaboration |

#### 🧠 Research & Analysis

| Scenario                                | Skill                                         |
| --------------------------------------- | --------------------------------------------- |
| Deep industry research with 10+ sources | `deep-research` - Enterprise-grade research |
| Brainstorming & ideation                | `brainstorming` - Creative brainstorming    |
| Brand guidelines creation               | `brand-guidelines` - Brand guide creation   |

#### 💻 Development & Tech Work

| Scenario                     | Skill                                             |
| ---------------------------- | ------------------------------------------------- |
| Frontend development         | `frontend-design` - High-quality UI development |
| Web app testing              | `webapp-testing` - Automated testing            |
| GitHub repository management | `github` - GitHub operations                    |
| Build Claude Code automation | `coding-agent` - Coding Agent development       |

#### 🎨 Creative & Design

| Scenario                              | Skill                                     |
| ------------------------------------- | ----------------------------------------- |
| Create beautiful web pages/components | `web-artifacts-builder` - Web Artifacts |
| Generate algorithmic art              | `algorithmic-art` - Algorithmic art     |
| Image/poster design                   | `canvas-design` - Canvas design         |
| Brand visual design                   | `theme-factory` - Theme factory         |

#### 📱 Apple Ecosystem Integration

| Scenario                | Skill                                   |
| ----------------------- | --------------------------------------- |
| Manage Apple Notes      | `apple-notes` - Notes management      |
| Sync Apple Reminders    | `apple-reminders` - Reminders         |
| Manage Things Mac tasks | `things-mac` - Things task management |
| Send iMessage           | `imsg` - iMessage sending             |

#### 🔧 Tools & Productivity

| Scenario                 | Skill                                          |
| ------------------------ | ---------------------------------------------- |
| Speech-to-text (offline) | `openai-whisper` - Local Whisper             |
| Speech-to-text (API)     | `openai-whisper-api` - API transcription     |
| AI image generation      | `openai-image-gen` - DALL-E image generation |
| GIF search               | `gifgrep` - GIF search tool                  |
| Weather query            | `weather` - Weather information              |

#### 🔌 Extensions & Integration

| Scenario                 | Skill                                            |
| ------------------------ | ------------------------------------------------ |
| Build custom MCP servers | `mcp-builder` - MCP server development         |
| Install/publish skills   | `skill-creator` / `clawhub` - Skill creation |
| Send emails              | `email` / `feishu-mail` - Email management   |

### 📊 Comparison with OpenClaw

| Feature                | MantisBot                                        | OpenClaw                         |
| ---------------------- | ------------------------------------------------ | -------------------------------- |
| **Target Users** | Individual, Developers, Enterprise Users         | Individual Consumers             |
| **Architecture** | Modular IChannel Interface                       | Gateway Control Plane            |
| **Channels**     | Web UI, Feishu, DingTalk, Slack, etc.            | WhatsApp, Telegram, Discord 12+  |
| **Models**       | Multi-model unified (OpenAI, Claude, Qwen, etc.) | Anthropic/OpenAI focused         |
| **Skills**       | 40+ built-in + MCP                               | Bundled/Managed/Workspace Skills |
| **Memory**       | Vector + Full-text Hybrid                        | Session-based                    |
| **Security**     | Circuit breaker, retry, error handling           | DM pairing, security defaults    |

#### MantisBot Key Advantages

1. **Flexible Modular Design** - IChannel interface for easy channel integration
2. **China Models First** - Native support for Qwen, MiniMax, GLM
3. **Enterprise Reliability** - Circuit breaker, retry, global error handling
4. **Ready-to-use Skills** - 40+ skills for docs, office automation, research
5. **Hybrid Memory** - Vector + full-text search, better understanding

### 🚀 Quick Start

#### Prerequisites

| Dependency | Minimum          | Notes                                          |
| ---------- | ---------------- | ---------------------------------------------- |
| Node.js    | **22.22+** | 22.x LTS recommended                                        |
| npm        | 8+               | Bundled with Node.js                           |
| git        | any              | Required for cloning                           |
| Python     | 3.9+ (optional)  | Required for `crawl4ai` web scraping tool      |

> **Python is optional**. It's only needed if you want to use the `crawl4ai` skill for high-quality web scraping with JavaScript rendering. Docker deployments include Python pre-installed.
>
> **Install Python:**
>
> - **macOS**: `brew install python3 && pip3 install crawl4ai`
> - **Linux**: `sudo apt install python3 python3-pip && pip3 install crawl4ai`
> - **Windows**: Install from [python.org](https://python.org), then run `pip install crawl4ai`

#### ⚡ Intelligent Installer (Recommended)

The install scripts handle everything automatically: prerequisite checks, cloning, dependency installation, config setup, build, and launch.

**macOS / Linux**

```bash
# One-liner (downloads and runs automatically)
curl -fsSL https://raw.githubusercontent.com/necboy/MantisBot/main/install.sh | bash

# Or run locally after cloning
chmod +x install.sh && ./install.sh
```

**Windows** (PowerShell)

```powershell
# One-liner (downloads and runs automatically)
irm https://raw.githubusercontent.com/necboy/MantisBot/main/install.ps1 | iex

# Or run locally after cloning
.\install.ps1

# With options (local only — parameters cannot be passed via the one-liner)
.\install.ps1 -Mirror              # Use npmmirror CDN (faster in China)
.\install.ps1 -SkipBuild           # Skip build step
.\install.ps1 -InstallDir "D:\MantisBot"  # Custom install directory
```

> **Windows execution policy:** The one-liner (`irm | iex`) bypasses execution policy by design. For local execution, if PowerShell blocks the script, the installer will fix this automatically. If it can't, run once manually:
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

Both scripts will prompt you to choose a start mode at the end: **dev mode** (hot-reload), **prod mode** (compiled), or **manual** (start later yourself).

---

#### Manual Installation

If you prefer to set up manually:

```bash
# Clone the repository
git clone https://github.com/necboy/MantisBot.git
cd MantisBot

# Install all dependencies (frontend included via postinstall)
npm install
```

> **Dependency conflict notice**
>
> This project uses `zod@^4.x` (required by `@anthropic-ai/claude-agent-sdk`), while `openai@4.x/5.x` declares an optional peer dependency on `zod@^3.x`. npm v7+ treats this as an error by default.
>
> A `.npmrc` file with `legacy-peer-deps=true` is already included in the repository, so this is handled automatically. If you still see an `ERESOLVE` error, run:
>
> ```bash
> npm install --legacy-peer-deps
> ```

> **Windows native module note**
>
> `wechaty` (WeChat channel) and `whatsapp-web.js` contain native C++ modules that require Visual Studio Build Tools to compile. They are declared as `optionalDependencies`, so `npm install` succeeds even if the build fails — these channels simply won't be available until the tools are installed. To enable them, install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

```bash
# Copy example config
cp config/config.example.json config/config.json
```

Open `config/config.json` and fill in at least one model's API key:

```json
{
  "models": [
    {
      "name": "MyModel",
      "protocol": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-..."
    }
  ],
  "defaultModel": "MyModel"
}
```

> If `config/config.json` does not exist on first start, the backend will auto-generate one with default values.

#### Start Development (both frontend + backend)

```bash
npm run dev
```

Both backend and frontend logs appear in the same terminal with colored prefixes:

```
[后端] [MantisBot] Starting...
[后端] [HTTPWSChannel] Started on port 8118
[前端] VITE v5.x.x  ready in xxx ms
[前端] ➜  Local:   http://localhost:3000/
```

Visit **http://localhost:3000** to access the Web UI.

#### Production Start

```bash
npm run start
```

This compiles the TypeScript backend and Vite frontend, then runs both in production mode.

#### Available npm Scripts

| Command                   | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `npm run dev`           | Start both backend + frontend (watch mode, merged logs) |
| `npm run dev:backend`   | Start backend only (watch mode)                         |
| `npm run build`         | Compile backend TypeScript →`dist/`                  |
| `npm run build:ui`      | Build frontend →`web-ui/dist/`                       |
| `npm run build:all`     | Compile backend + build frontend                        |
| `npm run start`         | Build everything then run in production mode            |
| `npm run test`          | Run unit tests (watch mode)                             |
| `npm run test:run`      | Run unit tests (single pass)                            |
| `npm run test:coverage` | Run tests with coverage report                          |

> **Port reference:** Backend API runs on `:8118`, Vite dev server on `:3000`. The dev server proxies `/api`, `/ws`, `/health`, and `/office-preview` to the backend.

### 🏗️ Project Structure

```
MantisBot/
├── config/
│   ├── config.json          # Runtime config (not committed to git)
│   └── config.example.json  # Config template
├── scripts/
│   └── kill-port.cjs        # Helper to free port before dev start
├── skills/                  # Skills directory (40+)
├── plugins/                 # Plugins directory
├── data/                    # Runtime data (SQLite, sessions, files — not committed)
├── src/
│   ├── entry.ts             # Backend entry point
│   ├── config/              # Config loading and Schema validation
│   ├── channels/            # Channel implementations (http-ws, feishu, dingtalk…)
│   ├── agents/              # Agent core (LLM calls, tools, Skills)
│   ├── session/             # Session management
│   ├── memory/              # Memory and vector retrieval
│   ├── storage/             # File storage (local/NAS)
│   ├── cron/                # Cron task scheduler
│   ├── tunnel/              # Tunnel services
│   ├── plugins/             # Plugin loader
│   └── reliability/         # Error handling, circuit breaker, retry
├── web-ui/                  # React frontend
│   ├── src/
│   └── vite.config.ts       # Vite config (includes backend proxy)
├── dist/                    # Compiled output (auto-generated, not committed)
├── package.json
└── tsconfig.json
```

### 🛠️ Tech Stack

**Backend:**

- TypeScript + Node.js 22
- Express + WebSocket (ws)
- SQLite (Node.js built-in) + sqlite-vec (vector extension)
- Zod (configuration validation)

**Frontend:**

- React 18 + TypeScript
- Vite + TailwindCSS
- React Query + React Router
- i18next (internationalization)

### 📦 Docker Deployment

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f
```

- Build & Release Guide (Make + Docker Compose): [BUILD_AND_RELEASE_GUIDE.md](./BUILD_AND_RELEASE_GUIDE.md)

### 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, fork the repository, and create pull requests.

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 中文文档

### 🎯 项目简介

MantisBot 是一个面向开发者和企业的**模块化 AI Agent 平台**。与 OpenClaw 等面向个人消费者的产品不同，MantisBot 更专注于：

- **企业级架构** - 高度模块化的设计，易于扩展和定制
- 便捷配置及安装 - 前端界面高度可配置
- **多模型统一管理** - 支持 OpenAI、Claude、通义千问、MiniMax、GLM 等多种 LLM，更适合中国国内生态
- **技能生态系统** - 40+ 内置技能，开箱即用
- **智能记忆系统** - 混合检索（向量 + 全文），理解力更强

### ✨ 特性

- **🔌 频道优先架构** - 统一的 IChannel 接口，支持 Web UI、飞书、钉钉、Slack 等多渠道 （海外渠道的IM工具尚未测试验证，请谨慎使用）
- **🤖 多模型支持** - OpenAI、Claude、通义千问、MiniMax、GLM 等
- **🛠️ 40+ 内置技能** - 文档处理、办公自动化、深度研究等
- **🧠 智能记忆系统** - 向量搜索 + 全文搜索的混合检索
- **⏰ 定时任务** - 支持 cron、interval、one-time 调度
- **📦 插件系统** - 动态加载插件，MCP 协议支持
- **🛡️ 可靠性保障** - 熔断器、重试管理、全局错误处理
- **🌐 内网穿透及域名转发** - 支持 DDNS.to、Cloudflare Tunnel、FRP

### 📸 系统预览

** 系统界面
![系统界面](assets/screenshot1.png)

** 技能包

![技能市场](assets/screenshot2.png)

**飞书等IM集成

![飞书等IM集成](assets/screenshot3.png)

### 💡 典型使用场景

MantisBot 的 40+ 技能可以覆盖工作和生活的方方面面，以下是一些典型场景：

#### 📄 文档处理与办公自动化

| 场景                               | 使用技能                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| 阅读/分析 PDF 文档，提取文本和表格 | `pdf` - PDF 读取、OCR、提取、合并                                |
| 制作调研报告 PPT、市场分析演示     | `pptx` + `deep-research` - 深度研究 + PPT 制作                 |
| 制作产品介绍、公司简介演示         | `pptx` + `docx` - 文档整理 + PPT 制作                          |
| 制作数据分析报告、图表展示         | `xlsx` + `pptx` - Excel 分析 + PPT 图表                        |
| 处理 Word 文档、合同协议           | `docx` - Word 文档操作                                           |
| 处理 Excel 表格、数据统计          | `xlsx` - Excel 操作与数据处理                                    |
| 撰写公司内部通讯、周报月报         | `internal-comms` - 内部通讯撰写                                  |
| 批量处理多个 PDF 文档              | `pdf` - 批量合并、拆分、提取                                     |
| 将 PDF 转为可编辑文档              | `pdf` + `docx` - OCR 识别 + Word 转换                          |
| **在线编辑 Word/Excel/PPT**  | **OnlyOffice 集成** - 浏览器内直接编辑 Office 文件，多人协作 |

#### 🧠 智能研究与分析

| 场景                           | 使用技能                               |
| ------------------------------ | -------------------------------------- |
| 深度行业研究，10+ 来源综合分析 | `deep-research` - 企业级深度研究     |
| 头脑风暴，创意激发             | `brainstorming` - 创意激发与头脑风暴 |
| 品牌设计指南制定               | `brand-guidelines` - 品牌指南创建    |

#### 💻 开发与技术工作

| 场景                    | 使用技能                                 |
| ----------------------- | ---------------------------------------- |
| 前端界面开发            | `frontend-design` - 高质量前端界面开发 |
| Web 应用测试            | `webapp-testing` - 自动化测试          |
| GitHub 仓库管理         | `github` - GitHub 操作                 |
| 构建 Claude Code 自动化 | `coding-agent` - Coding Agent 开发     |

#### 🎨 创意与设计

| 场景              | 使用技能                                       |
| ----------------- | ---------------------------------------------- |
| 创建精美网页/组件 | `web-artifacts-builder` - Web Artifacts 构建 |
| 生成算法艺术      | `algorithmic-art` - 算法艺术生成             |
| 图片/海报设计     | `canvas-design` - Canvas 设计                |
| 品牌视觉设计      | `theme-factory` - 主题工厂                   |

#### 📱 Apple 生态集成

| 场景                      | 使用技能                         |
| ------------------------- | -------------------------------- |
| 管理 Apple Notes 笔记     | `apple-notes` - 笔记管理       |
| 同步 Apple Reminders 提醒 | `apple-reminders` - 提醒事项   |
| 管理 Things Mac 任务      | `things-mac` - Things 任务管理 |
| 发送 iMessage 消息        | `imsg` - iMessage 发送         |

#### 🔧 工具与效率

| 场景               | 使用技能                               |
| ------------------ | -------------------------------------- |
| 语音转文字（离线） | `openai-whisper` - 本地 Whisper 转录 |
| 语音转文字（API）  | `openai-whisper-api` - API 转录      |
| AI 图片生成        | `openai-image-gen` - DALL-E 图片生成 |
| GIF 搜索           | `gifgrep` - GIF 搜索工具             |
| 天气查询           | `weather` - 天气信息                 |

#### 🔌 扩展与集成

| 场景                  | 使用技能                                         |
| --------------------- | ------------------------------------------------ |
| 构建自定义 MCP 服务器 | `mcp-builder` - MCP 服务器开发                 |
| 安装/发布技能         | `skill-creator` / `clawhub` - 技能创建与发布 |
| 发送邮件              | `email` / `feishu-mail` - 邮件管理           |

### 📊 与 OpenClaw 对比

| 特性               | MantisBot                                | OpenClaw                                |
| ------------------ | ---------------------------------------- | --------------------------------------- |
| **目标用户** | 个人、开发者、企业用户                   | 个人消费者                              |
| **架构设计** | 模块化 IChannel 接口                     | Gateway 控制平面                        |
| **渠道支持** | 暂支持Web UI、飞书、钉钉、Slack等        | WhatsApp、Telegram、Discord 等 12+ 渠道 |
| **模型支持** | 多模型统一管理（OpenAI、Claude、千问等） | Anthropic/OpenAI 为首                   |
| **技能系统** | 40+ 内置技能 + MCP 支持                  | Bundled/Managed/Workspace Skills        |
| **记忆系统** | 向量 + 全文混合检索                      | Session-based                           |
| **安全策略** | 熔断器 + 重试 + 全局错误处理             | DM pairing + 安全默认                   |

#### MantisBot 的核心优势

1. **更灵活的模块化设计** - IChannel 接口便于快速接入新渠道
2. **国产模型优先** - 原生支持通义千问、MiniMax、GLM 等国产大模型
3. **企业级可靠性** - 内置熔断器、重试机制、错误处理
4. **技能开箱即用** - 40+ 技能覆盖文档处理、办公自动化、深度研究等场景
5. **混合记忆检索** - 向量搜索 + 全文搜索，理解力更强

### 🚀 快速开始

#### 前置要求

| 依赖    | 最低版本         | 说明                                   |
| ------- | ---------------- | -------------------------------------- |
| Node.js | **22.22+** | 推荐 22.x LTS                                    |
| npm     | 8+               | 随 Node.js 附带                        |
| git     | 任意版本         | 克隆仓库必须                           |
| Python  | 3.9+ (可选)      | 用于 `crawl4ai` 网页爬取工具           |

> **Python 为可选依赖**。仅在使用 `crawl4ai` 技能进行高质量网页爬取（支持 JavaScript 渲染）时需要。Docker 部署已预装 Python。若需本地使用，请按以下方式安装：
>
> - **macOS**: `brew install python3 && pip3 install crawl4ai`
> - **Linux**: `sudo apt install python3 python3-pip && pip3 install crawl4ai`
> - **Windows**: 从 [python.org](https://python.org) 下载安装，然后运行 `pip install crawl4ai`

> **Windows 用户**：推荐使用 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理 Node.js 版本。

#### ⚡ 智能安装脚本（推荐）

安装脚本自动完成全流程：环境检查 → 克隆仓库 → 安装依赖 → 初始化配置 → 编译 → 启动。

**macOS / Linux**

```bash
# 一键安装（自动下载并执行）
curl -fsSL https://raw.githubusercontent.com/necboy/MantisBot/main/install.sh | bash

# 或克隆后在项目目录内执行
chmod +x install.sh && ./install.sh
```

**Windows**（PowerShell）

```powershell
# 一键安装（自动下载并执行）
irm https://raw.githubusercontent.com/necboy/MantisBot/main/install.ps1 | iex

# 或克隆后在项目目录内执行
.\install.ps1

# 可选参数（仅本地执行有效，一键命令不支持传参）
.\install.ps1 -Mirror              # 使用 npmmirror 国内镜像加速下载
.\install.ps1 -SkipBuild           # 跳过编译步骤
.\install.ps1 -InstallDir "D:\MantisBot"  # 自定义安装目录
```

> **Windows 执行策略**：一键命令（`irm | iex`）本身不受执行策略限制。本地执行时若 PowerShell 提示策略受限，安装脚本会尝试自动修复。若无法自动修复，手动运行一次：
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

两个脚本在最后都会提示选择启动模式：**开发模式**（热重载）、**生产模式**（已编译）或**手动启动**（稍后自行启动）。

---

#### 手动安装

如果你更倾向于手动配置：

```bash
# 克隆仓库
git clone https://github.com/necboy/MantisBot.git
cd MantisBot

# 一键安装全部依赖（postinstall 自动安装前端依赖）
npm install
```

> **依赖冲突说明**
>
> 本项目使用 `zod@^4.x`，而 `openai@4.x/5.x` 声明了对 `zod@^3.x` 的可选对等依赖，npm v7+ 默认视为错误。
> 仓库中已包含 `.npmrc`（`legacy-peer-deps=true`），安装时会自动处理。如仍出现 `ERESOLVE` 错误，请执行：
>
> ```bash
> npm install --legacy-peer-deps
> ```

> **Windows 原生模块说明**
>
> `wechaty`（微信渠道）和 `whatsapp-web.js` 包含需要 C++ 编译的原生模块。它们已被声明为 `optionalDependencies`，因此即使编译失败，`npm install` 也会正常完成——只是对应渠道暂时不可用。如需启用，请安装 [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)。

#### 配置

```bash
# 复制示例配置
cp config/config.example.json config/config.json
```

打开 `config/config.json`，至少填写一个模型的 API Key：

```json
{
  "models": [
    {
      "name": "MyModel",
      "protocol": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-..."
    }
  ],
  "defaultModel": "MyModel"
}
```

> 首次启动时若 `config/config.json` 不存在，后端会自动生成包含默认值的配置文件。

#### 启动开发环境（前后端同时启动）

```bash
npm run dev
```

前后端日志以彩色前缀合并输出到同一个终端：

```
[后端] [MantisBot] Starting...
[后端] [HTTPWSChannel] Started on port 8118
[前端] VITE v5.x.x  ready in xxx ms
[前端] ➜  Local:   http://localhost:3000/
```

浏览器访问 **http://localhost:3000** 即可进入管理界面。

#### 生产模式启动

```bash
npm run start
```

自动编译前后端，然后以生产模式运行。

#### NPM 脚本一览

| 命令                      | 说明                                             |
| ------------------------- | ------------------------------------------------ |
| `npm run dev`           | **同时启动前后端**（热重载，日志合并输出） |
| `npm run dev:backend`   | 仅启动后端（热重载）                             |
| `npm run build`         | 编译后端 TypeScript →`dist/`                  |
| `npm run build:ui`      | 编译前端 →`web-ui/dist/`                      |
| `npm run build:all`     | 编译前后端                                       |
| `npm run start`         | 编译全部后以**生产模式**启动前后端         |
| `npm run test`          | 运行单元测试（监听模式）                         |
| `npm run test:run`      | 运行单元测试（单次）                             |
| `npm run test:coverage` | 运行测试并生成覆盖率报告                         |

> **端口说明**：后端 API 运行在 `:8118`，Vite 开发服务器运行在 `:3000`，开发模式下 `/api`、`/ws`、`/health`、`/office-preview` 请求会自动代理到后端。

#### 常见问题

**启动时报 `EADDRINUSE: address already in use :::8118`**

端口被上次未正常退出的进程占用。`npm run dev` 通过 `predev` 脚本会自动处理，若手动启动遇到此问题，执行：

```bash
node scripts/kill-port.cjs 8118
```

**启动时出现 `sqlite-vec extension loading failed` 警告**

这是正常现象，系统已自动切换到纯 JS 实现，不影响功能使用。若需原生向量性能，可安装对应平台包：

```bash
# Windows x64
npm install sqlite-vec-windows-x64

# macOS Apple Silicon
npm install sqlite-vec-darwin-arm64

# macOS x64
npm install sqlite-vec-darwin-x64

# Linux x64
npm install sqlite-vec-linux-x64

# Linux ARM64
npm install sqlite-vec-linux-arm64
```

> **注意**：Windows ARM64（如 Surface Pro X、Snapdragon 系列）暂无原生扩展包，系统会自动使用 JS fallback，无需额外操作。

**如何修改默认登录密码**

在 Web UI 的「设置 → 系统设置 → 访问控制」中在线修改，或直接在 `config/config.json` 中更新：

```bash
node -e "const c=require('crypto');console.log('sha256:'+c.createHash('sha256').update('新密码').digest('hex'))"
```

将输出的哈希值填入 `server.auth.password` 字段。

### 🏗️ 项目结构

```
MantisBot/
├── config/
│   ├── config.json          # 运行时配置（不提交到 git）
│   └── config.example.json  # 配置模板
├── scripts/
│   └── kill-port.cjs        # 开发启动前释放端口的辅助脚本
├── skills/                  # Skills 技能目录（40+）
├── plugins/                 # Plugins 插件目录
├── data/                    # 运行时数据（SQLite、会话、文件，不提交到 git）
├── src/
│   ├── entry.ts             # 后端入口
│   ├── config/              # 配置加载与 Schema 验证
│   ├── channels/            # 各渠道实现（http-ws、feishu、dingtalk…）
│   ├── agents/              # Agent 核心逻辑（LLM 调用、工具、Skills）
│   ├── session/             # 会话管理
│   ├── memory/              # 记忆与向量检索
│   ├── storage/             # 文件存储（本地/NAS）
│   ├── cron/                # 定时任务调度
│   ├─��� tunnel/              # 内网穿透
│   ├── plugins/             # 插件加载器
│   └── reliability/         # 错误处理、熔断器、重试
├── web-ui/                  # React 前端
│   ├── src/
│   └── vite.config.ts       # Vite 配置（含后端代理）
├── dist/                    # 编译产物（自动生成，不提交到 git）
├── package.json
└── tsconfig.json
```

### 🛠️ 技术栈

**后端:**

- TypeScript + Node.js 22
- Express + WebSocket (ws)
- SQLite（Node.js 内置）+ sqlite-vec（向量扩展）
- Zod（配置验证）

**前端:**

- React 18 + TypeScript
- Vite + TailwindCSS
- React Query + React Router
- i18next（国际化）

### 📦 Docker 部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

- 构建与发布指南（Make + Docker Compose）：[BUILD_AND_RELEASE_GUIDE.md](./BUILD_AND_RELEASE_GUIDE.md)

### 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

---

<div align="center">

Made with ❤️ by the MantisBot Team

</div>
