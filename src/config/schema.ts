// src/config/schema.ts

import { z } from 'zod';

export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().default(3000),
  cors: z.boolean().default(true),
  wsPath: z.string().default('/ws'),
  bind: z.string().optional(),
  // 访问鉴权配置
  auth: z.object({
    enabled: z.boolean().default(false),
  }).optional(),
  tailscale: z.object({
    enabled: z.boolean().default(false),
    mode: z.string().optional(),
    resetOnExit: z.boolean().default(true),
  }).optional(),
  // 内网穿透配置
  tunnel: z.object({
    enabled: z.boolean().default(false),
    // DDNSTO 配置
    ddnsto: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      deviceIdx: z.number().default(0),
      deviceName: z.string().optional(),
    }).optional(),
    // Cloudflare Tunnel 配置
    cloudflare: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      tunnelId: z.string().optional(),
      credentialsFile: z.string().optional(),
    }).optional(),
    // FRP 配置
    frp: z.object({
      enabled: z.boolean().default(false),
      configPath: z.string().optional(),
      serverAddr: z.string().optional(),
      serverPort: z.number().optional(),
      token: z.string().optional(),
      localPort: z.number().optional(),
      subdomain: z.string().optional(),
    }).optional(),
  }).optional(),
});

// 模型协议类型：决定使用哪个 SDK
export const ModelProtocolSchema = z.enum(['openai', 'anthropic']);

// 模型提供商：决定默认 API 端点
export const ModelProviderSchema = z.enum([
  'openai',        // OpenAI 官方
  'anthropic',     // Anthropic 官方 (Claude)
  'deepseek',      // DeepSeek
  'alibaba',       // 阿里百炼 (通义千问)
  'alibaba-coding',// 阿里百炼 Coding Plan
  'moonshot',      // Moonshot AI (Kimi)
  'zhipu',         // 智谱 AI (GLM)
  'zhipu-coding',  // 智谱 AI Coding Plan
  'minimax',       // MiniMax
  'xai',           // xAI (Grok)
  'google',        // Google AI (Gemini)
  'cohere',        // Cohere
  'ollama',        // Ollama 本地
  'custom',        // 自定义端点
]);

// 提供商默认配置：支持 OpenAI 和 Anthropic 两种协议的端点
export const PROVIDER_DEFAULTS: Record<string, {
  openai: string;
  anthropic: string;
  defaultProtocol: 'openai' | 'anthropic';
}> = {
  openai: {
    openai: 'https://api.openai.com/v1',
    anthropic: '', // OpenAI 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  anthropic: {
    openai: '', // Anthropic 不提供 OpenAI 协议
    anthropic: 'https://api.anthropic.com',
    defaultProtocol: 'anthropic',
  },
  deepseek: {
    openai: 'https://api.deepseek.com/v1',
    anthropic: '', // DeepSeek 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  alibaba: {
    openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    anthropic: '', // 阿里百炼不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  'alibaba-coding': {
    openai: 'https://coding.dashscope.aliyuncs.com/v1',
    anthropic: '', // 阿里百炼 Coding Plan 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  moonshot: {
    openai: 'https://api.moonshot.cn/v1',
    anthropic: '', // Kimi 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  zhipu: {
    openai: 'https://open.bigmodel.cn/api/paas/v4',
    anthropic: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultProtocol: 'openai',
  },
  'zhipu-coding': {
    openai: '', // zhipu-coding 只支持 Anthropic 协议
    anthropic: 'https://open.bigmodel.cn/api/anthropic',
    defaultProtocol: 'anthropic',
  },
  minimax: {
    openai: 'https://api.minimax.chat/v1',
    anthropic: 'https://api.minimaxi.com/anthropic',
    defaultProtocol: 'openai',
  },
  xai: {
    openai: 'https://api.x.ai/v1',
    anthropic: '', // xAI 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  google: {
    openai: 'https://generativelanguage.googleapis.com/v1beta',
    anthropic: '', // Google 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  cohere: {
    openai: 'https://api.cohere.ai/v1',
    anthropic: '', // Cohere 不提供 Anthropic 协议
    defaultProtocol: 'openai',
  },
  ollama: {
    openai: 'http://localhost:11434/v1',
    anthropic: '', // Ollama 不提供 Anthropic ��议
    defaultProtocol: 'openai',
  },
  custom: {
    openai: '',
    anthropic: '',
    defaultProtocol: 'openai',
  },
};

