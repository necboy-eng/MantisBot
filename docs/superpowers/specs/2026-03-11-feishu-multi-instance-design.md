# 飞书多实例渠道支持设计文档

**日期：** 2026-03-11
**状态：** 已确认，待实现

---

## 背景与目标

当前 MantisBot 每种渠道类型只能有一个实例（`channels.feishu` 是单对象）。需要支持同时运行多个飞书机器人（每个有独立的 appId/appSecret），每个实例拥有：

- 独立的 WS 连接（不同的飞书机器人应用）
- 独立的会话上下文（SessionManager）
- 独立的记忆存储（MemoryManager）
- 独立的工作主目录（文件工具路径 + 数据存储路径）
- 独立的 Agent 人格（profile，必填，默认 `default`）
- 可选的 Agent team 配置

---

## 设计决策

- **方案选择：** 方案 A（最小改动，集中在飞书相关代码）
- **配置方式：** 新增顶层 `feishuInstances[]` 数组，与现有 `channels.feishu` 并存
- **向后兼容：** 旧 `channels.feishu` 配置自动转换为 id=`"default"` 的实例

---

## 一、配置层

### 1.1 新增 Schema（`src/config/schema.ts`）

从 `FeishuConfigSchema` 提取可复用的子 Schema，供 `FeishuInstanceSchema` 引用：

```typescript
// 提取飞书流式卡片配置为独立 Schema（供复用）
export const FeishuStreamingSchema = z.object({
  enabled: z.boolean().default(true),
  updateInterval: z.number().default(500),
  showThinking: z.boolean().default(true),
}).default({ enabled: true, updateInterval: 500, showThinking: true });

// 提取飞书权限配置为独立 Schema（供复用）
export const FeishuPermissionsSchema = z.object({
  im: z.object({ enabled: z.boolean().default(true), requireUAT: z.boolean().default(true) })
    .default({ enabled: true, requireUAT: true }),
  doc: z.object({ enabled: z.boolean().default(true), requireUAT: z.boolean().default(true) })
    .default({ enabled: true, requireUAT: true }),
  bitable: z.object({ enabled: z.boolean().default(true), requireUAT: z.boolean().default(false) })
    .default({ enabled: true, requireUAT: false }),
  task: z.object({ enabled: z.boolean().default(true), requireUAT: z.boolean().default(false) })
    .default({ enabled: true, requireUAT: false }),
  calendar: z.object({ enabled: z.boolean().default(true), requireUAT: z.boolean().default(true) })
    .default({ enabled: true, requireUAT: true }),
}).default({
  im: { enabled: true, requireUAT: true },
  doc: { enabled: true, requireUAT: true },
  bitable: { enabled: true, requireUAT: false },
  task: { enabled: true, requireUAT: false },
  calendar: { enabled: true, requireUAT: true },
});

// 提取飞书 OAuth 配置为独立 Schema（供复用，实例级 OAuth 独立）
export const FeishuOAuthSchema = z.object({
  enabled: z.boolean().default(true),
  deviceCodeTTL: z.number().default(300),
  pollInterval: z.number().default(3000),
  maxPollAttempts: z.number().default(60),
}).default({ enabled: true, deviceCodeTTL: 300, pollInterval: 3000, maxPollAttempts: 60 });

// 单个飞书实例配置
export const FeishuInstanceSchema = z.object({
  id: z.string(),                            // 实例唯一标识，如 "hr-bot"
  enabled: z.boolean().default(true),
  appId: z.string(),
  appSecret: z.string(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  domain: z.enum(['feishu', 'lark']).default('feishu'),
  connectionMode: z.enum(['websocket', 'polling']).default('websocket'),
  workingDirectory: z.string().optional(),   // 工作主目录
  profile: z.string().default('default'),   // Agent 人格，必填
  team: z.string().optional(),              // Agent team ID，可选
  streaming: FeishuStreamingSchema.optional(),
  permissions: FeishuPermissionsSchema.optional(),
  oauth: FeishuOAuthSchema.optional(),      // 每个实例的 OAuth 配置独立
  debug: z.boolean().default(false),
});

// ConfigSchema 新增顶层字段
feishuInstances: z.array(FeishuInstanceSchema).optional().default([])
```

