# 飞书高级功能融合设计文档

## 1. 项目背景

### 1.1 目标
将 openclaw-lark 项目的飞书高级功能（多维表格、任务管理、日历、云盘、知识库、电子表格等）以**热插拔插件**的形式融合到 MantisBot 项目中。

### 1.2 设计原则

1. **插件化**：飞书高级功能作为独立插件，支持热插拔启用/禁用
2. **最小侵入**：不修改 MantisBot 核心代码，通过扩展点集成
3. **复用代码**：直接移植 openclaw-lark 的工具实现，适配接口
4. **完整授权**：移植 ToolClient 的 scope 检查和自动授权流程

### 1.3 现状分析

#### MantisBot 插件系统
```
plugins/
├── legal/
│   ├── plugin.json      # 清单
│   ├── skills/          # SKILL.md 文件
│   ├── commands/        # 命令定义
│   └── .mcp.json        # MCP 配置
```

**当前能力**：
- ✅ Skills 加载
- ✅ Commands 加载
- ✅ MCP Servers 配置
- ❌ **工具代码注册**（需要扩展）

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

### 2.1 扩展插件系统

#### 2.1.1 扩展 plugin.json 清单

```json
{
  "name": "feishu-advanced",
  "version": "1.0.0",
  "description": "飞书高级功能：多维表格、任务管理、日历、云盘等",
  "author": { "name": "Anthropic" },
  "extends": {
    "tools": "./src/index.ts",
    "hooks": "./src/hooks.ts"
  },
  "dependencies": {
    "channels": ["feishu"]
  }
}
```

**新增字段**：
- `extends.tools`：工具注册入口文件（TypeScript/JavaScript）
- `extends.hooks`：生命周期钩子文件（可选）
- `dependencies.channels`：依赖的通信渠道

#### 2.1.2 扩展 PluginLoader

```typescript
// src/plugins/types.ts

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  // ... 现有字段

  // 新增：扩展点
  extends?: {
    tools?: string;      // 工具注册入口
    hooks?: string;      // 生命周期钩子
  };

  // 新增：依赖
  dependencies?: {
    channels?: string[]; // 依赖的渠道
    plugins?: string[];  // 依赖的其他插件
  };
}

export interface Plugin {
  name: string;
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  skills: Skill[];
  commands: Command[];
  mcpConfig?: MCPConfig;

  // 新增
  toolsModule?: PluginToolsModule;
}

// 新增：工具模块接口
export interface PluginToolsModule {
  register?: (registry: ToolRegistry, context: PluginContext) => Promise<void>;
  unregister?: () => Promise<void>;
}

// 新增：插件上下文
export interface PluginContext {
  config: any;
  logger: Logger;
  getFeishuClient: () => Promise<any>;
}
```

### 2.2 插件目录结构

```
plugins/feishu-advanced/
├── plugin.json                    # 插件清单
├── src/
│   ├── index.ts                   # 工具注册入口
│   ├── tool-client.ts             # 统一客户端
│   ├── scope-manager.ts           # Scope 管理
│   ├── auth-errors.ts             # 授权错误类型
│   ├── helpers.ts                 # 辅助函数
│   │
│   ├── bitable/                   # 多维表格工具
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── app-table.ts
│   │   ├── app-table-record.ts
│   │   ├── app-table-field.ts
│   │   └── app-table-view.ts
│   │
│   ├── task/                      # 任务管理工具
│   │   ├── index.ts
│   │   ├── task.ts
│   │   ├── tasklist.ts
│   │   ├── subtask.ts
│   │   └── comment.ts
│   │
│   ├── calendar/                  # 日历工具
│   │   ├── index.ts
│   │   ├── calendar.ts
│   │   ├── event.ts
│   │   ├── event-attendee.ts
│   │   └── freebusy.ts
│   │
│   ├── drive/                     # 云盘工具
│   │   └── index.ts
│   │
│   ├── wiki/                      # 知识库工具
│   │   └── index.ts
│   │
│   ├── sheets/                    # 电子表格工具
│   │   └── index.ts
│   │
│   ├── search/                    # 搜索工具
│   │   └── index.ts
│   │
│   ├── chat/                      # 群聊工具
│   │   └── index.ts
│   │
│   └── im/                        # IM 扩展工具
│       └── index.ts
│
├── skills/                        # Skills 文档
│   ├── feishu-bitable/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── field-properties.md
│   │       ├── record-values.md
│   │       └── examples.md
│   │
│   ├── feishu-task/
│   │   └── SKILL.md
│   │
│   ├── feishu-calendar/
│   │   └── SKILL.md
│   │
│   ├── feishu-create-doc/
│   │   └── SKILL.md
│   │
│   ├── feishu-fetch-doc/
│   │   └── SKILL.md
│   │
│   ├── feishu-update-doc/
│   │   └── SKILL.md
│   │
│   ├── feishu-troubleshoot/
│   │   └── SKILL.md
│   │
│   └── feishu-channel-rules/
│       └── SKILL.md
│
└── tsconfig.json                  # TypeScript 配置
```

