// src/plugins/feishu-advanced/index.ts

import type { PluginToolRegisterFn, PluginToolContext } from '../../plugins/types.js';
import type { ToolRegistry } from '../../agents/tools/registry.js';
import { registerBitableTools } from './bitable/index.js';
import { registerTaskTools } from './task/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerWikiTools } from './wiki/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerSearchTools } from './search/index.js';
import { registerChatTools } from './chat/index.js';
import { registerFeishuAuthTool } from './auth/auth.js';
import { registerCommonTools } from './common/index.js';
import { registerImTools } from './im/index.js';

/**
 * 插件工具注册入口
 * 在 entry.ts 中被调用，启动时一次性注册
 */
export const register: PluginToolRegisterFn = async (
  registry: ToolRegistry,
  context: PluginToolContext
) => {
  const { feishuConfig, logger } = context;

  // 1. 检查飞书渠道是否启用
  if (!feishuConfig?.enabled) {
    logger.info('[feishu-advanced] Feishu channel not enabled, skipping plugin');
    return;
  }

  // 2. 检查必要配置
  if (!feishuConfig.appId || !feishuConfig.appSecret) {
    logger.warn('[feishu-advanced] Feishu appId/appSecret not configured, skipping plugin');
    return;
  }

  logger.info('[feishu-advanced] Registering tools...');

  // 注册授权工具（必须在最前面，其他工具依赖授权）
  registerFeishuAuthTool(registry, context);

  // 注册各类工具
  await registerBitableTools(registry, context);
  await registerTaskTools(registry, context);
  await registerCalendarTools(registry, context);
  await registerDriveTools(registry, context);
  await registerWikiTools(registry, context);
  await registerSheetsTools(registry, context);
  await registerSearchTools(registry, context);
  await registerChatTools(registry, context);
  registerCommonTools(registry, context);
  registerImTools(registry, context);

  logger.info('[feishu-advanced] Tools registered successfully');
};