> **注意：** 原 `FeishuConfigSchema` 内联的 streaming/permissions/oauth 改为引用上述提取的 Schema，保持一致。

### 1.2 示例配置（`config/config.example.json`）

```json
"feishuInstances": [
  {
    "id": "hr-bot",
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "workingDirectory": "./data/hr-bot",
    "profile": "hr-assistant",
    "team": "hr-team"
  },
  {
    "id": "dev-bot",
    "enabled": true,
    "appId": "cli_yyy",
    "appSecret": "yyy",
    "workingDirectory": "./data/dev-bot",
    "profile": "developer"
  }
]
```

### 1.3 向后兼容规则

| 场景 | 行为 |
| ---- | ---- |
| 只有 `channels.feishu` | 自动适配为 id=`"default"` 的单实例，行为与现在一致 |
| 只有 `feishuInstances` | 按新逻辑创建多实例 |
| 两者都有 | `channels.feishu` 作为 id=`"default"` 实例，`feishuInstances` 中如有 id=`"default"` 则完全覆盖（非深度合并） |

---

## 二、渠道层

### 2.1 `feishu/client.ts` 实例化

将现有模块级单例函数（`startFeishuWSClient`、`sendFeishuMessage` 等）改造为 `FeishuClient` 类。每个实例持有：

- 独立的 WS 连接（`lark.WSClient` 实例）
- 独立的消息去重缓存（`processedMessages` Set，从模块级移入实例级）
- 独立的 Bot 凭证（appId/appSecret）
- 进程级代理清除（`delete process.env.HTTP_PROXY` 等）保留在模块加载时执行一次，不放入构造函数

```typescript
export class FeishuClient {
  private instanceId: string;
  private config: FeishuInstanceConfig;
  private wsClient: lark.WSClient | null = null;
  private processedMessages: Set<string> = new Set();  // 实例级去重缓存

  constructor(config: FeishuInstanceConfig) { ... }
  async start(onMessage: FeishuMessageHandler): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  async sendMessage(chatId: string, message: string): Promise<void> { ... }
  async replyMessage(messageId: string, message: string): Promise<void> { ... }
  async sendFile(chatId: string, attachment: FileAttachment): Promise<void> { ... }
}
```

保留旧的模块级函数作为兼容层，委托给内部 `defaultClient`（由旧 `channels.feishu` 配置创建）。

### 2.2 工具层 `src/agents/tools/feishu/client.ts` 多实例适配

现有 `FeishuClientManager` 是全局单例，硬编码读取 `config.channels.feishu`。多实例后需要按实例 ID 路由：

```typescript
// 实例注册表：instanceId -> FeishuClientManager
const instanceManagers: Map<string, FeishuClientManager> = new Map();

// 注册实例（initializer.ts 初始化时调用）
export function registerFeishuInstance(instanceId: string, config: FeishuInstanceConfig): void {
  instanceManagers.set(instanceId, new FeishuClientManager(config));
}

// 按实例获取（tools 调用时从 context 中读取 instanceId）
export function getFeishuClientManager(instanceId?: string): FeishuClientManager {
  const id = instanceId || 'default';
  return instanceManagers.get(id) ?? getDefaultManager();
}
```

飞书工具（`im`、`doc`、`bitable` 等）从 `AgentContext`/`ChannelContext` 中读取 `feishuInstanceId`，传入 `getFeishuClientManager(feishuInstanceId)`。

### 2.3 `FeishuChannel` 改造

`FeishuChannel` 构造函数接收实例配置，持有独立资源，`onMessage` 改为必填：

```typescript
export class FeishuChannel implements IChannel {
  name: string;      // 'feishu:${instanceId}'
  platform = 'feishu';
  enabled: boolean;

  private client: FeishuClient;
  private sessionManager: SessionManager;
  private memoryManager?: MemoryManager;
  private instanceConfig: FeishuInstanceConfig;
  private onMessageHandler: (message: ChannelMessage, context: ChannelContext) => Promise<void>;

  constructor(
    instanceConfig: FeishuInstanceConfig,
    sessionManager: SessionManager,
    onMessageHandler: (message: ChannelMessage, context: ChannelContext) => Promise<void>,
    memoryManager?: MemoryManager,
  ) { ... }
}
```

