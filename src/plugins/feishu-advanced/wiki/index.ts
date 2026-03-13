// src/plugins/feishu-advanced/wiki/index.ts

/**
 * Wiki (知识库) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerWikiSpaceTool } from './space.js';
import { registerWikiSpaceNodeTool } from './space-node.js';

/**
 * 注册所有 Wiki 工具
 */
export async function registerWikiTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[wiki] Registering Wiki tools...');

  // 注册知识库空间管理工具
  registerWikiSpaceTool(registry, context);

  // 注册知识库节点管理工具
  registerWikiSpaceNodeTool(registry, context);

  logger.info('[wiki] Wiki tools registered');
}