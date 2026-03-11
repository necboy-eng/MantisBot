// src/plugins/marketplace.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PluginManifest, MarketplaceSource, PluginSearchResult } from './types.js';

/**
 * Marketplace Client for discovering and downloading plugins
 */
export class MarketplaceClient {
  private sources: MarketplaceSource[] = [
    {
      type: 'github',
      url: 'https://github.com/anthropics/knowledge-work-plugins',
      name: 'anthropics'
    },
  ];

  /**
   * Add a marketplace source
   */
  addSource(source: MarketplaceSource): void {
    this.sources.push(source);
  }

  /**
   * Get all sources
   */
  getSources(): MarketplaceSource[] {
    return [...this.sources];
  }

  /**
   * Search for plugins across all sources
   */
  async search(query: string): Promise<PluginSearchResult[]> {
    const results: PluginSearchResult[] = [];

    for (const source of this.sources) {
      if (source.type === 'github') {
        const githubResults = await this.searchGitHub(source, query);
        results.push(...githubResults);
      }
    }

    return results;
  }

  private async searchGitHub(source: MarketplaceSource, query: string): Promise<PluginSearchResult[]> {
    // Use GitHub API to search for repositories
    // For now, return known plugins from anthropics/knowledge-work-plugins
    const knownPlugins = [
      'productivity',
      'sales',
      'customer-support',
      'product-management',
      'marketing',
      'legal',
      'finance',
      'data',
      'enterprise-search',
      'bio-research',
    ];

    const queryLower = query.toLowerCase();
    const filtered = knownPlugins.filter(p => p.toLowerCase().includes(queryLower));

    return filtered.map(name => ({
      name,
      description: `${name} plugin from anthropics/knowledge-work-plugins`,
      author: 'Anthropic',
      stars: 7600,
      version: '1.0.0',
      source: `github:anthropics/knowledge-work-plugins/${name}`,
    }));
  }

  /**
   * Download a plugin from a source
   * Source formats:
   * - github:owner/repo/plugin-name
   * - https://github.com/owner/repo/archive/refs/heads/main.zip
   */
  async download(source: string): Promise<string> {
    // Parse source
    const match = source.match(/github:([^/]+)\/([^/]+)(?:\/(.+))?/);
    if (!match) {
      throw new Error(`Invalid source format: ${source}. Expected: github:owner/repo/plugin-name`);
    }

    const [, owner, repo, pluginPath] = match;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantisbot-plugin-'));

    try {
      if (pluginPath) {
        // Download specific plugin from a repo
        // For example: github:anthropics/knowledge-work-plugins/productivity
        const pluginUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}`;

        // Fetch plugin directory listing
        const response = await fetch(pluginUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch plugin: ${response.statusText}`);
        }

        const contents = await response.json() as Array<{ name: string; type: string; download_url?: string }>;

        // Create plugin directory
        const targetDir = path.join(tempDir, pluginPath);
        await fs.mkdir(targetDir, { recursive: true });

        // Download each file
        for (const item of contents) {
          if (item.type === 'file' && item.download_url) {
            const fileResponse = await fetch(item.download_url);
            const fileContent = await fileResponse.text();
            await fs.writeFile(path.join(targetDir, item.name), fileContent);
          } else if (item.type === 'dir') {
            // Handle subdirectories (like skills/xxx/)
            const subDirResponse = await fetch(item.download_url || `${pluginUrl}/${item.name}`, {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
              },
            });
            const subContents = await subDirResponse.json() as Array<{ name: string; type: string; download_url?: string }>;
            const subTargetDir = path.join(targetDir, item.name);
            await fs.mkdir(subTargetDir, { recursive: true });

            for (const subItem of subContents) {
              if (subItem.type === 'file' && subItem.download_url) {
                const fileResponse = await fetch(subItem.download_url);
                const fileContent = await fileResponse.text();
                await fs.writeFile(path.join(subTargetDir, subItem.name), fileContent);
              }
            }
          }
        }

        console.log(`[Marketplace] Downloaded plugin to: ${targetDir}`);
        return targetDir;
      } else {
        // Download entire repo
        console.warn('[MCP] Full repo download not implemented');
        return tempDir;
      }
    } catch (error) {
      // Clean up on error
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Get plugin info from a source
   */
  async getInfo(source: string): Promise<PluginManifest> {
    const match = source.match(/github:([^/]+)\/([^/]+)(?:\/(.+))?/);
    if (!match) {
      throw new Error(`Invalid source format: ${source}`);
    }

    const [, owner, repo, pluginPath] = match;

    // Construct raw URL for plugin.json
    let url: string;
    if (pluginPath) {
      url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${pluginPath}/plugin.json`;
    } else {
      url = `https://raw.githubusercontent.com/${owner}/${repo}/main/plugin.json`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch plugin info: ${response.statusText}`);
    }

    return await response.json() as PluginManifest;
  }
}
