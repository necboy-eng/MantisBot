// src/env-isolation.ts
/**
 * 环境变量隔离模块
 *
 * 用于隔离 MantisBot 进程的环境变量，确保：
 * 1. 项目配置的 API Key、Base URL 等不会影响其他进程
 * 2. 本机全局的 Claude Code CLI 配置不会被 MantisBot 读取
 * 3. 只有白名单中的环境变量会被传递给 Claude Agent SDK
 */

import { getConfig } from './config/loader.js';

/**
 * 允许传递给 Claude Agent SDK 的环境变量白名单
 *
 * 参考 LobsterAI 的 SANDBOX_ALLOWED_ENV_KEYS 设计
 */
const ALLOWED_ENV_KEYS = [
  // Anthropic API 相关
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',

  // Firecrawl API
  'FIRECRAWL_API_KEY',

  // 代理设置
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',

  // 时区
  'TZ',
  'tz',

  // 系统路径（某些情况下需要）
  'PATH',
  'HOME',
  'USER',
  'TEMP',
  'TMP',
  'TMPDIR',
  // Claude Agent SDK 配置目录（重定向 .claude 写入路径，防止写入只读挂载导致权限错误）
  // SDK 逻辑：process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")
  'CLAUDE_CONFIG_DIR',

  // Node.js 相关
  'NODE_ENV',
  'NODE_PATH',
] as const;

/**
 * 构建隔离的环境变量对象
 *
 * @param overrideConfig - 可选的覆盖配置，优先级高于 config 文件
 * @returns 隔离后的环境变量对象
 */
export function buildIsolatedEnv(overrideConfig?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  // 1. 从 process.env 中提取白名单变量
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      env[key] = value;
    }
  }

  // 2. 从配置文件读取并覆盖
  try {
    const config = getConfig();
    const defaultModel = config.models?.find(m => m.name === config.defaultModel) || config.models?.[0];

    // API Key
    const apiKey = overrideConfig?.apiKey || defaultModel?.apiKey;
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    }

    // Base URL（支持 baseUrl 和 baseURL 两种拼写）
    const baseUrl = overrideConfig?.baseUrl || defaultModel?.baseUrl || defaultModel?.baseURL;
    if (baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl;
    }

    // Model：优先用 overrideConfig 传入的值（应为真实 API 模型 ID，如 "glm-5"）
    // 回退时用 defaultModel.model（真实 ID），而非 .name（显示名，如 "GLM-5-Aliyun"）
    const model = overrideConfig?.model || defaultModel?.model || config.defaultModel || defaultModel?.name;
    if (model) {
      env.ANTHROPIC_MODEL = model;
    }

    // Firecrawl API Key（config 优先，环境变量兜底已在步骤 1 处理）
    if (config.firecrawlApiKey) {
      env.FIRECRAWL_API_KEY = config.firecrawlApiKey;
    }
  } catch (error) {
    console.warn('[EnvIsolation] Failed to load config:', error);
  }

  // 3. 应用覆盖配置（最高优先级）
  if (overrideConfig?.apiKey) {
    env.ANTHROPIC_API_KEY = overrideConfig.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = overrideConfig.apiKey;
  }
  if (overrideConfig?.baseUrl) {
    env.ANTHROPIC_BASE_URL = overrideConfig.baseUrl;
  }
  if (overrideConfig?.model) {
    env.ANTHROPIC_MODEL = overrideConfig.model;
  }

  return env;
}

/**
 * 应用隔离的环境变量到当前进程
 *
 * 注意：这会修改 process.env，但只影响当前进程及其子进程
 * 不会影响父进程、兄弟进程或其他独立程序
 *
 * @param overrideConfig - 可选的覆盖配置
 */
export function applyIsolatedEnv(overrideConfig?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): void {
  const isolatedEnv = buildIsolatedEnv(overrideConfig);

  // 清除不在白名单中的 ANTHROPIC_* 变量
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ANTHROPIC_') && !ALLOWED_ENV_KEYS.includes(key as typeof ALLOWED_ENV_KEYS[number])) {
      delete process.env[key];
    }
  }

  // 应用隔离的环境变量
  for (const [key, value] of Object.entries(isolatedEnv)) {
    process.env[key] = value;
  }

  console.log('[EnvIsolation] Applied isolated environment variables');
  console.log('[EnvIsolation] ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
  console.log('[EnvIsolation] ANTHROPIC_MODEL:', process.env.ANTHROPIC_MODEL || '(not set)');
  console.log('[EnvIsolation] API Key:', process.env.ANTHROPIC_API_KEY ? '***set***' : '(not set)');
}

/**
 * 获取当前隔离环境中的 API 配置
 */
export function getIsolatedApiConfig(): {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string | undefined;
} {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL,
  };
}
