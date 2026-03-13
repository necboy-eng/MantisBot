// src/plugins/feishu-advanced/chat/index.ts

/**
 * Chat (群聊) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerChatTool } from './chat.js';
import { registerChatMembersTool } from './members.js';

/**
 * 注册所有 Chat 工具
 */
export async function registerChatTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[chat] Registering Chat tools...');

  // 注册群聊管理工具
  registerChatTool(registry, context);

  // 注册群成员管理工具
  registerChatMembersTool(registry, context);

  logger.info('[chat] Chat tools registered');
}