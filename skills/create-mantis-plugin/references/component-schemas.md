# MantisBot Plugin 组件格式详解

本文档详细说明各组件类型的格式规范。

## plugin.json — 插件清单

**位置**：插件根目录

**必需字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 插件名称，kebab-case 格式 |
| `version` | string | 语义化版本号，如 `0.1.0` |
| `description` | string | 简要描述（< 100 字符） |

**可选字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | object | 作者信息 `{ name, email }` |
| `extends.tools` | string | 自定义工具注册入口路径 |
| `dependencies.channels` | string[] | 依赖的渠道列表 |

**完整示例**：

```json
{
  "name": "feishu-notifier",
  "version": "1.0.0",
  "description": "飞书消息通知插件",
  "author": {
    "name": "MantisBot Team"
  },
  "extends": {
    "tools": "src/plugins/feishu-notifier/index.ts"
  },
  "dependencies": {
    "channels": ["feishu"]
  }
}
```

---

## Skills — 技能

**目录结构**：

```
skills/
└── skill-name/
    ├── SKILL.md           # 必需：核心知识
    ├── references/        # 可选：详细参考资料
    ├── examples/          # 可选：示例文件
    └── scripts/           # 可选：辅助脚本
```

**SKILL.md 格式**：

```markdown
---
name: skill-name
description: >
  第三人称描述，包含触发短语。当用户说 "X"、"Y"、"Z" 时使用此技能。
---

# Skill Name

核心知识内容...

## 关键步骤

1. 第一步...
2. 第二步...
```

**Frontmatter 字段**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 技能标识符 |
| `description` | string | ✅ | 第三人称描述，包含触发短语 |

**写作规范**：
- 描述使用第三人称
- 正文使用祈使语气
- 核心内容 < 3000 字
- 详细内容放 `references/`

---

## Commands — 斜杠命令

**目录结构**：

```
commands/
└── command-name.md
```

**命令文件格式**：

```markdown
---
name: command-name
description: 简要描述（< 60 字符）
argument-hint: "[file-path] [options]"
---

# Command Name

执行指令内容...

对 @$1 执行分析：

1. 步骤一
2. 步骤二

如果用户没有指定参数，询问详细信息。
```

**Frontmatter 字段**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ❌ | 命令标识符（默认为文件名） |
| `description` | string | ❌ | 简要描述 |
| `argument-hint` | string | ❌ | 参数提示 |

**参数占位符**：

| 占位符 | 说明 |
|--------|------|
| `$1`, `$2`, `$3` | 位置参数 |
| `$ARGUMENTS` | 所有参数 |

**使用方式**：
```
/plugin-name:command-name arg1 arg2
```

---

## MCP 配置 — .mcp.json

**位置**：插件根目录

**服务器类型**：

| 类型 | 适用场景 |
|------|----------|
| `stdio` | 本地进程，通过命令启动 |
| `http` | HTTP 传输，REST API |
| `sse` | Server-Sent Events，实时流 |

**stdio 示例**：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
```

**http 示例**：

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

**sse 示例**：

```json
{
  "mcpServers": {
    "my-stream": {
      "type": "sse",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

---

## 自定义工具注册

**注册入口文件**：

```typescript
import type { ToolRegistry } from '../../agents/tools/registry.js';
import type { PluginToolContext } from '../../plugins/types.js';

export async function register(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  // context 包含:
  // - config: 应用配置
  // - feishuConfig: 飞书渠道配置（如果启用）
  // - logger: 日志工具

  registry.register({
    name: 'my_tool',
    description: '工具描述',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数' }
      },
      required: ['input']
    },
    execute: async (params) => {
      // 工具实现
      return { result: `处理: ${params.input}` };
    }
  });
}
```

**ToolRegistry 接口**：

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  getAll(): ToolDefinition[];
}
```

**PluginToolContext 接口**：

```typescript
interface PluginToolContext {
  config: any;                           // 应用配置
  feishuConfig?: FeishuChannelConfig;    // 飞书配置
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}
```