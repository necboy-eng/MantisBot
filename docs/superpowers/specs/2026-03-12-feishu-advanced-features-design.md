# 飞书高级功能融合设计文档

## 1. 项目背景

### 1.1 目标
将 openclaw-lark 项目的飞书高级功能（多维表格、任务管理、日历、云盘、知识库、电子表格等）融合到 MantisBot 项目中。

### 1.2 现状分析

#### MantisBot 现有能力
- 飞书消息收发（channel 层）
- 基础 IM 工具（get_messages, get_thread_messages, search_messages）
- 基础 UAT 支持（FeishuClientManager）
- Skills 系统

#### openclaw-lark 提供的能力
- **工具层**：Bitable、Task、Calendar、Drive、Wiki、Sheets 等 30+ 工具
- **授权系统**：ToolClient（scope 检查、TAT/UAT 切换、自动刷新）
- **辅助函数**：时间处理、错误处理、参数校验
- **Skills**：详细的使用指南和错误处理文档

### 1.3 融合策略
- **方式**：直接移植代码，适配 MantisBot 架构
- **认证**：完整移植 ToolClient 的授权系统

---

## 2. 架构设计

### 2.1 目录结构

```
src/agents/tools/feishu/
├── client.ts                    # 客户端管理（已有，增强）
├── helpers.ts                   # 辅助函数（新增）
├── uat-store.ts                 # UAT 存储（已有）
├── oauth.ts                     # OAuth 流程（已有）
├── scope-manager.ts             # Scope 管理（新增）
├── auth-errors.ts               # 授权错误类型（新增）
├── tool-client.ts               # 统一客户端（新增，核心）
├── index.ts                     # 工具注册入口（更新）
│
├── bitable/                     # 多维表格工具（新增）
│   ├── index.ts
│   ├── app.ts
│   ├── app-table.ts
│   ├── app-table-record.ts
│   ├── app-table-field.ts
│   └── app-table-view.ts
│
├── task/                        # 任务管理工具（新增）
│   ├── index.ts
│   ├── task.ts
│   ├── tasklist.ts
│   ├── subtask.ts
│   └── comment.ts
│
├── calendar/                    # 日历工具（新增）
│   ├── index.ts
│   ├── calendar.ts
│   ├── event.ts
│   ├── event-attendee.ts
│   └── freebusy.ts
│
├── drive/                       # 云盘工具（新增）
│   └── index.ts
│
├── wiki/                        # 知识库工具（新增）
│   └── index.ts
│
├── sheets/                      # 电子表格工具（新增）
│   └── index.ts
│
├── search/                      # 搜索工具（新增）
│   └── index.ts
│
├── chat/                        # 群聊工具（新增）
│   └── index.ts
│
└── im/                          # IM 工具（已有）
    ├── get-messages.ts
    ├── get-thread-messages.ts
    └── search-messages.ts

skills/
├── feishu-bitable/              # 多维表格 Skill（新增）
│   ├── SKILL.md
│   └── references/
│       ├── field-properties.md
│       ├── record-values.md
│       └── examples.md
│
├── feishu-task/                 # 任务管理 Skill（新增）
│   └── SKILL.md
│
├── feishu-calendar/             # 日历 Skill（新增）
│   └── SKILL.md
│
├── feishu-create-doc/           # 创建文档 Skill（新增）
│   └── SKILL.md
│
├── feishu-fetch-doc/            # 获取文档 Skill（新增）
│   └── SKILL.md
│
├── feishu-update-doc/           # 更新文档 Skill（新增）
│   └── SKILL.md
│
├── feishu-troubleshoot/         # 故障排查 Skill（新增）
│   └── SKILL.md
│
└── feishu-channel-rules/        # 渠道规则 Skill（新增）
    └── SKILL.md
```

### 2.2 核心组件

#### 2.2.1 ToolClient（统一客户端）

