// src/agents/tools/feishu/index.ts

import type { ToolRegistry } from '../registry.js';
import { getMessagesTool } from './im/get-messages.js';
import { getThreadMessagesTool } from './im/get-thread-messages.js';
import { searchMessagesTool } from './im/search-messages.js';

/**
 * 注册所有飞书工具到 ToolRegistry
 */
export async function registerFeishuTools(registry: ToolRegistry): Promise<void> {
  console.log('[FeishuTools] Registering Feishu tools...');

  const config = await registry.getFeishuConfig();
  if (!config) {
    console.log('[FeishuTools] Feishu not enabled, skipping');
    return;
  }

  const permissions = config.permissions || {};

  // IM 消息读取
  if (permissions.im?.enabled !== false) {
    console.log('[FeishuTools] Registering IM tools');
    registry.registerTool(getMessagesTool);
    registry.registerTool(getThreadMessagesTool);
    registry.registerTool(searchMessagesTool);
  } else {
    console.log('[FeishuTools] IM tools disabled by config');
  }

  // TODO: 后续添加其他工具
  // - 文档工具 (doc)
  // - Bitable 工具 (bitable)
  // - 任务管理工具 (task)
  // - 日历工具 (calendar)

  console.log('[FeishuTools] Feishu tools registered successfully');
}

/**
 * 导出所有工具（用于单独测试）
 */
export const feishuTools = {
  // IM
  feishu_im_get_messages: getMessagesTool,
  feishu_im_get_thread_messages: getThreadMessagesTool,
  feishu_im_user_search_messages: searchMessagesTool,

  // TODO: 后续添加
  // feishu_fetch_doc: fetchDocTool,
  // feishu_create_doc: createDocTool,
  // feishu_update_doc: updateDocTool,
  // feishu_task_task: taskTool,
  // feishu_calendar_event: calendarTool,
};
