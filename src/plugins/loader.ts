// src/plugins/loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Plugin, PluginManifest, Skill, Command, MCPConfig, SdkPluginConfig, SdkMcpServerConfig, toSdkMcpConfig, PluginToolRegisterFn, PluginToolContext, FeishuChannelConfig } from './types.js';
import type { ToolRegistry } from '../agents/tools/registry.js';

// 全局 PluginLoader 实例引用，用于刷新 skills prompt
let globalPluginLoader: PluginLoader | null = null;

export function setGlobalPluginLoader(loader: PluginLoader): void {
  globalPluginLoader = loader;
}

export function getGlobalPluginLoader(): PluginLoader | null {
  return globalPluginLoader;
}

export class PluginLoader {
  private pluginsDir: string;
  private loadedPlugins: Map<string, Plugin> = new Map();
  private disabledPlugins: Set<string> = new Set();

  constructor(pluginsDir: string = './plugins', disabledPlugins: string[] = []) {
    this.pluginsDir = pluginsDir;
    this.disabledPlugins = new Set(disabledPlugins);
  }

  /**
   * 更新禁用插件列表
   */
  setDisabledPlugins(disabledPlugins: string[]): void {
    this.disabledPlugins = new Set(disabledPlugins);
    // 更新已加载插件的启用状态
    for (const plugin of this.loadedPlugins.values()) {
      plugin.enabled = !this.disabledPlugins.has(plugin.name);
    }
  }

  async loadAll(): Promise<Plugin[]> {
    try {
      const stat = await fs.stat(this.pluginsDir);
      if (!stat.isDirectory()) {
        console.warn(`Plugins directory ${this.pluginsDir} does not exist, creating...`);
        await fs.mkdir(this.pluginsDir, { recursive: true });
        return [];
      }
    } catch {
      // 目录不存在，创建它
      await fs.mkdir(this.pluginsDir, { recursive: true });
      return [];
    }

    const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    const plugins: Plugin[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(this.pluginsDir, entry.name);
        try {
          const plugin = await this.load(pluginPath);
          plugins.push(plugin);
          this.loadedPlugins.set(plugin.name, plugin);
          console.log(`Loaded plugin: ${plugin.name} (${plugin.skills.length} skills, ${plugin.commands.length} commands)`);
        } catch (error) {
          console.error(`Failed to load plugin ${entry.name}:`, error);
        }
      }
    }

