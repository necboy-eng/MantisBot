// src/agents/tools/registry.ts

import type { Tool, ToolInfo, ToolUserContext } from '../../types.js';
import { loggerTool } from './logger.js';
import { readSkillTool } from './read-skill.js';
import { sendFileTool } from './send-file.js';
import { browserTools } from './browser.js';
import { memorySearchTool } from './memory-search.js';
import { rememberTool } from './remember.js';
import { firecrawlTool } from './firecrawl.js';
import { crawl4aiTool } from './crawl4ai.js';

const builtInTools: Record<string, Tool> = {
  logger: loggerTool,
  read_skill: readSkillTool,
  send_file: sendFileTool,
  memory_search: memorySearchTool,
  remember: rememberTool,
  firecrawl: firecrawlTool,
  crawl4ai: crawl4aiTool
};

// Browser 工具（数组形式）
const browserToolsArray: Tool[] = browserTools;

// 核心工具（总是可用）- 注意：Read/Write/Edit/Bash 由 SDK 内置处理，不走 MCP
const CORE_TOOLS = ['read_skill', 'send_file', 'memory_search', 'remember', 'crawl4ai'];

export interface ToolRegistryOptions {
  enabledPlugins?: string[];
  firecrawlApiKey?: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor(options: ToolRegistryOptions = {}) {
    const { enabledPlugins = [], firecrawlApiKey } = options;

    // Load core tools (always available)
    for (const name of CORE_TOOLS) {
      if (builtInTools[name]) {
        this.tools.set(name, builtInTools[name]);
      }
    }

    // Load firecrawl only if API key is configured
    if (firecrawlApiKey) {
      if (builtInTools['firecrawl']) {
        this.tools.set('firecrawl', builtInTools['firecrawl']);
      }
    }

    // Load built-in tools from config
    for (const name of enabledPlugins) {
      if (builtInTools[name] && name !== 'firecrawl') { // firecrawl 单独处理
        this.tools.set(name, builtInTools[name]);
      }
    }

    // Load browser tools if 'browser' is enabled
    if (enabledPlugins.includes('browser')) {
      for (const tool of browserToolsArray) {
        this.tools.set(tool.name, tool);
      }
    }

    // Register Feishu tools (新增)
    this.registerFeishuTools();
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolInfo[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  /**
   * 获取工具列表（listTools 别名）
   */
  list(): ToolInfo[] {
    return this.listTools();
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async executeTool(name: string, params: Record<string, unknown>, context?: ToolUserContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(params, context);
  }

  /**
   * 执行工具（executeTool 别名）
   */
  async execute(name: string, params: Record<string, unknown>, context?: ToolUserContext): Promise<unknown> {
    return this.executeTool(name, params, context);
  }

  /**
   * 注册飞书工具（新增）
   */
  registerFeishuTools(): void {
    import('./feishu/index.js').then((module: any) => {
      module.registerFeishuTools(this).catch(console.error);
    });
  }

  /**
   * 获取飞书配置（新增）
   * 用于工具注册时读取配置
   */
  async getFeishuConfig(): Promise<any | undefined> {
    const { getConfig } = await import('../../config/loader.js');
    const config = getConfig();
    return (config.channels as any)?.feishu;
  }
}