```typescript
class ToolClient {
  readonly sdk: Lark.Client;
  readonly senderOpenId: string | undefined;
  readonly account: FeishuAccount;

  // 统一 API 调用入口
  async invoke<T>(
    apiName: string,
    fn: (sdk, opts?) => Promise<T>,
    options?: { as?: 'user' | 'tenant' }
  ): Promise<T>;

  // SDK 未覆盖的 API
  async invokeByPath<T>(path: string, options): Promise<T>;
}
```

**职责**：
- 自动选择 TAT/UAT 身份
- Scope 预检查
- UAT 自动刷新
- 结构化错误处理

#### 2.2.2 ScopeManager（权限管理）

```typescript
// API 所需权限映射
const SCOPE_REGISTRY: Record<string, string[]> = {
  'feishu_bitable_app_table_record.create': ['bitable:record'],
  'feishu_task_task.create': ['task:task'],
  'feishu_calendar_event.create': ['calendar:calendar'],
  // ...
};

function getRequiredScopes(apiName: string): string[];
```

#### 2.2.3 辅助函数（helpers.ts）

```typescript
// 时间处理
function parseTimeToTimestampMs(input: string): string | null;
function parseTimeToRFC3339(input: string): string | null;
function unixTimestampToISO8601(raw: string | number): string | null;

// 错误处理
function assertLarkOk(response: any): void;
function formatLarkError(response: any): string;

// 返回值格式化
function json(data: unknown): ToolResult;
```

---

## 3. 实现计划

### Phase 1: 基础设施（1-2 天）

| 任务 | 描述 | 优先级 |
|------|------|--------|
| helpers.ts | 时间处理、错误处理辅助函数 | P0 |
| auth-errors.ts | 授权错误类型定义 | P0 |
| scope-manager.ts | API 权限映射表 | P0 |
| tool-client.ts | 统一客户端实现 | P0 |
| 更新 client.ts | 集成 ToolClient | P0 |

### Phase 2: 核心工具（2-3 天）