export const ModelConfigSchema = z.object({
  name: z.string(),
  // 协议类型（决定使用哪个 SDK）
  protocol: ModelProtocolSchema.optional(),
  // 提供商（决定默认端点）
  provider: ModelProviderSchema.optional(),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  baseURL: z.string().optional(),
  endpoint: z.string().optional(),
  // 是否启用（禁用后 UI 上灰显，但配置保留）- undefined 视为 true
  enabled: z.boolean().optional(),
  // 模型能力标记（需手动配置，不自动推断）
  capabilities: z.object({
    vision: z.boolean().optional(),
  }).optional(),
});

// ── 飞书子 Schema（可复用，供 FeishuInstanceSchema 引用）────────────────────
export const FeishuStreamingSchema = z.object({
  enabled: z.boolean().default(true),
  updateInterval: z.number().default(500),
  showThinking: z.boolean().default(true),
}).default({ enabled: true, updateInterval: 500, showThinking: true });

export const FeishuPermissionsSchema = z.object({
  im: z.object({
    enabled: z.boolean().default(true),
    requireUAT: z.boolean().default(true),
  }).default({ enabled: true, requireUAT: true }),
  doc: z.object({
    enabled: z.boolean().default(true),
    requireUAT: z.boolean().default(true),
  }).default({ enabled: true, requireUAT: true }),
  bitable: z.object({
    enabled: z.boolean().default(true),
    requireUAT: z.boolean().default(false),
  }).default({ enabled: true, requireUAT: false }),
  task: z.object({
    enabled: z.boolean().default(true),
    requireUAT: z.boolean().default(false),
  }).default({ enabled: true, requireUAT: false }),
  calendar: z.object({
    enabled: z.boolean().default(true),
    requireUAT: z.boolean().default(true),
  }).default({ enabled: true, requireUAT: true }),
}).default({
  im: { enabled: true, requireUAT: true },
  doc: { enabled: true, requireUAT: true },
  bitable: { enabled: true, requireUAT: false },
  task: { enabled: true, requireUAT: false },
  calendar: { enabled: true, requireUAT: true },
});

export const FeishuOAuthSchema = z.object({
  enabled: z.boolean().default(true),
  deviceCodeTTL: z.number().default(300),
  pollInterval: z.number().default(3000),
  maxPollAttempts: z.number().default(60),
}).default({ enabled: true, deviceCodeTTL: 300, pollInterval: 3000, maxPollAttempts: 60 });

// 单个飞书实例配置
export const FeishuInstanceSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  appId: z.string(),
  appSecret: z.string(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  domain: z.enum(['feishu', 'lark']).default('feishu'),
  connectionMode: z.enum(['websocket', 'polling']).default('websocket'),
  workingDirectory: z.string().optional(),
  profile: z.string().default('default'),
  team: z.string().optional(),
  streaming: FeishuStreamingSchema,
  permissions: FeishuPermissionsSchema,
  oauth: FeishuOAuthSchema,
  debug: z.boolean().default(false),
});

export type FeishuInstanceConfig = z.infer<typeof FeishuInstanceSchema>;

