// src/config/loader.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Config, ConfigSchema } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let config: Config | null = null;

export function loadConfig(configPath?: string): Config {
  const path = configPath || join(__dirname, '../../config/config.json');

  try {
    // 检查配置文件是否存在
    if (!existsSync(path)) {
      console.log('[Config] Config file not found, creating default config...');
      const defaultCfg = getDefaultConfig();

      // 确保目录存在
      const configDir = dirname(path);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // 写入默认配置文件
      writeFileSync(path, JSON.stringify(defaultCfg, null, 2), 'utf-8');
      console.log('[Config] Default config created at:', path);

      config = defaultCfg;
      return config;
    }

    const content = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content);
    config = ConfigSchema.parse(parsed);
    return config!;
  } catch (error) {
    console.warn('[Config] Failed to load config, using defaults:', error);
    config = getDefaultConfig();
    return config;
  }
}

export function getConfig(): Config {
  if (!config) {
    return loadConfig();
  }
  return config;
}

export function getDefaultConfig(): Config {
  return {
    server: {
      host: '0.0.0.0',
      port: 8118,
      cors: true,
      wsPath: '/ws',
      auth: {
        enabled: true,
        username: 'admin',
        password: 'sha256:059a00192592d5444bc0caad7203f98b506332e2cf7abb35d684ea9bf7c18f08',
      },
    },
    models: [
      {
        name: 'MiniMax',
        protocol: 'anthropic',
        model: 'MiniMax-M2.5',
        apiKey: process.env.MINIMAX_API_KEY || '',
        baseURL: 'https://api.minimaxi.com/anthropic',
      },
    ],
    defaultModel: 'MiniMax',
    agent: {
      disablePreferenceDetector: true,
      disableEvolutionProposer: true,
    },
    channels: {
      httpWs: {
        enabled: true,
      },
    },
    plugins: [
      { name: 'document', enabled: true },
      { name: 'logger', enabled: true },
      { name: 'browser', enabled: true },
    ],
    workspace: './data',
    allowedPaths: [],
    enabledSkills: [
      'pptx',
      'xlsx',
      'apple-notes',
      'apple-reminders',
      'bear-notes',
      'himalaya',
      'things-mac',
      'coding-agent',
      'skill-creator',
      'deep-research',
      'weather',
      'docx',
      'pdf',
      'stock-financial-data',
      'brainstorming',
    ],
    disabledSkills: [],
    disabledPlugins: [],
    activeProfile: 'default',
    agentTeams: [],
  } as Config;
}

export function updateConfig(updates: Partial<Config>): Config {
  const current = getConfig();
  config = { ...current, ...updates };
  return config;
}

export async function saveConfig(newConfig: Config): Promise<void> {
  try {
    const configPath = join(__dirname, '../../config/config.json');
    const configJson = JSON.stringify(newConfig, null, 2);
    writeFileSync(configPath, configJson, 'utf-8');
    config = newConfig; // 同步更新内存缓存，避免读到旧数据
    console.log('[Config] Configuration saved successfully');
  } catch (error) {
    console.error('[Config] Failed to save configuration:', error);
    throw error;
  }
}