`sendWithStream` 方法中硬编码的 `config.channels.feishu.streaming` 改为读取 `this.instanceConfig.streaming`，`sendFeishuFile` 改为调用 `this.client.sendFile(...)`。

### 2.4 渠道注册

- 名称格式：`feishu:${instanceId}`（如 `feishu:hr-bot`、`feishu:dev-bot`）
- `platform` 保持 `'feishu'`
- `ChannelRegistry.register()` 按 `name` 去重，支持同平台多实例

### 2.5 `initializer.ts` 改动

```typescript
// 统一初始化单个飞书实例的辅助函数
async function initFeishuInstance(
  instance: FeishuInstanceConfig,
  deps: ChannelDependencies
): Promise<void> {
  const workDir = instance.workingDirectory;
  const sessionManager = new SessionManager(
    maxMessages,
    workDir ? path.join(workDir, 'sessions') : undefined
  );
  const memoryManager = workDir
    ? new MemoryManager(path.join(workDir, 'memory'))
    : deps.memoryManager;

  // 注册工具层实例（供飞书工具按实例路由）
  registerFeishuInstance(instance.id, instance);

  const channel = new FeishuChannel(
    instance, sessionManager, deps.onMessage, memoryManager
  );
  registry.register(channel);
}

// 兼容旧配置：channels.feishu -> 自动转换为 id="default" 单实例
if (config.channels?.feishu?.enabled) {
  const legacyInstance = convertLegacyFeishuConfig(config.channels.feishu);
  await initFeishuInstance(legacyInstance, deps);
}

// 新配置：feishuInstances[]
for (const instance of config.feishuInstances ?? []) {
  if (!instance.enabled) continue;
  await initFeishuInstance(instance, deps);
}
```

---

## 三、数据隔离层

### 3.1 目录结构

每个实例的 `workingDirectory` 下组织如下：

```text
{workingDirectory}/
  sessions/         # SessionManager 数据
  memory/           # MemoryManager 向量+全文索引
  agent-profiles/   # 可选：实例级别人格文件覆盖
  files/            # 文件工具的工作根目录（workDirManager 初始值）
```

未配置 `workingDirectory` 时，回退到全局 `config.workspace`（完全兼容）。

### 3.2 SessionManager 隔离

```typescript
const sessionManager = new SessionManager(
  maxMessages,
  instance.workingDirectory
    ? path.join(instance.workingDirectory, 'sessions')
    : undefined  // 回退到全局
);
```

`SessionStorage` 构造函数第二参数为 `workspace` 字符串，与现有签名一致。

### 3.3 MemoryManager 隔离

```typescript
// MemoryManager 构造函数签名：constructor(workspace?: string)
const memoryManager = instance.workingDirectory
  ? new MemoryManager(path.join(instance.workingDirectory, 'memory'))
  : deps.memoryManager;  // 回退到全局共享实例
```

---

## 四、消息路由层

### 4.1 关键问题：`getByPlatform` 路由失效

当前 `entry.ts` 和部分代码通过 `registry.getByPlatform('feishu')` 查找渠道，多实例后只会返回第一个注册的飞书实例，导致回复路由错误。

**解决方案：** `ChannelMessage.channel` 字段携带完整渠道名称（`feishu:hr-bot`），回复时改用 `registry.get(message.channel)` 按 name 精确路由。

`FeishuChannel` 发出的消息必须设置：

```typescript
const channelMessage: ChannelMessage = {
  ...
  channel: `feishu:${this.instanceConfig.id}`,  // 必须设置，用于回复路由
};
```

### 4.2 `ChannelContext` 扩展

```typescript
export interface ChannelContext {
  chatId: string;
  userId?: string;
  platform: string;
  channel?: string;
  agentProfile?: string;       // 新增：实例指定的 profile
  agentTeam?: string;          // 新增：实例指定的 team ID
  workingDirectory?: string;   // 新增：实例工作目录
  feishuInstanceId?: string;   // 新增：飞书工具层按实例路由凭证
  [key: string]: unknown;
}
```

### 4.3 消息处理链路中的 context 传递

`FeishuChannel` 收到消息时构建完整 context，通过 `onMessageHandler` 传入 `AutoReply`：

