# 飞书高级功能融合设计文档

## 1. 项目背景

### 1.1 目标
将 openclaw-lark 项目的飞书高级功能（多维表格、任务管理、日历、云盘、知识库、电子表格等）以**插件**的形式融合到 MantisBot 项目中。

### 1.2 设计原则

1. **插件化**：飞书高级功能作为独立插件，可配置启用/禁用
2. **最小侵入**：不修改 MantisBot 核心代码，通过扩展点集成
3. **简化实现**：启动时一次性注册，不需要运行时热插拔
4. **复用编译**：工具代码参与主项目编译，无需额外构建流程

### 1.3 现状分析

#### MantisBot 插件系统

```
plugins/
├── legal/
│   ├── plugin.json      # 清单
│   ├── skills/          # SKILL.md 文件（纯文档）
│   ├── commands/        # 命令定义（纯文档）
│   └── .mcp.json        # MCP 配置
```

**当前能力**：
- ✅ Skills 加载
- ✅ Commands 加载
- ✅ MCP Servers 配置
- ❌ **工具代码注册**（需要扩展）

**关键发现**：现有 plugins 只包含 `.md` 文件，没有 TypeScript 代码，不需要独立编译。

#### openclaw-lark 插件结构

```
openclaw-lark/
├── openclaw.plugin.json  # OpenClaw 清单
├── index.ts              # 入口，注册工具
├── src/tools/            # 工具实现
│   ├── oapi/             # OAPI 工具（Bitable, Task, Calendar...）
│   └── helpers.ts        # 辅助函数
└── skills/               # Skills 文档
```

---

## 2. 架构设计

### 2.1 混合目录结构

由于现有 plugins 没有编译流程，采用混合策略：

```
工具代码 → src/plugins/feishu-advanced/   （参与主项目编译）
Skills 文档 → plugins/feishu-advanced/     （沿用现有结构）
```

**完整目录结构**：

```
# 工具代码（参与主项目编译）
src/plugins/
└── feishu-advanced/
    ├── index.ts                   # 工具注册入口
    ├── tool-client.ts             # 统一客户端
    ├── scope-manager.ts           # Scope 管理
    ├── auth-errors.ts             # 授权错误类型
    ├── helpers.ts                 # 辅助函数
    │
    ├── bitable/                   # 多维表格工具
    │   ├── index.ts
    │   ├── app.ts
    │   ├── app-table.ts
    │   ├── app-table-record.ts
    │   ├── app-table-field.ts
    │   └── app-table-view.ts
    │
    ├── task/                      # 任务管理工具
    │   ├── index.ts
    │   ├── task.ts
    │   ├── tasklist.ts
    │   ├── subtask.ts
    │   └── comment.ts
    │
    ├── calendar/                  # 日历工具
    │   ├── index.ts
    │   ├── calendar.ts
    │   ├── event.ts
    │   ├── event-attendee.ts
    │   └── freebusy.ts
    │
    ├── drive/                     # 云盘工具
    │   └── index.ts
    │
    ├── wiki/                      # 知识库工具
    │   └── index.ts
    │
    ├── sheets/                    # 电子表格工具
    │   └── index.ts
    │
    ├── search/                    # 搜索工具
    │   └── index.ts
    │
    └── chat/                      # 群聊工具
        └── index.ts

# Skills 文档（沿用现有结构）
plugins/
└── feishu-advanced/
    ├── plugin.json                # 插件清单
    └── skills/                    # Skills 文档
        ├── feishu-bitable/
        │   ├── SKILL.md
        │   └── references/
        │       ├── field-properties.md
        │       ├── record-values.md
        │       └── examples.md
        │
        ├── feishu-task/
        │   └── SKILL.md
        │
        ├── feishu-calendar/
        │   └── SKILL.md
        │
        ├── feishu-create-doc/
        │   └── SKILL.md
        │
        ├── feishu-fetch-doc/
        │   └── SKILL.md
        │
        ├── feishu-update-doc/
        │   └── SKILL.md
        │
        ├── feishu-troubleshoot/
        │   └── SKILL.md
        │
        └── feishu-channel-rules/
            └── SKILL.md
```

