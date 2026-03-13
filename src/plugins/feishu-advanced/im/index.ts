// src/plugins/feishu-advanced/im/index.ts

/**
 * IM 模块入口
 * 包含消息管理相关工具
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerImUserMessageTool } from './message.js';
import { registerMessageReadTools } from './message-read.js';
import { registerImUserFetchResourceTool } from './resource.js';

export function registerImTools(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  registerImUserMessageTool(registry, context);
  registerMessageReadTools(registry, context);
  registerImUserFetchResourceTool(registry, context);
}