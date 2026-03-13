// src/plugins/feishu-advanced/task/index.ts

/**
 * Task (任务管理) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerTaskTaskTool } from './task.js';
import { registerTaskTasklistTool } from './tasklist.js';
import { registerTaskCommentTool } from './comment.js';
import { registerTaskSubtaskTool } from './subtask.js';

/**
 * 注册所有 Task 工具
 */
export async function registerTaskTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[task] Registering Task tools...');

  // 注册任务管理工具
  registerTaskTaskTool(registry, context);

  // 注册任务清单管理工具
  registerTaskTasklistTool(registry, context);

  // 注册任务评论管理工具
  registerTaskCommentTool(registry, context);

  // 注册子任务管理工具
  registerTaskSubtaskTool(registry, context);

  logger.info('[task] Task tools registered');
}