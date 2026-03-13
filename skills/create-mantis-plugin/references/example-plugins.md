# MantisBot Plugin 示例

本文档提供三个复杂度递增的完整示例。

---

## 示例 1：hello-world（最小）

一个最简单的 plugin，包含一个命令。

### 目录结构

```
plugins/hello-world/
├── plugin.json
└── commands/
    └── greet.md
```

### plugin.json

```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "一个简单的问候插件示例"
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

---

## 示例 2：data-analyzer（中等）

包含 skills、commands 和 MCP 配置的中等复杂度 plugin。

### 目录结构

```
plugins/data-analyzer/
├── plugin.json
├── .mcp.json
├── commands/
│   ├── analyze.md
│   └── report.md
└── skills/
    └── data-analysis/
        ├── SKILL.md
        └── references/
            └── patterns.md
```

### plugin.json

```json
{
  "name": "data-analyzer",
  "version": "1.0.0",
  "description": "数据分析插件，提供数据洞察和报告生成功能"
}
```

### commands/analyze.md

```markdown
---
description: 分析数据并生成洞察
argument-hint: "[file-path]"
---

# Analyze Command

对 $1 执行深度分析：

1. 解析数据结构
2. 识别关键模式
3. 生成可视化建议
4. 输出洞察报告

如果用户没有指定文件，询问要分析的数据来源。
```

### skills/data-analysis/SKILL.md

```markdown
---
name: data-analysis
description: >
  数据分析技能。当用户说"分析数据"、"数据洞察"、"数据报告"、
  "帮我看看这个数据"时使用此技能。
---

# Data Analysis Skill

你是数据分析专家，擅长从数据中提取洞察。

## 分析流程

1. **理解数据** - 结构、字段、数据类型
2. **数据质量检查** - 缺失值、异常值、一致性
3. **探索性分析** - 分布、相关性、趋势
4. **洞察提取** - 关键发现、异常模式
5. **可视化建议** - 适合的图表类型

## 详细参考

对于特定分析技术，参考 `references/patterns.md`。
```

### .mcp.json

```json
{
  "mcpServers": {
    "chart-generator": {
      "type": "http",
      "url": "https://charts.example.com/mcp"
    }
  }
}
```

---

## 示例 3：feishu-notifier（完整）

包含所有组件类型的完整 plugin，包括自定义工具和渠道依赖。

### 目录结构

```
plugins/feishu-notifier/
├── plugin.json
├── .mcp.json
├── README.md
├── commands/
│   ├── notify.md
│   └── schedule.md
├── skills/
│   └── notification/
│       ├── SKILL.md
│       └── references/
│           └── templates.md
└── src/
    └── plugins/
        └── feishu-notifier/
            └── index.ts
```

### plugin.json

```json
{
  "name": "feishu-notifier",
  "version": "1.0.0",
  "description": "飞书消息通知插件，支持消息发送和定时提醒",
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

### commands/notify.md

```markdown
---
description: 发送飞书通知
argument-hint: "[消息内容]"
---

# Notify Command

通过飞书发送通知：$ARGUMENTS

执行步骤：
1. 解析消息内容
2. 确定目标（用户/群组）
3. 调用飞书 API 发送消息
4. 返回发送结果

如果用户没有指定目标，询问要发送给谁。
```

### skills/notification/SKILL.md

```markdown
---
name: notification
description: >
  飞书通知技能。当用户说"发送通知"、"飞书消息"、"提醒我"、
  "通知团队"时使用此技能。
---

# Notification Skill

飞书消息通知专家。

## 支持的消息类型

- 文本消息
- 富文本消息
- 卡片消息
- 交互式卡片

## 消息模板

参考 `references/templates.md` 获取各类消息的模板格式。

## 最佳实践

1. 消息简洁明了
2. 重要信息使用 @ 提醒
3. 复杂信息使用卡片格式
4. 提供 action 便于快速响应
```

### src/plugins/feishu-notifier/index.ts

```typescript
import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../../plugins/types.js';

export async function register(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { feishuConfig, logger } = context;

  if (!feishuConfig) {
    logger.warn('Feishu config not available, skipping feishu-notifier tools');
    return;
  }

  registry.register({
    name: 'send_feishu_message',
    description: '通过飞书发送消息',
    parameters: {
      type: 'object',
      properties: {
        receive_id: { type: 'string', description: '接收者 ID' },
        msg_type: { type: 'string', description: '消息类型' },
        content: { type: 'string', description: '消息内容' }
      },
      required: ['receive_id', 'msg_type', 'content']
    },
    execute: async (params) => {
      // 实现飞书消息发送逻辑
      logger.info(`Sending message to ${params.receive_id}`);
      return { success: true };
    }
  });

  registry.register({
    name: 'schedule_feishu_reminder',
    description: '安排飞书定时提醒',
    parameters: {
      type: 'object',
      properties: {
        receive_id: { type: 'string', description: '接收者 ID' },
        message: { type: 'string', description: '提醒内容' },
        remind_at: { type: 'string', description: '提醒时间（ISO 8601）' }
      },
      required: ['receive_id', 'message', 'remind_at']
    },
    execute: async (params) => {
      // 实现定时提醒逻辑
      logger.info(`Scheduling reminder for ${params.remind_at}`);
      return { success: true, scheduled: true };
    }
  });
}
```

### .mcp.json

```json
{
  "mcpServers": {
    "feishu-calendar": {
      "type": "http",
      "url": "https://open.feishu.cn/mcp/calendar"
    }
  }
}
```

---

## 使用示例

创建完成后，用户可以：

1. **触发 skill**：说"帮我发送一个飞书通知"
2. **执行 command**：`/feishu-notifier:notify 明天开会`
3. **使用自定义工具**：Agent 可调用 `send_feishu_message` 工具