### 2.3 核心组件

#### 2.3.1 工具注册入口（index.ts）

```typescript
// plugins/feishu-advanced/src/index.ts

import type { PluginToolsModule, PluginContext } from '../../../src/plugins/types.js';
import type { ToolRegistry } from '../../../src/agents/tools/registry.js';
import { registerBitableTools } from './bitable/index.js';
import { registerTaskTools } from './task/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerWikiTools } from './wiki/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerSearchTools } from './search/index.js';
import { registerChatTools } from './chat/index.js';

export const register: PluginToolsModule['register'] = async (
  registry: ToolRegistry,
  context: PluginContext
) => {
  const { config, logger, getFeishuClient } = context;

  // 检查飞书渠道是否启用
  const feishuConfig = config.channels?.feishu;
  if (!feishuConfig?.enabled) {
    logger.info('Feishu channel not enabled, skipping feishu-advanced plugin');
    return;
  }

  logger.info('Registering feishu-advanced tools...');

  // 注册各类工具
  await registerBitableTools(registry, getFeishuClient, logger);
  await registerTaskTools(registry, getFeishuClient, logger);
  await registerCalendarTools(registry, getFeishuClient, logger);
  await registerDriveTools(registry, getFeishuClient, logger);
  await registerWikiTools(registry, getFeishuClient, logger);
  await registerSheetsTools(registry, getFeishuClient, logger);
  await registerSearchTools(registry, getFeishuClient, logger);
  await registerChatTools(registry, getFeishuClient, logger);

  logger.info('feishu-advanced tools registered successfully');
};

// 可选：卸载时清理
export const unregister: PluginToolsModule['unregister'] = async () => {
  console.log('[feishu-advanced] Tools unregistered');
};
```

#### 2.3.2 ToolClient（统一客户端）

```typescript
// plugins/feishu-advanced/src/tool-client.ts

import * as Lark from '@larksuiteoapi/node-sdk';
import { getRequiredScopes } from './scope-manager.js';
import { getUATStore } from '../../../src/agents/tools/feishu/uat-store.js';
import { getConfig } from '../../../src/config/loader.js';

export class ToolClient {
  readonly sdk: Lark.Client;
  readonly senderOpenId: string | undefined;
  readonly appId: string;

  constructor(params: {
    sdk: Lark.Client;
    senderOpenId?: string;
    appId: string;
  }) {
    this.sdk = params.sdk;
    this.senderOpenId = params.senderOpenId;
    this.appId = params.appId;
  }

  /**
   * 统一 API 调用入口
   * 自动处理 TAT/UAT 切换、Scope 检查、Token 刷新
   */
  async invoke<T>(
    apiName: string,
    fn: (sdk: Lark.Client, opts?: any, uat?: string) => Promise<T>,
    options?: { as?: 'user' | 'tenant'; userOpenId?: string }
  ): Promise<T> {
    const tokenType = options?.as ?? 'user';
    const requiredScopes = getRequiredScopes(apiName);

    // TAT 模式
    if (tokenType === 'tenant') {
      return fn(this.sdk);
    }

    // UAT 模式
    const userOpenId = options?.userOpenId ?? this.senderOpenId;
    if (!userOpenId) {
      throw new UserAuthRequiredError('unknown', { apiName, scopes: requiredScopes });
    }

    // 获取 UAT
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;
    const uatStore = getUATStore();
    const uat = await uatStore.getUAT(userOpenId, this.appId);

    if (!uat) {
      throw new UserAuthRequiredError(userOpenId, { apiName, scopes: requiredScopes });
    }

    // 执行调用
    return fn(this.sdk, Lark.withUserAccessToken(uat.accessToken), uat.accessToken);
  }
}

// 错误类型
export class UserAuthRequiredError extends Error {
  constructor(
    public userOpenId: string,
    public context: { apiName: string; scopes: string[] }
  ) {
    super(`User authorization required: ${userOpenId}`);
    this.name = 'UserAuthRequiredError';
  }
}

export class AppScopeMissingError extends Error {
  constructor(
    public context: { apiName: string; scopes: string[]; appId: string }
  ) {
    super(`App scope missing: ${context.scopes.join(', ')}`);
    this.name = 'AppScopeMissingError';
  }
}
```