export const FeishuConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  domain: z.enum(['feishu', 'lark']).default('feishu'),
  connectionMode: z.enum(['websocket', 'polling']).default('websocket'),
  debug: z.boolean().default(false),

  // OAuth 配置
  oauth: z.object({
    enabled: z.boolean().default(true),
    deviceCodeTTL: z.number().default(300), // 设备码有效期（秒）
    pollInterval: z.number().default(3000), // 轮询间隔（毫秒）
    maxPollAttempts: z.number().default(60), // 最大轮询次数
  }).default({
    enabled: true,
    deviceCodeTTL: 300,
    pollInterval: 3000,
    maxPollAttempts: 60,
  }),

  // 流式卡片配置
  streaming: z.object({
    enabled: z.boolean().default(true), // 是否启用流式卡片
    updateInterval: z.number().default(500), // 更新间隔（毫秒）
    showThinking: z.boolean().default(true), // 是否显示"思考中"状态
  }).default({
    enabled: true,
    updateInterval: 500,
    showThinking: true,
  }),

  // 工具权限配置
  permissions: z.object({
    // IM 消息读取权限
    im: z.object({
      enabled: z.boolean().default(true),
      requireUAT: z.boolean().default(true), // 是否需要用户授权
    }).default({
      enabled: true,
      requireUAT: true,
    }),

    // 文档操作权限
    doc: z.object({
      enabled: z.boolean().default(true),
      requireUAT: z.boolean().default(true),
    }).default({
      enabled: true,
      requireUAT: true,
    }),

    // Bitable 权限
    bitable: z.object({
      enabled: z.boolean().default(true),
      requireUAT: z.boolean().default(false), // Bot 可以访问
    }).default({
      enabled: true,
      requireUAT: false,
    }),

    // 任务管理权限
    task: z.object({
      enabled: z.boolean().default(true),
      requireUAT: z.boolean().default(false),
    }).default({
      enabled: true,
      requireUAT: false,
    }),

    // 日历权限
    calendar: z.object({
      enabled: z.boolean().default(true),
      requireUAT: z.boolean().default(true),
    }).default({
      enabled: true,
      requireUAT: true,
    }),
  }).default({
    im: { enabled: true, requireUAT: true },
    doc: { enabled: true, requireUAT: true },
    bitable: { enabled: true, requireUAT: false },
    task: { enabled: true, requireUAT: false },
    calendar: { enabled: true, requireUAT: true },
  }),
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  signingSecret: z.string().optional(),
  appToken: z.string().optional(),
});

export const PluginConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).optional(),
});

// 支持字符串数组或对象数组格式
const PluginSchema = z.union([
  z.string().transform(name => ({ name, enabled: true })),
  PluginConfigSchema,
]);

// 存储配置 Schema
export const StorageProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['local', 'nas']),
  enabled: z.boolean().default(true),

  // 本地存储配置
  path: z.string().optional(),

  // NAS 存储配置
  protocol: z.enum(['webdav', 'smb']).optional(),
  url: z.string().url().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  basePath: z.string().optional(),
  timeout: z.number().positive().optional().default(30000),
  // 本地挂载路径（可选）：当 NAS 已通过操作系统挂载为本地目录时填写
  // macOS 例：/Volumes/MyNAS；Windows 例：Z:\；Linux 例：/mnt/nas
  // 设置后切换到此存储时 Agent 将直接使用本地文件系统路径访问，无需经过 SMB/WebDAV
  localMountPath: z.string().optional()
}).refine(
  (data) => {
    if (data.type === 'local') {
      return !!data.path;
    }
    if (data.type === 'nas') {
      return !!(data.url && data.username && data.password);
    }
    return false;
  },
  { message: 'Invalid storage configuration' }
);

export const StorageSchema = z.object({
  default: z.string(),
  providers: z.array(StorageProviderSchema)
});

// ============================================
// 邮件配置 Schema
// ============================================

// 邮件提供商预设
export const EMAIL_PROVIDERS: Record<string, {
  name: string;
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; secure: boolean };
  hint?: string;
}> = {
  gmail: {
    name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, tls: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    hint: '需要在 Google 账户中启用"两步验证"并生成"应用专用密码"',
  },
  outlook: {
    name: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993, tls: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
  },
  '163': {
    name: '163.com',
    imap: { host: 'imap.163.com', port: 993, tls: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    hint: '需要在网页端开启 IMAP/SMTP 服务，使用授权码而非登录密码',
  },
  '126': {
    name: '126.com',
    imap: { host: 'imap.126.com', port: 993, tls: true },
    smtp: { host: 'smtp.126.com', port: 465, secure: true },
    hint: '需要在网页端开启 IMAP/SMTP 服务，使用授权码而非登录密码',
  },
  qq: {
    name: 'QQ Mail',
    imap: { host: 'imap.qq.com', port: 993, tls: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    hint: '需要在网页端开启 IMAP/SMTP 服务，使用授权码而非登录密码',
  },
  feishu: {
    name: 'Feishu Mail',
    imap: { host: 'imap.feishu.cn', port: 993, tls: true },
    smtp: { host: 'smtp.feishu.cn', port: 465, secure: true },
  },
  yahoo: {
    name: 'Yahoo Mail',
    imap: { host: 'imap.mail.yahoo.com', port: 993, tls: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    hint: '需要生成"应用专用密码"',
  },
  icloud: {
    name: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993, tls: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    hint: '需要使用"应用专用密码"',
  },
  custom: {
    name: '自定义',
    imap: { host: '', port: 993, tls: true },
    smtp: { host: '', port: 465, secure: true },
  },
};

// 单个邮箱账户配置
export const EmailAccountSchema = z.object({
  id: z.string(),                    // 唯一标识
  name: z.string(),                  // 显示名称
  email: z.string(),                 // 邮箱地址
  password: z.string(),              // 密码/授权码
  provider: z.string().default('custom'),  // 提供商 ID

  // IMAP 配置
  imap: z.object({
    host: z.string(),
    port: z.number().default(993),
    tls: z.boolean().default(true),
  }),

  // SMTP 配置
  smtp: z.object({
    host: z.string(),
    port: z.number().default(465),
    secure: z.boolean().default(true),
  }),

  // 状态
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),

  // 最后同步时间
  lastSyncAt: z.number().optional(),
});

// 邮件配置 Schema
export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  accounts: z.array(EmailAccountSchema).default([]),
  defaultAccountId: z.string().optional(),
});

