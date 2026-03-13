# MantisBot Plugin 开发指南

本文档介绍如何为 MantisBot 创建自定义 Plugin。

## 目录

- [概述](#概述)
- [Plugin 目录结构](#plugin-目录结构)
- [核心组件详解](#核心组件详解)
- [创建 Plugin 步骤](#创建-plugin-步骤)
- [最佳实践](#最佳实践)
- [示例：创建一个简单的 Plugin](#示例创建一个简单的-plugin)

---

## 概述

Plugin 是扩展 MantisBot 能力的核心机制。每个 Plugin 是一个独立的目录，可以包含：

| 组件 | 说明 | 必需性 |
|------|------|--------|
| `plugin.json` | 插件清单 | **必需** |
| `skills/` | 技能（专业知识库） | 可选 |
| `commands/` | 斜杠命令 | 可选 |
| `.mcp.json` | MCP 服务器配置 | 可选 |
| 自定义工具 | 通过 `extends.tools` 注册 | 可选 |

---

## Plugin 目录结构

```
my-plugin/
├── plugin.json              # 必需：插件清单
├── .mcp.json                # 可选：MCP 服务器配置
├── README.md                # 可选：插件文档
├── commands/                # 可选：斜杠命令
│   ├── analyze.md
│   └── report.md
├── skills/                  # 可选：技能
│   ├── data-analysis/
│   │   ├── SKILL.md         # 必需：技能定义
│   │   ├── references/      # 可选：详细参考资料
│   │   │   └── patterns.md
│   │   ├── examples/        # 可选：示例文件
│   │   └── scripts/         # 可选：辅助脚本
│   └── visualization/
│       └── SKILL.md
└── src/                     # 可选：自定义工具源码
    └── index.ts
```

---

## 核心组件详解

### 1. plugin.json（必需）

插件清单文件，定义插件的基本信息和扩展配置。

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件功能的简要描述",
  "author": {
    "name": "Your Name"
  },
  "extends": {
    "tools": "src/plugins/my-plugin/index.ts"
  },
  "dependencies": {
    "channels": ["feishu"]
  }
}
```

**字段说明：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件名称，使用 kebab-case |
| `version` | string | ✅ | 语义化版本号，如 `1.0.0` |
| `description` | string | ✅ | 简要描述（建议 < 100 字符） |
| `author` | object | ❌ | 作者信息 |
| `extends.tools` | string | ❌ | 自定义工具注册入口（相对于项目根目录） |
| `dependencies.channels` | string[] | ❌ | 依赖的渠道列表，只有这些渠道启用时才会加载工具 |

### 2. Skills（技能）

技能是 Agent 可以加载的专业知识库，采用渐进式披露设计。

**目录结构：**
```
skills/
└── skill-name/
    ├── SKILL.md           # 必需：核心知识（< 3000 词）
    ├── references/        # 可选：详细参考文档
    ├── examples/          # 可选：示例文件
    └── scripts/           # 可选：辅助脚本
```

**SKILL.md 格式：**

```markdown
---
name: my-skill
description: >
  第三人称描述，包含触发短语。当用户说 "分析数据"、"数据洞察" 时使用此技能。
version: 0.1.0
---

# My Skill

你是数据分析专家...（核心知识内容）

## 关键步骤

1. 第一步...
2. 第二步...
```

**Frontmatter 字段：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 技能标识符 |
| `description` | string | ✅ | 第三人称描述，包含触发短语 |
| `version` | string | ❌ | 语义化版本号 |

**写作规范：**
- 描述使用第三人称："This skill should be used when..."
- 正文使用祈使语气："Parse the file" 而非 "You should parse"
- 核心内容控制在 3000 词以内，详细内容放 `references/`

### 3. Commands（命令）

命令是用户通过 `/plugin:command` 触发的操作指令。

**目录结构：**
```
commands/
├── analyze.md
└── report.md
```

**命令文件格式：**

```markdown
---
description: 分析数据并生成洞察报告
argument-hint: "[file-path] [options]"
---

# Analyze Command

对 @$1 执行深度分析：

1. 解析数据结构
2. 识别关键模式
3. 生成可视化建议
4. 输出洞察报告

如果用户没有指定文件，先询问要分析的数据来源。
```

**Frontmatter 字段：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `description` | string | ❌ | 简要描述（< 60 字符），显示在帮助中 |
| `argument-hint` | string | ❌ | 参数提示，用于自动补全 |
| `allowed-tools` | string/array | ❌ | 限制可用的工具 |
| `model` | string | ❌ | 模型覆盖：`sonnet`, `opus`, `haiku` |

**参数占位符：**

| 占位符 | 说明 |
|--------|------|
| `$1`, `$2`, `$3` | 位置参数 |
| `$ARGUMENTS` | 所有参数作为一个字符串 |
| `@path` | 包含文件内容 |
| `` !`cmd` `` | 执行命令并插入结果 |

**使用方式：**
```
/my-plugin:analyze data.csv --format json
```

### 4. MCP 服务器配置（.mcp.json）

定义外部 MCP 服务器的连接配置。

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    },
    "local-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    },
    "sse-server": {
      "type": "sse",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

**服务器类型：**

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `http` | HTTP 传输 | 远程 REST API |
| `sse` | Server-Sent Events | 实时数据流 |
| `stdio` | 本地进程 | 本地工具集成 |

**变量替换：**
- `${CLAUDE_PLUGIN_ROOT}` - 插件目录路径
- `${ENV_VAR}` - 环境变量

### 5. 自定义工具注册

通过 `extends.tools` 注册自定义工具函数。

**plugin.json:**
```json
{
  "name": "my-plugin",
  "extends": {
    "tools": "src/plugins/my-plugin/index.ts"
  },
  "dependencies": {
    "channels": ["feishu"]
  }
}
```

**src/plugins/my-plugin/index.ts:**
```typescript
import type { ToolRegistry } from '../../agents/tools/registry.js';
import type { PluginToolContext } from '../../plugins/types.js';

export async function register(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  // 注册自定义工具
  registry.register({
    name: 'my_custom_tool',
    description: '自定义工具描述',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数' }
      },
      required: ['input']
    },
    execute: async (params) => {
      // 工具逻辑
      return { result: `处理: ${params.input}` };
    }
  });
}
```

---

## 创建 Plugin 步骤

### 步骤 1：创建目录结构

```bash
mkdir -p plugins/my-plugin/{commands,skills/my-skill/references}
```

### 步骤 2：创建 plugin.json

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "我的第一个 MantisBot 插件",
  "author": {
    "name": "Your Name"
  }
}
```

### 步骤 3：添加技能（可选）

创建 `skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: >
  当用户需要执行特定任务时使用此技能。触发短语包括："帮我处理"、"执行操作"。
---

# My Skill

这里写核心知识内容...

## 工作流程

1. 分析输入
2. 执行处理
3. 返回结果
```

### 步骤 4：添加命令（可选）

创建 `commands/do-something.md`:

```markdown
---
description: 执行某项操作
argument-hint: "[目标] [选项]"
---

# Do Something

对 $1 执行以下操作：

1. 步骤一
2. 步骤二
3. 步骤三

返回处理结果。
```

### 步骤 5：配置 MCP 服务器（可选）

创建 `.mcp.json`:

```json
{
  "mcpServers": {
    "my-api": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    }
  }
}
```

### 步骤 6：在配置中启用

在 `config/config.json` 中添加：

```json
{
  "plugins": ["my-plugin"]
}
```

或确保没有在 `disabledPlugins` 中禁用。

---

## 最佳实践

### 1. 技能设计

- **渐进式披露**：核心知识在 `SKILL.md`，详细内容在 `references/`
- **明确的触发短语**：在 description 中使用引号标注触发短语
- **简洁正文**：控制在 3000 词以内

### 2. 命令设计

- **命令是给 Claude 的指令**，不是给用户的文档
- 使用祈使语气："Analyze the file" 而非 "You should analyze"
- 提供清晰的工作流程步骤

### 3. 命名规范

- 使用 kebab-case：`my-plugin`，`my-skill`
- 避免下划线、空格和特殊字符
- 命令名应简短且有意义

### 4. 可移植性

- 使用 `${CLAUDE_PLUGIN_ROOT}` 引用插件内部文件
- 不要硬编码绝对路径
- 敏感信息使用环境变量

### 5. 版本管理

- 从 `0.1.0` 开始
- 遵循语义化版本规范
- 重大变更更新主版本号

---

## 示例：创建一个简单的 Plugin

以下是一个完整的最小化 Plugin 示例：

### 文件结构

```
plugins/hello-world/
├── plugin.json
├── commands/
│   └── greet.md
└── skills/
    └── greeting/
        └── SKILL.md
```

### plugin.json

```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "一个简单的问候插件示例",
  "author": {
    "name": "MantisBot Team"
  }
}
```

### commands/greet.md

```markdown
---
description: 向用户发送问候
argument-hint: "[用户名]"
---

# Greet Command

向 $1 发送友好的问候。

如果用户没有提供名字，询问用户想问候谁。

问候应该：
- 友好热情
- 包含当前时间
- 提供帮助建议
```

### skills/greeting/SKILL.md

```markdown
---
name: greeting
description: >
  当用户需要问候、打招呼、欢迎时使用此技能。触发短语："问候"、"打招呼"、"欢迎"。
---

# Greeting Skill

你是一个友好的问候助手。

## 问候模板

### 正式问候
> 您好！很高兴为您服务。请问有什么可以帮您的？

### 随意问候
> 嗨！今天过得怎么样？需要帮忙吗？

### 时间相关问候
- 早上（5:00-11:59）：早上好！
- 下午（12:00-17:59）：下午好！
- 晚上（18:00-22:59）：晚上好！
- 深夜（23:00-4:59）：夜深了，还在工作吗？
```

### 使用方式

```
/hello-world:greet 张三
```

---

## 调试与验证

### 检查插件是否加载

启动 MantisBot 后，查看日志：

```
Loaded plugin: my-plugin (2 skills, 3 commands)
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 插件未加载 | 检查 `plugin.json` 格式是否正确 |
| 技能未触发 | 检查 SKILL.md 的 frontmatter 是否有效 |
| 命令不工作 | 检查命令文件扩展名是否为 `.md` |
| 工具未注册 | 检查 `extends.tools` 路径是否正确 |

---

## 参考资源

- 现有插件示例：`plugins/bio-research/`、`plugins/customer-support/`
- Claude Code Plugin 规范：参考 `plugins/cowork-plugin-management/`
- 加载器源码：`src/plugins/loader.ts`
- 类型定义：`src/plugins/types.ts`