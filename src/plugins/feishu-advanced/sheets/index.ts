// src/plugins/feishu-advanced/sheets/index.ts

/**
 * Sheets (电子表格) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerSheetTool } from './sheet.js';

/**
 * 注册所有 Sheets 工具
 */
export async function registerSheetsTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[sheets] Registering Sheets tools...');

  // 注册电子表格管理工具
  registerSheetTool(registry, context);

  logger.info('[sheets] Sheets tools registered');
}