// src/plugins/feishu-advanced/common/index.ts

/**
 * Common 模块入口
 * 包含用户相关的工具
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerGetUserTool } from './get-user.js';
import { registerSearchUserTool } from './search-user.js';

export function registerCommonTools(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  registerGetUserTool(registry, context);
  registerSearchUserTool(registry, context);
}