```typescript
const context: ChannelContext = {
  chatId,
  userId,
  platform: 'feishu',
  channel: `feishu:${this.instanceConfig.id}`,
  agentProfile: this.instanceConfig.profile,
  agentTeam: this.instanceConfig.team,
  workingDirectory: this.instanceConfig.workingDirectory,
  feishuInstanceId: this.instanceConfig.id,
};
await this.onMessageHandler(channelMessage, context);
```

### 4.4 `AutoReply.handleMessageStream` 透传 context

`AutoReply.handleMessageStream` 目前构建的 `channelContext` 丢失了 `agentProfile` 等字段。需要将 `FeishuChannel` 传入的 context 透传下去，而非重新构建：

```typescript
// 修改后：直接使用传入的 context，不重新构建
yield* this.dispatcher.dispatchStream(message, context);
```

`dispatch.ts` 中 `resolveTeam` 逻辑：

- 优先使用 `context.agentTeam`（实例级指定 team）
- 其次走现有的命令 / 关键词自动检测逻辑

### 4.5 工作目录隔离（workDirManager 并发问题）

`workDirManager` 是进程级全局单例，多实例并发时不能共享。

**解决方案：** 在 `UnifiedAgentRunner` 构造时接受 `cwd` 参数（已有 `options.cwd`），Agent 执行期间使用局部 cwd 而非全局 `workDirManager`。`context.workingDirectory` 传入 Runner options：

```typescript
// dispatch.ts dispatchStream 中
const cwd = context.workingDirectory
  ? path.join(context.workingDirectory, 'files')
  : workDirManager.getCurrentWorkDir();

const effectiveRunner = new UnifiedAgentRunner(toolRegistry, {
  ...existingOptions,
  cwd,
  profile: context.agentProfile,
});
```

这样每次请求创建的 Runner 持有自己的 cwd，无并发竞态。

---

## 五、热加载支持

### 5.1 接口扩展

`hotStartChannel` / `hotStopChannel` 支持实例 ID 格式：

```typescript
hotStartChannel("feishu:hr-bot")   // 启动指定飞书实例
hotStopChannel("feishu:dev-bot")   // 停止指定飞书实例
```

`ChannelRegistry` 新增辅助方法：

```typescript
getAllByPlatform(platform: string): IChannel[]  // 返回所有同 platform 的实例
```

### 5.2 配置持久化

热启动新飞书实例后，将实例配置追加到 `config.feishuInstances[]`（而非旧的 `config.channels[channelId]`）并调用 `saveConfig()`。

### 5.3 Cron 任务路由

`src/cron/executor.ts` 中 `resolveChannel` 使用 `getByPlatform('feishu')` 只返回第一个实例。改为：

- Cron Job 的 `delivery.channel` 支持 `feishu:hr-bot` 格式
- `resolveChannel` 改用 `registry.get(channelName)` 精确路由

---

## 六、影响范围总结

| 文件 | 改动类型 |
| ---- | -------- |
| `src/config/schema.ts` | 提取 FeishuStreamingSchema/PermissionsSchema/OAuthSchema；新增 FeishuInstanceSchema、feishuInstances 字段 |
| `src/channels/channel.interface.ts` | ChannelContext 新增 agentProfile、agentTeam、workingDirectory、feishuInstanceId 字段 |
| `src/channels/feishu/client.ts` | 重构为 FeishuClient 类；实例级去重缓存；保留旧函数兼容层 |
| `src/channels/feishu/channel.ts` | 接收实例配置；持有独立 client/session/memory；sendWithStream 读取实例配置 |
| `src/channels/initializer.ts` | 支持多实例初始化；兼容旧配置；新增 initFeishuInstance 辅助函数 |
| `src/channels/registry.ts` | 新增 getAllByPlatform() 方法 |
| `src/agents/tools/feishu/client.ts` | FeishuClientManager 支持多实例注册与按 instanceId 路由 |
| `src/auto-reply/index.ts` | handleMessageStream 透传 context，不重新构建 ChannelContext |
| `src/auto-reply/dispatch.ts` | resolveTeam 优先读取 context.agentTeam；dispatchStream 使用 context.workingDirectory 初始化 cwd |
| `src/cron/executor.ts` | resolveChannel 支持 feishu:instanceId 格式 |
| `config/config.example.json` | 新增 feishuInstances 示例 |