    return plugins;
  }

  async load(pluginPath: string): Promise<Plugin> {
    const manifestPath = path.join(pluginPath, 'plugin.json');

    try {
      await fs.access(manifestPath);
    } catch {
      throw new Error(`Invalid plugin at ${pluginPath}: missing plugin.json`);
    }

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestContent);

    // 加载 skills
    const skills = await this.loadSkills(pluginPath, manifest.name);

    // 加载 commands
    const commands = await this.loadCommands(pluginPath, manifest.name);

    // 解析 MCP 配置
    const mcpConfig = await this.loadMCPConfig(pluginPath);

    return {
      name: manifest.name,
      manifest,
      path: pluginPath,
      enabled: !this.disabledPlugins.has(manifest.name),
      skills,
      commands,
      mcpConfig,
    };
  }

  getPlugin(name: string): Plugin | undefined {
    return this.loadedPlugins.get(name);
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.loadedPlugins.values());
  }

  getSkills(): Skill[] {
    const allSkills: Skill[] = [];
    for (const plugin of Array.from(this.loadedPlugins.values())) {
      if (plugin.enabled) {
        allSkills.push(...plugin.skills);
      }
    }
    return allSkills;
  }

  getCommands(): Command[] {
    const allCommands: Command[] = [];
    for (const plugin of Array.from(this.loadedPlugins.values())) {
      if (plugin.enabled) {
        allCommands.push(...plugin.commands);
      }
    }
    return allCommands;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private parseSkillFrontmatter(content: string): { name: string; description: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return { name: '', description: '' };
    }

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);

    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      description: descMatch ? descMatch[1].trim() : '',
    };
  }

  private parseCommandFrontmatter(content: string): { name: string; description: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return { name: '', description: '' };
    }

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);

    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      description: descMatch ? descMatch[1].trim() : '',
    };
  }

  private async loadSkills(pluginPath: string, pluginName: string): Promise<Skill[]> {
    const skillsDir = path.join(pluginPath, 'skills');
    if (!await this.exists(skillsDir)) {
      return [];
    }

    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        if (await this.exists(skillPath)) {
          const content = await fs.readFile(skillPath, 'utf-8');
          const { name, description } = this.parseSkillFrontmatter(content);
          // 获取绝对路径
          const absolutePath = path.resolve(skillPath);
          skills.push({
            name: name || entry.name,
            description,
            content,
            pluginName,
            filePath: absolutePath,
          });
        }
      }
    }

    return skills;
  }

  private async loadCommands(pluginPath: string, pluginName: string): Promise<Command[]> {
    const commandsDir = path.join(pluginPath, 'commands');
    if (!await this.exists(commandsDir)) {
      return [];
    }

    const files = await fs.readdir(commandsDir);
    const commands: Command[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const commandPath = path.join(commandsDir, file);
        const content = await fs.readFile(commandPath, 'utf-8');
        const { name, description } = this.parseCommandFrontmatter(content);
        commands.push({
          name: name || file.replace('.md', ''),
          description,
          content,
          pluginName,
        });
      }
    }

    return commands;
  }

  private async loadMCPConfig(pluginPath: string): Promise<MCPConfig | undefined> {
    const mcpPath = path.join(pluginPath, '.mcp.json');
    if (!await this.exists(mcpPath)) {
      return undefined;
    }

    const content = await fs.readFile(mcpPath, 'utf-8');
    const parsed = JSON.parse(content);

    // 支持两种格式：
    // 1. SDK 官方格式: { "mcpServers": {...} }
    // 2. 内部格式: { "servers": {...} }
    if (parsed.mcpServers) {
      return { servers: parsed.mcpServers };
    }
    return parsed;
  }

  // ============================================
  // SDK 适配方法
  // ============================================

  /**
   * 转换为 SDK plugins 配置格式
   * 用于 Claude Agent SDK 的 options.plugins 参数
   */
  toSdkPlugins(): SdkPluginConfig[] {
    return this.getAllPlugins()
      .filter(p => p.enabled)
      .map(p => ({
        type: 'local' as const,
        path: p.path,
      }));
  }

  /**
   * 获取所有插件的 MCP 服务器配置（SDK 格式）
   * 合并所有启用插件的 .mcp.json 配置
   */
  getAllMcpServers(): Record<string, SdkMcpServerConfig> {
    const servers: Record<string, SdkMcpServerConfig> = {};

    for (const plugin of this.getAllPlugins()) {
      if (!plugin.enabled || !plugin.mcpConfig?.servers) {
        continue;
      }

      for (const [name, config] of Object.entries(plugin.mcpConfig.servers)) {
        // 使用 plugin-name_server-name 格式避免冲突
        const serverKey = `${plugin.name}-${name}`;
        servers[serverKey] = toSdkMcpConfig(config);
      }
    }

    return servers;
  }

  /**
   * 获取指定插件的 MCP 服务器配置（SDK 格式）
   */
  getPluginMcpServers(pluginName: string): Record<string, SdkMcpServerConfig> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin?.enabled || !plugin.mcpConfig?.servers) {
      return {};
    }

    const servers: Record<string, SdkMcpServerConfig> = {};
    for (const [name, config] of Object.entries(plugin.mcpConfig.servers)) {
      servers[name] = toSdkMcpConfig(config);
    }

    return servers;
  }

  /**
   * 获取所有启用的 skills（用于 SDK agents.skills 配置）
   */
  getEnabledSkillNames(): string[] {
    return this.getSkills().map(s => s.name);
  }

  /**
   * 获取所有启用的 commands（用于 SDK slash commands）
   * 返回格式：plugin-name:command-name
   */
  getEnabledCommandNames(): string[] {
    return this.getCommands().map(c => `${c.pluginName}:${c.name}`);
  }

  /**
   * 获取指定的 command
   * @param pluginName 插件名称
   * @param commandName 命令名称
   * @returns Command 对象，如果不存在则返回 undefined
   */
  getCommand(pluginName: string, commandName: string): Command | undefined {
    const plugin = this.loadedPlugins.get(pluginName);
    if (!plugin || !plugin.enabled) {
      return undefined;
    }
    return plugin.commands.find(c => c.name === commandName);
  }

  /**
   * 解析 command 格式的消息
   * @param message 用户消息，格式如 "/data:analyze sales data"
   * @returns 解析结果，包含 pluginName, commandName, args
   */
  parseCommandMessage(message: string): { pluginName: string; commandName: string; args: string } | null {
    // 检查是否为 plugin command 格式: /plugin:command args
    if (!message.startsWith('/') || !message.includes(':')) {
      return null;
    }

    // 移除开头的 /
    const withoutSlash = message.slice(1);
    const colonIndex = withoutSlash.indexOf(':');

    if (colonIndex === -1) {
      return null;
    }

    const pluginName = withoutSlash.slice(0, colonIndex);
    const rest = withoutSlash.slice(colonIndex + 1);

    // 分离 command name 和 args
    const spaceIndex = rest.indexOf(' ');
    const commandName = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1).trim();

    return { pluginName, commandName, args };
  }

  /**
   * 构建 command 的完整 prompt
   * @param command Command 对象
   * @param args 用户输入的参数
   * @returns 构建好的 prompt
   */
  buildCommandPrompt(command: Command, args: string): string {
    let prompt = command.content;

    // 解析 frontmatter 获取 argument-hint
    const frontmatterMatch = prompt.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const argHintMatch = frontmatter.match(/argument-hint:\s*(.+)/);

      // 如果有 argument-hint，尝试将 args 替换到 $1, $2 等占位符
      if (argHintMatch) {
        const argParts = args.split(/\s+/).filter(Boolean);
        for (let i = 0; i < argParts.length; i++) {
          prompt = prompt.replace(new RegExp(`\\$${i + 1}`, 'g'), argParts[i]);
        }
      }
    }

    // 移除 frontmatter，只保留实际内容
    prompt = prompt.replace(/^---\n[\s\S]*?\n---\n*/, '');

    // 如果还有 args 且没有占位符，追加到 prompt 末尾
    if (args && !prompt.includes('$1')) {
      prompt += `\n\nUser input: ${args}`;
    }

    return prompt;
  }

  // ============================================
  // 插件工具注册
  // ============================================

  /**
   * 注册所有插件的工具
   * 在 entry.ts 启动时调用，一次性注册
   * @param registry 工具注册表
   * @param config 应用配置
   */
  async registerPluginTools(
    registry: ToolRegistry,
    config: any
  ): Promise<void> {
    const feishuConfig = (config.channels as any)?.feishu as FeishuChannelConfig | undefined;

    const context: PluginToolContext = {
      config,
      feishuConfig,
      logger: {
        info: (msg: string) => console.log(msg),
        warn: (msg: string) => console.warn(msg),
        error: (msg: string) => console.error(msg),
      },
    };

    for (const plugin of this.getAllPlugins()) {
      if (!plugin.enabled) {
        continue;
      }

      // 检查是否有工具注册入口
      const toolsPath = plugin.manifest.extends?.tools;
      if (!toolsPath) {
        continue;
      }

      // 检查渠道依赖
      const deps = plugin.manifest.dependencies;
      if (deps?.channels && deps.channels.length > 0) {
        const allChannelsEnabled = deps.channels.every(ch => {
          const channelConfig = (config.channels as any)?.[ch];
          return channelConfig?.enabled === true;
        });

        if (!allChannelsEnabled) {
          console.log(`[Plugins] Skipping ${plugin.name}: required channels [${deps.channels.join(', ')}] not enabled`);
          continue;
        }
      }

      // 导入并调用注册函数
      try {
        console.log(`[Plugins] Registering tools for ${plugin.name}...`);
        const module = await import(`../../${toolsPath}`);
        if (module.register && typeof module.register === 'function') {
          await module.register(registry, context);
        } else {
          console.warn(`[Plugins] No register function found in ${toolsPath}`);
        }
      } catch (error) {
        console.error(`[Plugins] Failed to register tools for ${plugin.name}:`, error);
      }
    }
  }
}
