// src/plugins/feishu-advanced/bitable/index.ts

/**
 * Bitable (多维表格) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerBitableAppTool } from './app.js';
import { registerBitableAppTableTool } from './app-table.js';
import { registerBitableAppTableFieldTool } from './app-table-field.js';
import { registerBitableAppTableRecordTool } from './app-table-record.js';
import { registerBitableAppTableViewTool } from './app-table-view.js';

/**
 * 注册所有 Bitable 工具
 */
export async function registerBitableTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[bitable] Registering Bitable tools...');

  // 注册应用管理工具（创建/查询多维表格应用）
  registerBitableAppTool(registry, context);

  // 注册数据表管理工具（创建/查询数据表）
  registerBitableAppTableTool(registry, context);

  // 注册字段管理工具（创建/查询/更新字段）
  registerBitableAppTableFieldTool(registry, context);

  // 注册记录管理工具（创建/查询/更新/删除记录）
  registerBitableAppTableRecordTool(registry, context);

  // 注册视图管理工具（创建/查询/更新/删除视图）
  registerBitableAppTableViewTool(registry, context);

  logger.info('[bitable] Bitable tools registered');
}