### 2.2 扩展 plugin.json 清单

```json
// plugins/feishu-advanced/plugin.json
{
  "name": "feishu-advanced",
  "version": "1.0.0",
  "description": "飞书高级功能：多维表格、任务管理、日历、云盘等",
  "author": { "name": "Anthropic" },
  "extends": {
    "tools": "src/plugins/feishu-advanced/index.ts"
  },
  "dependencies": {
    "channels": ["feishu"]
  }
}
```

**新增字段**：
- `extends.tools`：工具注册入口路径（相对于项目根目录，参与主项目编译）
- `dependencies.channels`：依赖的通信渠道

### 2.3 类型定义扩展

```typescript
// src/plugins/types.ts

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  // ... 现有字段

  // 新增：扩展点
  extends?: {
    tools?: string;      // 工具注册入口路径
  };

  // 新增：依赖
  dependencies?: {
    channels?: string[]; // 依赖的渠道
  };
}

// 新增：插件工具注册函数类型
export type PluginToolRegisterFn = (
  registry: ToolRegistry,
  context: PluginToolContext
) => Promise<void>;

export interface PluginToolContext {
  config: AppConfig;
  feishuConfig: FeishuChannelConfig | undefined;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}
```

### 2.4 工具注册入口

```typescript
// src/plugins/feishu-advanced/index.ts

import type { PluginToolRegisterFn, PluginToolContext } from '../../plugins/types.js';
import type { ToolRegistry } from '../../agents/tools/registry.js';
import { registerBitableTools } from './bitable/index.js';
import { registerTaskTools } from './task/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerWikiTools } from './wiki/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerSearchTools } from './search/index.js';
import { registerChatTools } from './chat/index.js';

/**
 * 插件工具注册入口
 * 在 entry.ts 中被调用，启动时一次性注册
 */
export const register: PluginToolRegisterFn = async (
  registry: ToolRegistry,
  context: PluginToolContext
) => {
  const { feishuConfig, logger } = context;

  // 1. 检查飞书渠道是否启用
  if (!feishuConfig?.enabled) {
    logger.info('[feishu-advanced] Feishu channel not enabled, skipping plugin');
    return;
  }

  // 2. 检查必要配置
  if (!feishuConfig.appId || !feishuConfig.appSecret) {
    logger.warn('[feishu-advanced] Feishu appId/appSecret not configured, skipping plugin');
    return;
  }

  logger.info('[feishu-advanced] Registering tools...');

  // 3. 注册各类工具
  await registerBitableTools(registry, context);
  await registerTaskTools(registry, context);
  await registerCalendarTools(registry, context);
  await registerDriveTools(registry, context);
  await registerWikiTools(registry, context);
  await registerSheetsTools(registry, context);
  await registerSearchTools(registry, context);
  await registerChatTools(registry, context);

  logger.info('[feishu-advanced] Tools registered successfully');
};
```

### 2.5 核心组件

#### 2.5.1 ToolClient（统一客户端）