| 任务 | 描述 | 优先级 |
|------|------|--------|
| bitable/* | 多维表格工具（5 个文件） | P0 |
| task/* | 任务管理工具（4 个文件） | P0 |
| 更新 index.ts | 注册新工具 | P0 |

### Phase 3: 扩展工具（1-2 天）

| 任务 | 描述 | 优先级 |
|------|------|--------|
| calendar/* | 日历工具 | P1 |
| drive/* | 云盘工具 | P1 |
| wiki/* | 知识库工具 | P1 |
| sheets/* | 电子表格工具 | P1 |
| search/* | 搜索工具 | P1 |
| chat/* | 群聊工具 | P1 |

### Phase 4: Skills 文档（1 天）

| 任务 | 描述 | 优先级 |
|------|------|--------|
| feishu-bitable | 多维表格使用指南 | P0 |
| feishu-task | 任务管理使用指南 | P0 |
| feishu-calendar | 日历使用指南 | P1 |
| 文档相关 | 创建/获取/更新文档 | P1 |
| feishu-troubleshoot | 故障排查指南 | P1 |

### Phase 5: 测试与集成（1 天）

| 任务 | 描述 | 优先级 |
|------|------|--------|
| 单元测试 | 工具功能测试 | P1 |
| 集成测试 | 端到端流程测试 | P1 |
| 配置更新 | config.example.json 更新 | P0 |

---

## 4. 关键实现细节

### 4.1 ToolClient 适配

openclaw-lark 的 ToolClient 依赖 `openclaw/plugin-sdk`，需要适配到 MantisBot：

```typescript
// openclaw-lark 原始代码
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';

// MantisBot 适配后
import type { AppConfig } from '../../../config/types.js';
```

**需要适配的部分**：
- 配置类型：`ClawdbotConfig` → `AppConfig`
- 日志系统：`api.logger` → `console.log` 或自定义 logger
- 账号管理：多账号支持（保留单账号简化版）

### 4.2 工具注册接口适配

```typescript
// openclaw-lark 原始代码
api.registerTool({
  name: 'feishu_task_task',
  label: 'Feishu Task Management',
  description: '...',
  parameters: FeishuTaskTaskSchema,
  async execute(_toolCallId, params) { ... }
}, { name: 'feishu_task_task' });

// MantisBot 适配后
const tool: Tool = {
  name: 'feishu_task_task',
  description: '...',
  parameters: FeishuTaskTaskSchema,
  async execute(params) { ... }
};
registry.registerTool(tool);
```

### 4.3 UAT 集成

MantisBot 已有 `uat-store.ts` 和 `oauth.ts`，需要与 ToolClient 集成：

```typescript
// tool-client.ts 中的 UAT 调用
const uat = await getStoredToken(this.account.appId, userOpenId);
if (!uat) {
  throw new UserAuthRequiredError(userOpenId, { ... });
}

// 使用 MantisBot 现有的 UAT 存储
import { getUATStore } from './uat-store.js';
const uatStore = getUATStore();
const token = await uatStore.getUAT(userOpenId, appId);
```

### 4.4 Scope 检查

飞书 API 需要检查两类权限：
1. **App Scope**：应用已开通的权限（管理员在开放平台配置）
2. **User Scope**：用户已授权的权限（OAuth 授权）

```typescript
// Scope 检查流程
async function checkScopes(toolClient: ToolClient, apiName: string, userOpenId?: string) {
  const requiredScopes = getRequiredScopes(apiName);

  // 1. 检查 App Scope
  const appScopes = await getAppGrantedScopes(toolClient.sdk, toolClient.account.appId);
  const missingAppScopes = requiredScopes.filter(s => !appScopes.includes(s));
  if (missingAppScopes.length > 0) {
    throw new AppScopeMissingError({ scopes: missingAppScopes });
  }

  // 2. 检查 User Scope（UAT 模式）
  if (userOpenId) {
    const userScopes = await getUserGrantedScopes(userOpenId);
    const missingUserScopes = requiredScopes.filter(s => !userScopes.includes(s));
    if (missingUserScopes.length > 0) {
      throw new UserScopeInsufficientError(userOpenId, { scopes: missingUserScopes });
    }
  }
}
```

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 授权流程复杂度高 | 开发周期延长 | 分阶段实现，先简化版后完整版 |
| 多账号支持 | 配置复杂 | 保留单账号简化版，可选多账号 |
| API 权限映射维护 | 工作量大 | 从 openclaw-lark 同步 scope-meta.json |
| 类型定义冲突 | 编译错误 | 使用 MantisBot 类型覆盖 |

---

## 6. 验收标准

### 功能验收
- [ ] 所有 30+ 工具注册成功
- [ ] Bitable CRUD 操作正常
- [ ] Task 创建/查询/更新正常
- [ ] Calendar 事件管理正常
- [ ] UAT 授权流程正常
- [ ] Scope 检查生效
- [ ] Skills 文档可访问

### 代码质量
- [ ] TypeScript 编译无错误
- [ ] ESLint 检查通过
- [ ] 单元测试覆盖核心功能

### 文档
- [ ] config.example.json 更新
- [ ] README 更新（如有必要）

---

## 7. 时间估算

| 阶段 | 时间 |
|------|------|
| Phase 1: 基础设施 | 1-2 天 |
| Phase 2: 核心工具 | 2-3 天 |
| Phase 3: 扩展工具 | 1-2 天 |
| Phase 4: Skills 文档 | 1 天 |
| Phase 5: 测试集成 | 1 天 |
| **总计** | **6-9 天** |

---

## 8. 附录

### A. 工具清单

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

### B. Scope 映射示例

```json
{
  "feishu_bitable_app_table_record.create": ["bitable:record:write"],
  "feishu_bitable_app_table_record.list": ["bitable:record:read"],
  "feishu_task_task.create": ["task:task:write"],
  "feishu_task_task.list": ["task:task:read"],
  "feishu_calendar_event.create": ["calendar:calendar:event:write"],
  "feishu_calendar_event.list": ["calendar:calendar:event:read"]
}
```