// src/plugins/feishu-advanced/calendar/index.ts

/**
 * Calendar (日历) 工具注册
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import { registerCalendarEventTool } from './event.js';
import { registerCalendarCalendarTool } from './calendar.js';
import { registerCalendarEventAttendeeTool } from './event-attendee.js';
import { registerCalendarFreebusyTool } from './freebusy.js';

/**
 * 注册所有 Calendar 工具
 */
export async function registerCalendarTools(
  registry: ToolRegistry,
  context: PluginToolContext
): Promise<void> {
  const { logger } = context;

  logger.info('[calendar] Registering Calendar tools...');

  // 注册日程管理工具
  registerCalendarEventTool(registry, context);

  // 注册日历管理工具
  registerCalendarCalendarTool(registry, context);

  // 注册日程参会人管理工具
  registerCalendarEventAttendeeTool(registry, context);

  // 注册忙闲查询工具
  registerCalendarFreebusyTool(registry, context);

  logger.info('[calendar] Calendar tools registered');
}