---
name: create-mantis-plugin
description: >
  引导用户创建 MantisBot Plugin。当用户说"创建 plugin"、"新建插件"、"开发一个插件"、
  "添加一个 plugin"、"帮我写一个 plugin"、"我想做一个插件"时使用此技能。
---

# Create MantisBot Plugin

通过交互式对话引导用户创建 MantisBot Plugin。

## 概述

Plugin 是扩展 MantisBot 能力的核心机制。本技能通过五阶段流程引导创建：

1. **发现** — 理解用户想构建什么
2. **组件规划** — 确定需要哪些组件类型
3. **设计** — 详细定义每个组件
4. **实现** — 创建所有文件
5. **验证** — 确认 plugin 可正常加载

> **非技术输出**：保持用户对话使用通俗语言。不要暴露文件路径、目录结构等技术细节，除非用户主动询问。一切围绕 plugin 能做什么来描述。

## MantisBot Plugin 结构

每个 Plugin 是一个独立的目录：

```
my-plugin/
├── plugin.json              # 必需：插件清单
├── .mcp.json                # 可选：MCP 服务器配置
├── commands/                # 可选：斜杠命令
│   └── do-something.md
├── skills/                  # 可选：技能
│   └── my-skill/
│       ├── SKILL.md         # 必需：技能定义
│       └── references/      # 可选：详细参考资料
└── src/                     # 可选：自定义工具源码
    └── index.ts
```

**关键规则：**
- `plugin.json` 是唯一必需的文件
- 使用 kebab-case 命名（小写字母 + 连字符）
- 只创建实际需要的组件目录

## 引导流程

### 阶段 1：发现

**目标**：理解用户想构建什么以及为什么。

使用 AskUserQuestion 询问（如果用户的初始请求已经回答了某些问题，跳过）：

- 这个 plugin 应该做什么？解决什么问题？
- 谁会使用它？在什么场景下？
- 需要集成外部工具或服务吗？
- 有没有类似的现有 plugin 可以参考？

**输出**：清晰的 plugin 目的和范围描述。

### 阶段 2：组件规划

**目标**：确定需要哪些组件类型。

根据发现结果，判断需要的组件：

| 组件 | 决策依据 |
|------|----------|
| **Skills** | 需要专业知识库按需加载？Agent 需要特定领域知识？ |
| **Commands** | 有用户主动触发的操作？（如 /analyze、/report） |
| **MCP** | 需要外部服务集成？（数据库、API、SaaS 工具） |
| **自定义工具** | 需要注册新的工具函数？需要与特定渠道交互？ |
| **渠道依赖** | 只在特定渠道下工作？（如飞书、钉钉） |

呈现组件规划表，包含你决定不创建的组件（标记为 0）：

```
| 组件 | 数量 | 用途 |
|------|------|------|
| Skills | 1 | 领域知识 |
| Commands | 2 | /do-thing, /check-thing |
| MCP | 0 | 不需要 |
| 自定义工具 | 1 | 与飞书 API 交互 |
| 渠道依赖 | 1 | feishu |
```

等待用户确认或调整后继续。

### 阶段 3：设计

**目标**：详细定义每个组件。在实现前解决所有歧义。

针对规划中的每种组件类型，逐一提问设计细节：

#### Skills 设计问题

- 用户说什么短语应该触发这个技能？
- 涵盖哪些知识领域？
- 是否需要参考资料文件？（详细内容放 references/）
- 核心知识大概多少字？（建议 < 3000 字）

#### Commands 设计问题

- 命令名称是什么？（如 /analyze、/report）
- 简要描述命令做什么？
- 接受什么参数？（如 `[file-path] [options]`）
- 是交互式还是自动化执行？

#### MCP 设计问题

- 服务器类型：stdio（本地）、http（REST API）、sse（实时流）？
- 认证方式：API Key、OAuth、无？
- 需要什么环境变量？

#### 自定义工具设计问题

- 工具名称和功能描述？
- 输入参数结构？
- 需要哪些渠道配置？（如 feishuConfig）
- 依赖哪些其他工具？

#### 渠道依赖确认

- plugin 是否只在特定渠道启用时才工作？
- 需要在 plugin.json 中声明哪些渠道依赖？

**输出**：每个组件的详细规格说明。

### 阶段 4：实现

**目标**：创建所有 plugin 文件。

**实现顺序：**

1. 创建 plugin 目录
2. 创建 `plugin.json` 清单
3. 创建各组件文件
4. 创建 `README.md`（可选）

**实现指南：**

- **Commands 是给 Claude 的指令**，不是给用户的文档
- 使用祈使语气："Analyze the file" 而非 "You should analyze"
- **Skills 采用渐进式披露**：核心知识在 SKILL.md（< 3000 字），详细内容在 references/
- **MCP 配置**使用 `${CLAUDE_PLUGIN_ROOT}` 引用插件内部文件
- **自定义工具**通过 `extends.tools` 指定注册入口

详细格式规范见 `references/component-schemas.md`。

### 阶段 5：验证

**目标**：确认 plugin 可正常加载。

**验证清单：**

- [ ] `plugin.json` 存在且格式正确
- [ ] 每个 Skill 目录包含 `SKILL.md`
- [ ] `SKILL.md` 包含有效的 YAML frontmatter（name, description）
- [ ] MCP 配置（如果有）使用正确的服务器类型
- [ ] 自定义工具注册入口（如果有）路径正确

**测试建议：**

1. 重启 MantisBot 查看加载日志
2. 确认日志显示：`Loaded plugin: my-plugin (X skills, Y commands)`
3. 尝试触发 skill 或执行 command

## MantisBot 特有功能

MantisBot 在标准 plugin 结构基础上增加了两个扩展功能。

### extends.tools — 自定义工具注册

在 `plugin.json` 中声明工具注册入口：

```json
{
  "name": "my-plugin",
  "extends": {
    "tools": "src/plugins/my-plugin/index.ts"
  }
}
```

注册入口文件需要导出 `register` 函数：

```typescript
import type { ToolRegistry } from '../../agents/tools/registry.js';
import type { PluginToolContext } from '../../plugins/types.js';

export async function register(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  registry.register({
    name: 'my_tool',
    description: '工具描述',
    parameters: { /* JSON Schema */ },
    execute: async (params) => { /* 实现 */ }
  });
}
```

### dependencies.channels — 渠道依赖声明

声明 plugin 对特定渠道的依赖，只有这些渠道启用时才会加载工具：

```json
{
  "name": "my-plugin",
  "dependencies": {
    "channels": ["feishu", "dingtalk"]
  }
}
```

支持的渠道：`feishu`、`dingtalk`、`httpWs` 等。

## 最佳实践

- **从小开始**：一个精心设计的 skill 比五个半成品组件更有价值
- **渐进式披露**：核心知识在 SKILL.md，详细内容在 references/
- **清晰的触发短语**：skill description 应包含用户会说的具体短语
- **命令是给 Claude 的指令**：用祈使语气，明确步骤
- **可移植性**：使用 `${CLAUDE_PLUGIN_ROOT}` 引用插件内部文件
- **安全性**：敏感信息使用环境变量，不要硬编码

## 参考资料

- **`references/component-schemas.md`** — 各组件类型的详细格式规范
- **`references/example-plugins.md`** — 完整示例 plugin 结构
- **`docs/plugin-development-guide.md`** — Plugin 开发指南文档