```typescript
// src/plugins/feishu-advanced/tool-client.ts

import * as Lark from '@larksuiteoapi/node-sdk';
import { getRequiredScopes } from './scope-manager.js';
import { getUATStore } from '../../agents/tools/feishu/uat-store.js';
import type { FeishuChannelConfig } from '../../config/types.js';
import { UserAuthRequiredError, AppScopeMissingError } from './auth-errors.js';

export class ToolClient {
  readonly sdk: Lark.Client;
  readonly senderOpenId: string | undefined;
  readonly feishuConfig: FeishuChannelConfig;

  constructor(params: {
    sdk: Lark.Client;
    senderOpenId?: string;
    feishuConfig: FeishuChannelConfig;
  }) {
    this.sdk = params.sdk;
    this.senderOpenId = params.senderOpenId;
    this.feishuConfig = params.feishuConfig;
  }

  /**
   * 统一 API 调用入口
   * 自动处理 TAT/UAT 切换、Scope 检查
   */
  async invoke<T>(
    apiName: string,
    fn: (sdk: Lark.Client, opts?: any, uat?: string) => Promise<T>,
    options?: { as?: 'user' | 'tenant'; userOpenId?: string }
  ): Promise<T> {
    const tokenType = options?.as ?? 'user';
    const requiredScopes = getRequiredScopes(apiName);

    // TAT 模式（应用身份）
    if (tokenType === 'tenant') {
      return fn(this.sdk);
    }

    // UAT 模式（用户身份）
    const userOpenId = options?.userOpenId ?? this.senderOpenId;
    if (!userOpenId) {
      throw new UserAuthRequiredError('unknown', { apiName, scopes: requiredScopes });
    }

    // 获取 UAT
    const uatStore = getUATStore();
    const uat = await uatStore.getUAT(userOpenId, this.feishuConfig.appId);

    if (!uat) {
      throw new UserAuthRequiredError(userOpenId, { apiName, scopes: requiredScopes });
    }

    // 执行调用（使用 UAT）
    return fn(this.sdk, Lark.withUserAccessToken(uat.accessToken), uat.accessToken);
  }
}

/**
 * 创建 ToolClient 实例
 */
export async function createToolClient(
  feishuConfig: FeishuChannelConfig,
  senderOpenId?: string
): Promise<ToolClient> {
  const { getFeishuBotClient } = await import('../../agents/tools/feishu/client.js');
  const sdk = await getFeishuBotClient();

  return new ToolClient({
    sdk,
    senderOpenId,
    feishuConfig,
  });
}
```

#### 2.5.2 ScopeManager（权限管理）

```typescript
// src/plugins/feishu-advanced/scope-manager.ts

/**
 * API 所需权限映射表
 */
const SCOPE_REGISTRY: Record<string, string[]> = {
  // Bitable
  'feishu_bitable_app.create': ['bitable:app'],
  'feishu_bitable_app_table.create': ['bitable:table'],
  'feishu_bitable_app_table_record.create': ['bitable:record:write'],
  'feishu_bitable_app_table_record.list': ['bitable:record:read'],
  'feishu_bitable_app_table_record.update': ['bitable:record:write'],
  'feishu_bitable_app_table_record.delete': ['bitable:record:write'],

  // Task
  'feishu_task_task.create': ['task:task'],
  'feishu_task_task.list': ['task:task:read'],
  'feishu_task_task.patch': ['task:task'],

  // Calendar
  'feishu_calendar_event.create': ['calendar:calendar:event'],
  'feishu_calendar_event.list': ['calendar:calendar:event:read'],

  // Drive
  'feishu_drive_file.list': ['drive:drive:read'],

  // Wiki
  'feishu_wiki_node.list': ['wiki:wiki:read'],

  // Sheets
  'feishu_sheets_spreadsheet.get': ['sheets:spreadsheet:read'],

  // Search
  'feishu_search_user': ['search:user:read'],

  // Chat
  'feishu_chat.list': ['im:chat:read'],
};

export function getRequiredScopes(apiName: string): string[] {
  return SCOPE_REGISTRY[apiName] ?? [];
}
```

#### 2.5.3 辅助函数

```typescript
// src/plugins/feishu-advanced/helpers.ts

/**
 * 时间处理：解析时间字符串为毫秒时间戳
 */
export function parseTimeToTimestampMs(input: string): string | null {
  try {
    const trimmed = input.trim();
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return date.getTime().toString();
    }

    // 无时区，当作北京时间处理
    const normalized = trimmed.replace('T', ' ');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return date.getTime().toString();
    }

    const [, year, month, day, hour, minute, second] = match;
    const utcDate = new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour) - 8, // 北京时间 UTC+8
      parseInt(minute),
      parseInt(second ?? '0'),
    ));

    return utcDate.getTime().toString();
  } catch {
    return null;
  }
}

/**
 * 飞书 API 响应检查
 */
export function assertLarkOk(response: any): void {
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * 格式化返回值
 */
export function json(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}
```

