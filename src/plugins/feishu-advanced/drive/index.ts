// src/plugins/feishu-advanced/drive/index.ts

/**
 * Drive (云盘) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerDriveFileTool } from './file.js';
import { registerDocCommentsTool } from './doc-comments.js';
import { registerDocMediaTool } from './doc-media.js';

/**
 * 注册所有 Drive 工具
 */
export async function registerDriveTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[drive] Registering Drive tools...');

  // 注册文件管理工具
  registerDriveFileTool(registry, context);

  // 注册文档评论工具
  registerDocCommentsTool(registry, context);

  // 注册文档媒体工具
  registerDocMediaTool(registry, context);

  logger.info('[drive] Drive tools registered');
}