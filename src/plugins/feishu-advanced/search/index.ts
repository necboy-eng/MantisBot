// src/plugins/feishu-advanced/search/index.ts

/**
 * Search (搜索) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerSearchDocWikiTool } from './doc-search.js';

/**
 * 注册所有 Search 工具
 */
export async function registerSearchTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[search] Registering Search tools...');

  // 注册文档与 Wiki 搜索工具
  registerSearchDocWikiTool(registry, context);

  // TODO: 后续可添加其他搜索工具
  // - feishu_search_user: 用户搜索

  logger.info('[search] Search tools registered');
}