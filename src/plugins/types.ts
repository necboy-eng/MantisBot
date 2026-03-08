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
  type: 'http' | 'sse' | 'stdio';
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