---

## 3. 实现计划

### Phase 1: 扩展插件系统（0.5 天）

| 任务 | 描述 | 文件 |
|------|------|------|
| 扩展类型定义 | 添加 extends、dependencies 字段 | `src/plugins/types.ts` |
| 扩展 PluginLoader | 添加工具注册函数导入和调用 | `src/plugins/loader.ts` |
| 更新 entry.ts | 添加插件工具注册步骤 | `src/entry.ts` |

### Phase 2: 创建插件骨架（0.5 天）

| 任务 | 描述 |
|------|------|
| 创建工具目录 | `src/plugins/feishu-advanced/` |
| 创建 Skills 目录 | `plugins/feishu-advanced/skills/` |
| 创建 plugin.json | 清单文件 |
| 创建 index.ts | 工具注册入口 |

### Phase 3: 移植基础设施（1 天）

| 任务 | 描述 |
|------|------|
| helpers.ts | 时间处理、错误处理辅助函数 |
| auth-errors.ts | 授权错误类型定义 |
| scope-manager.ts | API 权限映射表 |
| tool-client.ts | 统一客户端实现 |

### Phase 4: 移植核心工具（2-3 天）

| 任务 | 描述 |
|------|------|
| bitable/* | 多维表格工具（5 个文件） |
| task/* | 任务管理工具（4 个文件） |
| calendar/* | 日历工具（4 个文件） |

### Phase 5: 移植扩展工具（1-2 天）

| 任务 | 描述 |
|------|------|
| drive/* | 云盘工具 |
| wiki/* | 知识库工具 |
| sheets/* | 电子表格工具 |
| search/* | 搜索工具 |
| chat/* | 群聊工具 |

### Phase 6: Skills 文档（1 天）

| 任务 | 描述 |
|------|------|
| 从 openclaw-lark 复制 | Skills 文档和 references |

### Phase 7: 测试与集成（0.5 天）

| 任务 | 描述 |
|------|------|
| 配置更新 | config.example.json |
| 功能测试 | 验证工具可用 |

---

## 4. 关键实现细节

### 4.1 entry.ts 集成

```typescript
// src/entry.ts 修改

// 1. 加载插件后
const pluginLoader = new PluginLoader('./plugins', config.disabledPlugins || []);
await pluginLoader.loadAll();

// 2. 注册插件工具（新增）
await registerPluginTools(pluginLoader, toolRegistry, config);

// 新增函数
async function registerPluginTools(
  pluginLoader: PluginLoader,
  toolRegistry: ToolRegistry,
  config: AppConfig
): Promise<void> {
  for (const plugin of pluginLoader.getAllPlugins()) {
    if (!plugin.enabled || !plugin.manifest.extends?.tools) {
      continue;
    }

    // 检查依赖
    const deps = plugin.manifest.dependencies;
    if (deps?.channels) {
      const channelEnabled = deps.channels.every(
        ch => (config.channels as any)?.[ch]?.enabled
      );
      if (!channelEnabled) {
        console.log(`[Plugins] Skipping ${plugin.name}: required channels not enabled`);
        continue;
      }
    }

    // 导入并调用注册函数
    try {
      const toolsPath = plugin.manifest.extends.tools;
      const module = await import(`../../${toolsPath}`);
      if (module.register) {
        await module.register(toolRegistry, {
          config,
          feishuConfig: (config.channels as any)?.feishu,
          logger: console,
        });
      }
    } catch (error) {
      console.error(`[Plugins] Failed to register tools for ${plugin.name}:`, error);
    }
  }
}
```

### 4.2 tsconfig.json 更新

```json
// tsconfig.json
{
  "include": [
    "src/**/*",
    "plugins/*/src/**/*"  // 可选，如果需要独立编译
  ]
}
```

**注意**：由于工具代码放在 `src/plugins/` 下，已包含在 `src/**/*` 中，无需修改 tsconfig.json。

### 4.3 与现有飞书工具的关系

```
现有工具（保留）：
src/agents/tools/feishu/
├── im/get-messages.ts
├── im/get-thread-messages.ts
└── im/search-messages.ts