#### 2.3.3 ScopeManager（权限管理）

```typescript
// plugins/feishu-advanced/src/scope-manager.ts

/**
 * API 所需权限映射表
 * 参考 openclaw-lark/src/core/scope-meta.json
 */
const SCOPE_REGISTRY: Record<string, string[]> = {
  // Bitable
  'feishu_bitable_app.create': ['bitable:app'],
  'feishu_bitable_app_table.create': ['bitable:table'],
  'feishu_bitable_app_table_record.create': ['bitable:record:write'],
  'feishu_bitable_app_table_record.list': ['bitable:record:read'],
  'feishu_bitable_app_table_record.update': ['bitable:record:write'],
  'feishu_bitable_app_table_record.delete': ['bitable:record:write'],
  'feishu_bitable_app_table_field.create': ['bitable:field'],

  // Task
  'feishu_task_task.create': ['task:task'],
  'feishu_task_task.list': ['task:task:read'],
  'feishu_task_task.get': ['task:task:read'],
  'feishu_task_task.patch': ['task:task'],
  'feishu_task_tasklist.create': ['task:tasklist'],
  'feishu_task_tasklist.list': ['task:tasklist:read'],

  // Calendar
  'feishu_calendar_calendar.list': ['calendar:calendar'],
  'feishu_calendar_event.create': ['calendar:calendar:event'],
  'feishu_calendar_event.list': ['calendar:calendar:event:read'],
  'feishu_calendar_event.get': ['calendar:calendar:event:read'],
  'feishu_calendar_event.patch': ['calendar:calendar:event'],

  // Drive
  'feishu_drive_file.list': ['drive:drive:read'],
  'feishu_drive_file.create': ['drive:drive'],

  // Wiki
  'feishu_wiki_node.list': ['wiki:wiki:read'],
  'feishu_wiki_node.create': ['wiki:wiki'],

  // Sheets
  'feishu_sheets_spreadsheet.create': ['sheets:spreadsheet'],
  'feishu_sheets_spreadsheet.get': ['sheets:spreadsheet:read'],

  // Search
  'feishu_search_user': ['search:user:read'],

  // Chat
  'feishu_chat.create': ['im:chat'],
  'feishu_chat.list': ['im:chat:read'],
};

export function getRequiredScopes(apiName: string): string[] {
  return SCOPE_REGISTRY[apiName] ?? [];
}

export function getAllApiNames(): string[] {
  return Object.keys(SCOPE_REGISTRY);
}
```

---

## 3. 实现计划

### Phase 1: 扩展插件系统（1 天）

| 任务 | 描述 | 文件 |
|------|------|------|
| 扩展类型定义 | 添加 extends、dependencies 字段 | `src/plugins/types.ts` |
| 扩展 PluginLoader | 支持加载工具模块 | `src/plugins/loader.ts` |
| 添加热插拔支持 | 启用/禁用时动态注册/注销工具 | `src/plugins/manager.ts` |
| 更新 ToolRegistry | 支持插件命名空间 | `src/agents/tools/registry.ts` |

### Phase 2: 创建插件骨架（0.5 天）

| 任务 | 描述 |
|------|------|
| 创建插件目录 | `plugins/feishu-advanced/` |
| 创建 plugin.json | 清单文件 |
| 创建 index.ts | 工具注册入口 |
| 创建 tsconfig.json | TypeScript 配置 |

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
| feishu-bitable | 多维表格使用指南 |
| feishu-task | 任务管理使用指南 |
| feishu-calendar | 日历使用指南 |
| 其他 Skills | 文档操作、故障排查等 |

### Phase 7: 测试与集成（1 天）

| 任务 | 描述 |
|------|------|
| 单元测试 | 工具功能测试 |
| 集成测试 | 热插拔流程测试 |
| 配置更新 | config.example.json |

---

## 4. 关键实现细节

### 4.1 工具热注册/注销

