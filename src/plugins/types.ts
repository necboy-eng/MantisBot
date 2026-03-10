// src/plugins/types.ts

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
  };
  repository?: string;
  license?: string;
  keywords?: string[];
  engines?: {
    mantisbot?: string;
  };
  dependencies?: {
    plugins?: string[];
  };
  mcp?: {
    servers?: string[];
  };
  commands?: string[];
  skills?: string[];
}

export interface Plugin {
  name: string;
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  skills: Skill[];
  commands: Command[];
  mcpConfig?: MCPConfig;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  pluginName: string;
  filePath: string;  // 用于 read_skill 工具定位文件
}

export interface Command {
  name: string;
  description: string;
  content: string;
  pluginName: string;
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  type?: 'http' | 'sse' | 'stdio';  // 可选，会自动推断
  url?: string;
  command?: string;
  args?: string[];
  auth?: {
    type: 'bearer' | 'api_key' | 'basic';
    token?: string;
    header?: string;
    value?: string;
  };
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface MCPConnection {
  serverName: string;
  config: MCPServerConfig;
  client: any;
}

export interface MarketplaceSource {
  type: 'github' | 'npm' | 'local' | 'custom';
  url: string;
  name: string;
}

export interface PluginSearchResult {
  name: string;
  description: string;
  author: string;
  stars: number;
  version: string;
  source: string;
}

// Command types
export interface CommandHandler {
  (args: string[], context: CommandContext): Promise<CommandResult>;
}

export interface CommandContext {
  channel: any;
  sessionId: string;
  userId: string;
}

export interface CommandResult {
  message?: string;
  attachments?: any[];
}

// ============================================
// SDK 兼容类型
// ============================================

/**
 * SDK Plugin 配置格式
 * 用于 options.plugins 参数
 */
export interface SdkPluginConfig {
  type: 'local';
  path: string;
}

/**
 * SDK MCP Server 配置格式（stdio）
 */
export interface SdkMcpStdioConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * SDK MCP Server 配置格式（sse）
 * @deprecated SSE is deprecated, prefer http
 */
export interface SdkMcpSseConfig {
  type: 'sse';
  url: string;
}

/**
 * SDK MCP Server 配置格式（http）
 */
export interface SdkMcpHttpConfig {
  type: 'http';
  url: string;
}

/**
 * SDK MCP Server 配置联合类型
 */
export type SdkMcpServerConfig = SdkMcpStdioConfig | SdkMcpSseConfig | SdkMcpHttpConfig;

/**
 * 将内部 MCPServerConfig 转换为 SDK 格式
 * 自动推断类型：
 * - 有 command 字段 → stdio
 * - 有 url 字段 → http
 */
export function toSdkMcpConfig(config: MCPServerConfig): SdkMcpServerConfig {
  // 自动推断类型
  const inferredType = config.type || (config.command ? 'stdio' : config.url ? 'http' : 'stdio');

  switch (inferredType) {
    case 'stdio':
      return {
        type: 'stdio',
        command: config.command || '',
        args: config.args,
        env: config.env,
      };
    case 'sse':
      return {
        type: 'sse',
        url: config.url || '',
      };
    case 'http':
      return {
        type: 'http',
        url: config.url || '',
      };
    default:
      // 默认使用 stdio
      return {
        type: 'stdio',
        command: config.command || '',
        args: config.args,
        env: config.env,
      };
  }
}
