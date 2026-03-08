// src/plugins/loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Plugin, PluginManifest, Skill, Command, MCPConfig } from './types';

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
    return JSON.parse(content);
  }
}