```typescript
// src/plugins/loader.ts 扩展

async load(pluginPath: string): Promise<Plugin> {
  // ... 现有加载逻辑

  // 新增：加载工具模块
  let toolsModule: PluginToolsModule | undefined;
  if (manifest.extends?.tools) {
    const toolsPath = path.join(pluginPath, manifest.extends.tools);
    toolsModule = await this.loadToolsModule(toolsPath);
  }

  return {
    name: manifest.name,
    manifest,
    path: pluginPath,
    enabled: !this.disabledPlugins.has(manifest.name),
    skills,
    commands,
    mcpConfig,
    toolsModule,  // 新增
  };
}

private async loadToolsModule(toolsPath: string): Promise<PluginToolsModule | undefined> {
  try {
    // 动态导入 ES Module
    const module = await import(`file://${toolsPath}`);
    return {
      register: module.register,
      unregister: module.unregister,
    };
  } catch (error) {
    console.error(`Failed to load tools module: ${toolsPath}`, error);
    return undefined;
  }
}

// 新增：注册插件工具
async registerPluginTools(plugin: Plugin, registry: ToolRegistry, context: PluginContext): Promise<void> {
  if (plugin.toolsModule?.register) {
    await plugin.toolsModule.register(registry, context);
  }
}

// 新增：注销插件工具
async unregisterPluginTools(plugin: Plugin): Promise<void> {
  if (plugin.toolsModule?.unregister) {
    await plugin.toolsModule.unregister();
  }
}
```

### 4.2 工具命名空间

为避免冲突，插件注册的工具使用命名空间前缀：

```typescript
// plugins/feishu-advanced/src/bitable/app-table-record.ts

registry.registerTool({
  name: 'feishu_bitable_app_table_record',  // 已包含 feishu_ 前缀
  description: '飞书多维表格记录管理',
  // ...
});
```

### 4.3 配置集成

```json
// config/config.json

{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "...",
      "appSecret": "..."
    }
  },
  "plugins": {
    "enabled": ["feishu-advanced"],
    "disabled": []
  }
}
```

### 4.4 UAT 集成

插件使用 MantisBot 现有的 UAT 存储机制：

```typescript
// 从 MantisBot 导入
import { getUATStore } from '../../../src/agents/tools/feishu/uat-store.js';
import { getFeishuClient } from '../../../src/agents/tools/feishu/client.js';

// ToolClient 中使用
const uatStore = getUATStore();
const uat = await uatStore.getUAT(userOpenId, appId);
```

---

## 5. 与现有飞书工具的关系

### 5.1 现有工具保留

MantisBot 已有的基础飞书工具保留在 `src/agents/tools/feishu/`：
- `im/get-messages.ts`
- `im/get-thread-messages.ts`
- `im/search-messages.ts`

这些是**核心功能**，不依赖插件。

### 5.2 高级功能插件化

新增的高级功能（Bitable、Task、Calendar 等）放在 `plugins/feishu-advanced/`，可热插拔。

### 5.3 依赖关系

```
feishu-advanced 插件
    ↓ 依赖
飞书渠道 (channels.feishu)
    ↓ 提供
基础认证 (UAT/OAuth)
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 动态导入兼容性 | 某些环境不支持 ESM | 使用 tsx 运行时编译 |
| 工具命名冲突 | 注册失败 | 使用命名空间前缀 |
| 插件加载失败 | 功能不可用 | 优雅降级，记录错误 |
| Scope 检查复杂 | 开发周期长 | 先简化版，后续完善 |

---

## 7. 验收标准

### 功能验收
- [ ] 插件可通过配置启用/禁用
- [ ] 禁用插件后工具不可用
- [ ] 启用插件后工具自动注册
- [ ] Bitable/Task/Calendar 工具正常工作
- [ ] UAT 授权流程正常
- [ ] Skills 文档可访问

### 代码质量
- [ ] TypeScript 编译无错误
- [ ] ESLint 检查通过
- [ ] 插件独立可测试

### 文档
- [ ] plugin.json 完整
- [ ] config.example.json 更新
- [ ] README 更新

---

## 8. 时间估算

| 阶段 | 时间 |
|------|------|
| Phase 1: 扩展插件系统 | 1 天 |
| Phase 2: 创建插件骨架 | 0.5 天 |
| Phase 3: 移植基础设施 | 1 天 |
| Phase 4: 移植核心工具 | 2-3 天 |
| Phase 5: 移植扩展工具 | 1-2 天 |
| Phase 6: Skills 文档 | 1 天 |
| Phase 7: 测试集成 | 1 天 |
| **总计** | **7.5-9.5 天** |

---

## 9. 附录

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
  "plugins": {
    "enabled": ["feishu-advanced"],
    "disabled": []
  },
  "enabledSkills": [
    "feishu-bitable",
    "feishu-task",
    "feishu-calendar"
  ]
}
```