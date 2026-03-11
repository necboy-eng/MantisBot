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

```typescript
// 飞书流式卡片配置（从 FeishuConfigSchema 提取复用）
export const FeishuStreamingSchema = z.object({
  enabled: z.boolean().default(true),
  updateInterval: z.number().default(500),
  showThinking: z.boolean().default(true),
});

// 单个飞书实例配置
export const FeishuInstanceSchema = z.object({
  id: z.string(),                           // 实例唯一标识，如 "hr-bot"
  enabled: z.boolean().default(true),
  appId: z.string(),
  appSecret: z.string(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  domain: z.enum(['feishu', 'lark']).default('feishu'),
  connectionMode: z.enum(['websocket', 'polling']).default('websocket'),
  workingDirectory: z.string().optional(),  // 工作主目录
  profile: z.string().default('default'),  // Agent 人格，必填
  team: z.string().optional(),             // Agent team ID，可选
  streaming: FeishuStreamingSchema.optional(),
  permissions: FeishuPermissionsSchema.optional(),
  debug: z.boolean().default(false),
});

// ConfigSchema 新增顶层字段
feishuInstances: z.array(FeishuInstanceSchema).optional().default([])
```

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
|------|------|
| 只有 `channels.feishu` | 自动适配为 id=`"default"` 的单实例，行为与现在一致 |
| 只有 `feishuInstances` | 按新逻辑创建多实例 |
| 两者都有 | `channels.feishu` 作为 id=`"default"` 实例，`feishuInstances` 中如有 id=`"default"` 则覆盖 |

---

## 二、渠道层

### 2.1 `feishu/client.ts` 实例化

将现有模块级单例函数（`startFeishuWSClient`、`sendFeishuMessage` 等）改造为 `FeishuClient` 类：

```typescript
export class FeishuClient {
  constructor(config: FeishuInstanceConfig) { ... }
  async start(onMessage: FeishuMessageHandler): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  async sendMessage(chatId: string, message: string): Promise<void> { ... }
  async replyMessage(messageId: string, message: string): Promise<void> { ... }
  async sendFile(chatId: string, attachment: FileAttachment): Promise<void> { ... }
}
```

保留旧的模块级函数作为兼容层（委托给内部默认 `FeishuClient` 实例）。

### 2.2 `FeishuChannel` 改造

```typescript
export class FeishuChannel implements IChannel {
  name: string;           // 'feishu:${instanceId}'
  platform = 'feishu';
  enabled: boolean;

  private client: FeishuClient;
  private sessionManager: SessionManager;
  private memoryManager?: MemoryManager;
  private instanceConfig: FeishuInstanceConfig;

  constructor(
    instanceConfig: FeishuInstanceConfig,
    sessionManager: SessionManager,
    memoryManager?: MemoryManager,
    onMessage?: MessageHandler
  ) { ... }
}
```

### 2.3 渠道注册

- 名称格式：`feishu:${instanceId}`（如 `feishu:hr-bot`、`feishu:dev-bot`）
- `platform` 保持 `'feishu'`
- Registry 按 `name` 去重，支持同平台多实例

### 2.4 `initializer.ts` 改动

```typescript
// 兼容旧配置：channels.feishu -> 自动转换为单实例
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

每个实例的 `workingDirectory` 组织如下：

```
{workingDirectory}/
  sessions/         # SessionManager 数据
  memory/           # MemoryManager 向量+全文索引
  agent-profiles/   # 可选：实例级别人格文件覆盖
  files/            # 文件工具的工作根目录
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

### 3.3 MemoryManager 隔离

```typescript
const memoryManager = new MemoryManager({
  workspace: instance.workingDirectory
    ? path.join(instance.workingDirectory, 'memory')
    : globalWorkspace,
});
```

---

## 四、Agent 执行层

### 4.1 `ChannelContext` 扩展

```typescript
export interface ChannelContext {
  chatId: string;
  userId?: string;
  platform: string;
  channel?: string;
  agentProfile?: string;      // 新增：实例指定的 profile
  agentTeam?: string;         // 新增：实例指定的 team ID
  workingDirectory?: string;  // 新增：实例工作目录
  [key: string]: unknown;
}
```

### 4.2 消息处理链路

`FeishuChannel` 收到消息时构建完整 context：

```typescript
const context: ChannelContext = {
  chatId,
  userId,
  platform: 'feishu',
  channel: `feishu:${this.instanceConfig.id}`,
  agentProfile: this.instanceConfig.profile,
  agentTeam: this.instanceConfig.team,
  workingDirectory: this.instanceConfig.workingDirectory,
};
```

### 4.3 AutoReply / UnifiedAgentRunner 读取 context

- `context.agentProfile` 优先于全局 `config.activeProfile`
- `context.agentTeam` 优先于自动检测的 team
- `context.workingDirectory` 注入到文件工具（`exec`、`read`、`write`）的 `cwd`

---

## 五、热加载支持

现有热加载接口扩展，支持实例级别操作：

```typescript
// 启动/停止指定飞书实例
hotStartChannel("feishu:hr-bot")
hotStopChannel("feishu:dev-bot")

// 列出所有飞书实例
registry.getAllByPlatform("feishu")
```

---

## 六、影响范围总结

| 文件 | 改动类型 |
|------|----------|
| `src/config/schema.ts` | 新增 `FeishuInstanceSchema`、`feishuInstances` 字段 |
| `src/channels/channel.interface.ts` | `ChannelContext` 新增 3 个字段 |
| `src/channels/feishu/client.ts` | 重构为 `FeishuClient` 类，保留旧函数兼容层 |
| `src/channels/feishu/channel.ts` | 接收实例配置，持有独立 client/session/memory |
| `src/channels/initializer.ts` | 支持多实例初始化，兼容旧配置 |
| `src/channels/registry.ts` | 新增 `getAllByPlatform()` 方法 |
| `src/auto-reply/index.ts` 或 `unified-runner.ts` | 从 context 读取 profile/team/workingDirectory |
| `config/config.example.json` | 新增 `feishuInstances` 示例 |