新增插件工具：
src/plugins/feishu-advanced/
├── bitable/
├── task/
├── calendar/
└── ...

两者共存，通过 ToolRegistry 统一管理。
```

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 插件加载失败 | 功能不可用 | 优雅降级，记录错误 |
| 飞书配置缺失 | 工具注册跳过 | 依赖检查 + 日志提示 |
| UAT 未授权 | API 调用失败 | 抛出结构化错误，引导授权 |

---

## 6. 验收标准

### 功能验收
- [ ] 插件可通过配置启用/禁用
- [ ] 禁用飞书渠道时，插件自动跳过注册
- [ ] Bitable/Task/Calendar 工具正常工作
- [ ] UAT 授权流程正常
- [ ] Skills 文档可访问

### 代码质量
- [ ] TypeScript 编译无错误
- [ ] ESLint 检查通过

### 文档
- [ ] plugin.json 完整
- [ ] config.example.json 更新

---

## 7. 时间估算

| 阶段 | 时间 |
|------|------|
| Phase 1: 扩展插件系统 | 0.5 天 |
| Phase 2: 创建插件骨架 | 0.5 天 |
| Phase 3: 移植基础设施 | 1 天 |
| Phase 4: 移植核心工具 | 2-3 天 |
| Phase 5: 移植扩展工具 | 1-2 天 |
| Phase 6: Skills 文档 | 1 天 |
| Phase 7: 测试集成 | 0.5 天 |
| **总计** | **6.5-8.5 天** |

---

## 8. 附录

### A. 工具清单（30+ 个）

| 模块 | 工具名称 | 功能 |
|------|---------|------|
| Bitable | feishu_bitable_app | 多维表格应用管理 |
| Bitable | feishu_bitable_app_table | 数据表管理 |
| Bitable | feishu_bitable_app_table_record | 记录管理 |
| Bitable | feishu_bitable_app_table_field | 字段管理 |
| Bitable | feishu_bitable_app_table_view | 视图管理 |
| Task | feishu_task_task | 任务管理 |
| Task | feishu_task_tasklist | 清单管理 |
| Task | feishu_task_subtask | 子任务管理 |
| Task | feishu_task_comment | 任务评论 |
| Calendar | feishu_calendar_calendar | 日历管理 |
| Calendar | feishu_calendar_event | 事件管理 |
| Calendar | feishu_calendar_event_attendee | 参会人管理 |
| Calendar | feishu_calendar_freebusy | 忙闲查询 |
| Drive | feishu_drive_file | 云盘文件管理 |
| Wiki | feishu_wiki_node | 知识库节点管理 |
| Sheets | feishu_sheets_spreadsheet | 电子表格管理 |
| Search | feishu_search_user | 用户搜索 |
| Chat | feishu_chat | 群聊管理 |

### B. Skills 清单

| Skill | 描述 |
|-------|------|
| feishu-bitable | 多维表格使用指南 |
| feishu-task | 任务管理使用指南 |
| feishu-calendar | 日历使用指南 |
| feishu-create-doc | 创建文档指南 |
| feishu-fetch-doc | 获取文档指南 |
| feishu-update-doc | 更新文档指南 |
| feishu-troubleshoot | 故障排查指南 |
| feishu-channel-rules | 渠道规则指南 |

### C. 配置示例

```json
// config/config.json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "domain": "feishu"
    }
  },
  "disabledPlugins": [],
  "enabledSkills": [
    "feishu-bitable",
    "feishu-task",
    "feishu-calendar"
  ]
}
```