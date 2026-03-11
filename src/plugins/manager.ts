// src/plugins/manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PluginLoader } from './loader.js';
import { MarketplaceClient } from './marketplace.js';
import { MCPClient } from './mcp-client.js';
import { Plugin, PluginSearchResult, MarketplaceSource } from './types.js';

/**
 * Plugin Manager - handles plugin lifecycle (install, uninstall, enable, disable)
 */
export class PluginManager {
  private loader: PluginLoader;
  private marketplace: MarketplaceClient;
  private mcpClient: MCPClient;
  private pluginsDir: string;

  constructor(pluginsDir: string = './plugins') {
    this.pluginsDir = pluginsDir;
    this.loader = new PluginLoader(pluginsDir);
    this.marketplace = new MarketplaceClient();
    this.mcpClient = new MCPClient();
  }

  /**
   * Initialize - load all installed plugins
   */
  async initialize(): Promise<void> {
    await this.loader.loadAll();
    console.log(`[PluginManager] Initialized with ${this.loader.getAllPlugins().length} plugins`);
  }

  /**
   * Get Plugin Loader instance
   */
  getLoader(): PluginLoader {
    return this.loader;
  }

  /**
   * Get Marketplace Client instance
   */
  getMarketplace(): MarketplaceClient {
    return this.marketplace;
  }

  /**
   * Get MCP Client instance
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  /**
   * List all installed plugins
   */
  list(): Plugin[] {
    return this.loader.getAllPlugins();
  }

  /**
   * Get a specific plugin
   */
  get(name: string): Plugin | undefined {
    return this.loader.getPlugin(name);
  }

  /**
   * Install a plugin from a source
   * Source formats:
   * - github:anthropics/knowledge-work-plugins/productivity
   * - https://github.com/.../plugin-name.tar.gz
   */
  async install(source: string): Promise<Plugin> {
    console.log(`[PluginManager] Installing plugin from: ${source}`);

    // 1. Download plugin from marketplace
    const tempPath = await this.marketplace.download(source);

    // 2. Extract plugin name from source
    const pluginName = this.extractPluginName(source);
    const targetPath = path.join(this.pluginsDir, pluginName);

    // 3. Check if already exists
    try {
      await fs.access(targetPath);
      // Already exists, remove it first
      await fs.rm(targetPath, { recursive: true, force: true });
      console.log(`[PluginManager] Removed existing plugin: ${pluginName}`);
    } catch {
      // Doesn't exist, that's fine
    }

    // 4. Move to plugins directory
    await fs.rename(tempPath, targetPath);
    console.log(`[PluginManager] Installed plugin to: ${targetPath}`);

    // 5. Load the plugin
    const plugin = await this.loader.load(targetPath);

    // 6. Connect MCP servers if configured
    if (plugin.mcpConfig) {
      await this.connectMCPServers(plugin.name, plugin.mcpConfig);
    }

    console.log(`[PluginManager] Successfully installed: ${plugin.name}`);
    return plugin;
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginName: string): Promise<void> {
    const plugin = this.loader.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    console.log(`[PluginManager] Uninstalling plugin: ${pluginName}`);

    // 1. Disconnect MCP servers
    await this.mcpClient.disconnectAll(pluginName);

    // 2. Remove plugin directory
    await fs.rm(plugin.path, { recursive: true, force: true });

    // 3. Unload from loader
    this.loader.getAllPlugins().filter(p => p.name === pluginName);

    console.log(`[PluginManager] Successfully uninstalled: ${pluginName}`);
  }

  /**
   * Enable a plugin
   */
  async enable(pluginName: string): Promise<void> {
    const plugin = this.loader.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    plugin.enabled = true;

    // Reconnect MCP servers if configured
    if (plugin.mcpConfig) {
      await this.connectMCPServers(plugin.name, plugin.mcpConfig);
    }

    console.log(`[PluginManager] Enabled plugin: ${pluginName}`);
  }

  /**
   * Disable a plugin
   */
  async disable(pluginName: string): Promise<void> {
    const plugin = this.loader.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    plugin.enabled = false;

    // Disconnect MCP servers
    await this.mcpClient.disconnectAll(pluginName);

    console.log(`[PluginManager] Disabled plugin: ${pluginName}`);
  }

  /**
   * Update a plugin to the latest version
   */
  async update(pluginName: string): Promise<Plugin> {
    const current = this.loader.getPlugin(pluginName);
    if (!current) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    // Extract source from repository URL
    const source = current.manifest.repository;
    if (!source) {
      throw new Error(`Plugin ${pluginName} has no repository URL`);
    }

    // Uninstall and reinstall
    await this.uninstall(pluginName);

    // Need to format the source properly
    // Example: https://github.com/anthropics/knowledge-work-plugins -> github:anthropics/knowledge-work-plugins/productivity
    const repoMatch = source.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new Error(`Cannot parse repository URL: ${source}`);
    }

    const newSource = `github:${repoMatch[1]}/${repoMatch[2]}/${pluginName}`;
    return await this.install(newSource);
  }

  /**
   * Search marketplace for plugins
   */
  async search(query: string): Promise<PluginSearchResult[]> {
    return await this.marketplace.search(query);
  }

  /**
   * Add a marketplace source
   */
  addSource(source: MarketplaceSource): void {
    this.marketplace.addSource(source);
  }

  /**
   * Connect MCP servers for a plugin
   */
  private async connectMCPServers(pluginName: string, mcpConfig: any): Promise<void> {
    if (!mcpConfig || !mcpConfig.mcpServers) {
      return;
    }

    const servers = mcpConfig.mcpServers;
    for (const [serverName, config] of Object.entries(servers)) {
      const fullServerName = `${pluginName}_${serverName}`;
      try {
        await this.mcpClient.connect(fullServerName, config as any);
      } catch (error) {
        console.error(`[PluginManager] Failed to connect MCP server ${fullServerName}:`, error);
      }
    }
  }

  /**
   * Extract plugin name from source
   */
  private extractPluginName(source: string): string {
    // github:anthropics/knowledge-work-plugins/productivity
    const match = source.match(/github:[^/]+\/[^/]+\/(.+)/);
    if (match && match[1]) {
      return match[1];
    }

    // Fallback to unknown
    return 'unknown';
  }
}
