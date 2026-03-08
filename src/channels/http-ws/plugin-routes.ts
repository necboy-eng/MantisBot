// src/channels/http-ws/plugin-routes.ts

import { Express, Request, Response } from 'express';
import { PluginLoader } from '../../plugins/loader.js';
import { getConfig, saveConfig } from '../../config/loader.js';
import { refreshSkillsPrompt } from '../../agents/llm-client.js';

export function createPluginRoutes(app: Express, pluginLoader: PluginLoader): void {
  // GET /api/plugins - List all plugins
  app.get('/api/plugins', async (_req: Request, res: Response) => {
    try {
      const plugins = pluginLoader.getAllPlugins();
      const pluginInfos = plugins.map(p => ({
        name: p.name,
        version: p.manifest.version,
        description: p.manifest.description,
        author: typeof p.manifest.author === 'string'
          ? p.manifest.author
          : p.manifest.author?.name,
        enabled: p.enabled,
        skillsCount: p.skills.length,
        commandsCount: p.commands.length,
        path: p.path,
      }));
      res.json(pluginInfos);
    } catch (error) {
      console.error('[API] Failed to get plugins:', error);
      res.status(500).json({ error: 'Failed to get plugins' });
    }
  });

  // GET /api/plugins/commands - List all plugin commands
  app.get('/api/plugins/commands', async (_req: Request, res: Response) => {
    try {
      const commands = pluginLoader.getCommands();
      const commandInfos = commands.map(c => ({
        name: `/${c.pluginName}:${c.name}`,
        description: c.description,
        pluginName: c.pluginName,
        content: c.content,
      }));
      res.json(commandInfos);
    } catch (error) {
      console.error('[API] Failed to get plugin commands:', error);
      res.status(500).json({ error: 'Failed to get plugin commands' });
    }
  });

  // GET /api/plugins/:name - Get plugin details
  app.get('/api/plugins/:name', async (req: Request, res: Response) => {
    try {
      const pluginName = req.params.name;
      const plugin = pluginLoader.getPlugin(pluginName);

      if (!plugin) {
        res.status(404).json({ error: `Plugin not found: ${pluginName}` });
        return;
      }

      res.json({
        name: plugin.name,
        manifest: plugin.manifest,
        enabled: plugin.enabled,
        skills: plugin.skills.map(s => ({
          name: s.name,
          description: s.description,
        })),
        commands: plugin.commands.map(c => ({
          name: c.name,
          description: c.description,
        })),
        path: plugin.path,
      });
    } catch (error) {
      console.error('[API] Failed to get plugin:', error);
      res.status(500).json({ error: 'Failed to get plugin' });
    }
  });

  // GET /api/plugins/:name/skills - Get plugin skills
  app.get('/api/plugins/:name/skills', async (req: Request, res: Response) => {
    try {
      const pluginName = req.params.name;
      const plugin = pluginLoader.getPlugin(pluginName);

      if (!plugin) {
        res.status(404).json({ error: `Plugin not found: ${pluginName}` });
        return;
      }

      res.json(plugin.skills);
    } catch (error) {
      console.error('[API] Failed to get plugin skills:', error);
      res.status(500).json({ error: 'Failed to get plugin skills' });
    }
  });

  // POST /api/plugins/:name/toggle - Toggle plugin enabled/disabled
  app.post('/api/plugins/:name/toggle', async (req: Request, res: Response) => {
    try {
      const pluginName = req.params.name;
      const plugin = pluginLoader.getPlugin(pluginName);

      if (!plugin) {
        res.status(404).json({ error: `Plugin not found: ${pluginName}` });
        return;
      }

      // 切换启用状态
      const newEnabled = !plugin.enabled;
      plugin.enabled = newEnabled;

      // 更新配置文件中的 disabledPlugins 列表
      const config = getConfig();
      const disabledPlugins = new Set(config.disabledPlugins || []);

      if (newEnabled) {
        disabledPlugins.delete(pluginName);
      } else {
        disabledPlugins.add(pluginName);
      }

      config.disabledPlugins = Array.from(disabledPlugins);
      await saveConfig(config);

      console.log(`[API] Plugin ${pluginName} ${newEnabled ? 'enabled' : 'disabled'}`);

      // 刷新 skills prompt（启用/禁用插件后需要更新系统提示词)
      refreshSkillsPrompt();

      res.json({
        name: pluginName,
        enabled: plugin.enabled,
      });
    } catch (error) {
      console.error('[API] Failed to toggle plugin:', error);
      res.status(500).json({ error: 'Failed to toggle plugin' });
    }
  });
}