export type EmailAccount = z.infer<typeof EmailAccountSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

// ============================================
// Agent Teams 配置 Schema
// ============================================

export const AgentDefinitionSchema = z.object({
  /** 何时调用此 Agent（直接映射 SDK AgentDefinition.description） */
  description: z.string(),
  /** Subagent 人格定义（映射到 SDK prompt） */
  systemPrompt: z.string().optional(),
  /** 允许使用的工具列表 */
  tools: z.array(z.string()).optional(),
  /** 禁用的工具列表 */
  disallowedTools: z.array(z.string()).optional(),
  /** 使用的模型，inherit 表示继承主 Agent 模型，或填写配置中的模型名称 */
  model: z.string().default('inherit'),
  /** 最大循环次数 */
  maxTurns: z.number().int().min(1).max(200).optional(),
  /** 预加载的 Skills 列表 */
  skills: z.array(z.string()).optional(),
});

export const AgentTeamSchema = z.object({
  /** 唯一 ID（slug 格式） */
  id: z.string(),
  /** 展示名称 */
  name: z.string(),
  /** 用途描述（用于 AI 自动判断） */
  description: z.string().optional(),
  /** 触发命令关键字（不含斜杠，如 "research"） */
  triggerCommand: z.string().optional(),
  /** AI 自动识别时匹配的关键词 */
  autoDetectKeywords: z.array(z.string()).default([]),
  /** 是否启用 */
  enabled: z.boolean().default(true),
  /** 主协调者配置 */
  orchestrator: z.object({
    /** 使用的模型名称，对应模型配置中 Anthropic 协议的模型 */
    model: z.string().default('opus'),
    systemPrompt: z.string().optional(),
    maxTurns: z.number().int().min(1).max(200).default(50),
  }),
  /** Subagent 定义，key 为 Agent ID */
  agents: z.record(z.string(), AgentDefinitionSchema),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type AgentTeam = z.infer<typeof AgentTeamSchema>;

export const ConfigSchema = z.object({
  server: ServerConfigSchema,
  models: z.array(ModelConfigSchema).min(1),
  defaultModel: z.string().optional(),
  feishu: FeishuConfigSchema.optional(),
  slack: SlackConfigSchema.optional(),
  agent: z.object({
    // 禁用 PreferenceDetector（用户偏好检测）
    disablePreferenceDetector: z.boolean().default(false),
    // 禁用 EvolutionProposer（演变提议生成）
    disableEvolutionProposer: z.boolean().default(false),
  }).optional(),
  channels: z.object({
    httpWs: z.object({
      enabled: z.boolean().default(true),
    }).optional(),
    feishu: FeishuConfigSchema.optional(),
    slack: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().optional(),
      signingSecret: z.string().optional(),
      appToken: z.string().optional(),
    }).optional(),
    dingtalk: z.object({
      enabled: z.boolean().default(false),
      agentId: z.string().optional(),
      appKey: z.string().optional(),
      appSecret: z.string().optional(),
      corpId: z.string().optional(),
    }).optional(),
    wecom: z.object({
      enabled: z.boolean().default(false),
      corpId: z.string().optional(),
      secret: z.string().optional(),
      agentId: z.string().optional(),
    }).optional(),
    whatsapp: z.object({
      enabled: z.boolean().default(false),
      phoneNumberId: z.string().optional(),
      accessToken: z.string().optional(),
      webhookVerifyToken: z.string().optional(),
    }).optional(),
    wechat: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
    }).optional(),
  }).optional(),
  feishuInstances: z.array(FeishuInstanceSchema).optional().default([]),
  plugins: z.array(PluginSchema).default([]).transform(
    plugins => plugins.map(p => typeof p === 'string' ? { name: p, enabled: true } : p
  )),
  memory: z.object({
    enabled: z.boolean().default(true),
    vectorDimension: z.number().default(1536),
    /** 用于生成 embedding 的模型名称（对应 models 列表中的 name），不填则仅使用全文搜索 */
    embeddingModel: z.string().optional(),
  }).optional(),
  // 会话和上下文窗口配置
  session: z.object({
    // 传入 LLM 的最大 token 预算（字符估算：英文约 4 字符/token，中文约 2 字符/token）
    // 默认 80000 字符 ≈ 约 30K tokens，为大多数模型留出足够空间
    maxInputChars: z.number().default(80000),
    // 单个会话最多保留的消息条数（超出时裁掉最旧的消息）
    maxMessages: z.number().default(100),
    // 会话不活跃多少天后自动归档（设为 0 禁用）
    ttlDays: z.number().default(30),
  }).optional(),
  workspace: z.string().optional(),
  // 允许 Agent 访问的宿主机目录列表（需要手动在 docker-compose.yml 中挂载）
  allowedPaths: z.array(z.string()).optional().default([]),
  // Office 文件预览服务器配置
  officePreviewServer: z.string().optional(),
  // 默认禁用所有 skills，只有在这里列出的才会启用
  enabledSkills: z.array(z.string()).optional().default([]),
  // 已废弃：使用 enabledSkills 代替
  disabledSkills: z.array(z.string()).optional().default([]),
  // 禁用的外部插件列表（plugins/目录下的插件）
  disabledPlugins: z.array(z.string()).optional().default([]),
  // Agent 性格配置
  activeProfile: z.string().optional().default('default'),
  // 存储配置
  storage: StorageSchema.optional(),
  // 邮件配置
  email: EmailConfigSchema.optional(),
  // Firecrawl 网页搜索 API Key
  firecrawlApiKey: z.string().optional(),
  // Agent Teams 配置
  agentTeams: z.array(AgentTeamSchema).optional().default([]),

  // ============================================
  // SDK 插件配置
  // ============================================

  // 是否使用 SDK plugin 模式（默认 true）
  // 启用后，将通过 options.plugins 和 options.mcpServers 加载插件
  useSdkPlugins: z.boolean().optional().default(true),

  // 全局 MCP 服务器配置（优先级最高）
  // 格式与 SDK mcpServers 一致，直接传递给 Claude Agent SDK
  mcpServers: z.record(z.string(), z.union([
    z.object({
      type: z.literal('stdio'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      type: z.literal('sse'),
      url: z.string(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string(),
    }),
  ])).optional(),

  // 可靠性和错误处理配置
  reliability: z.object({
    enabled: z.boolean().default(true),
    circuitBreaker: z.object({
      enabled: z.boolean().default(true),
      failureThreshold: z.number().default(5),
      resetTimeoutMs: z.number().default(60000),
      monitoringWindowMs: z.number().default(120000),
    }).optional(),
    retry: z.object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().default(3),
      baseDelayMs: z.number().default(1000),
      maxDelayMs: z.number().default(30000),
      backoffStrategy: z.enum(['linear', 'exponential', 'fixed']).default('exponential'),
    }).optional(),
    errorReporting: z.object({
      enabled: z.boolean().default(true),
      logErrors: z.boolean().default(true),
      trackMetrics: z.boolean().default(true),
    }).optional(),
  }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelProtocol = z.infer<typeof ModelProtocolSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type StorageProviderConfig = z.infer<typeof StorageProviderSchema>;
export type StorageConfig = z.infer<typeof StorageSchema>;
export type ReliabilityConfig = z.infer<typeof ConfigSchema>['reliability'];

/**
 * 判断模型是否支持视觉理解（图像识别）
 * 仅当 capabilities.vision 显式设为 true 时才视为支持
 */
export function modelSupportsVision(mc: ModelConfig): boolean {
  return mc.capabilities?.vision === true;
}
