// src/plugins/feishu-advanced/tool-scopes.ts

/**
 * 飞书工具权限映射
 *
 * 定义每个工具操作所需的飞书用户权限 (user scopes)
 */

/**
 * 工具动作到所需权限的映射
 */
export const TOOL_SCOPES: Record<string, string[]> = {
  // Bitable (多维表格) 相关权限
  'feishu_bitable_app.create': ['bitable:app', 'base:app:create'],
  'feishu_bitable_app.get': ['bitable:app', 'base:app:read'],
  'feishu_bitable_app.list': ['drive:drive', 'drive:drive:readonly', 'space:document:retrieve'],
  'feishu_bitable_app.patch': ['bitable:app', 'base:app:update'],
  'feishu_bitable_app.copy': ['bitable:app', 'base:app:copy'],

  'feishu_bitable_app_table.create': ['bitable:app', 'base:table:create'],
  'feishu_bitable_app_table.list': ['bitable:app', 'base:table:read'],
  'feishu_bitable_app_table.patch': ['bitable:app', 'base:table:update'],
  'feishu_bitable_app_table.delete': ['bitable:app', 'base:table:delete'],

  'feishu_bitable_app_table_field.create': ['bitable:app', 'base:field:create'],
  'feishu_bitable_app_table_field.list': ['bitable:app', 'base:field:read'],
  'feishu_bitable_app_table_field.update': ['bitable:app', 'base:field:read', 'base:field:update'],
  'feishu_bitable_app_table_field.delete': ['bitable:app', 'base:field:delete'],

  'feishu_bitable_app_table_record.create': ['bitable:app', 'base:record:create'],
  'feishu_bitable_app_table_record.list': ['bitable:app', 'base:record:retrieve'],
  'feishu_bitable_app_table_record.update': ['bitable:app', 'base:record:update'],
  'feishu_bitable_app_table_record.delete': ['bitable:app', 'base:record:delete'],

  // Task (任务) 相关权限
  'feishu_task_task.create': ['task:task:write'],
  'feishu_task_task.get': ['task:task:read'],
  'feishu_task_task.list': ['task:task:read'],
  'feishu_task_task.patch': ['task:task:write'],

  // Calendar (日历) 相关权限
  'feishu_calendar_event.create': ['calendar:calendar.event:create', 'calendar:calendar.event:update'],
  'feishu_calendar_event.get': ['calendar:calendar.event:read'],
  'feishu_calendar_event.list': ['calendar:calendar.event:read'],
  'feishu_calendar_event.patch': ['calendar:calendar.event:update'],
  'feishu_calendar_event.delete': ['calendar:calendar.event:delete'],

  // Drive (云盘) 相关权限
  'feishu_drive_file.list': ['drive:drive', 'drive:drive:readonly', 'space:document:retrieve'],
  'feishu_drive_file.get_meta': ['drive:drive.metadata:readonly'],
  'feishu_drive_file.upload': ['drive:file:upload'],
  'feishu_drive_file.download': ['drive:file:download'],

  // Wiki (知识库) 相关权限
  'feishu_wiki_space.list': ['wiki:space:retrieve'],
  'feishu_wiki_space.get': ['wiki:space:read'],
  'feishu_wiki_space_node.list': ['wiki:node:retrieve'],
  'feishu_wiki_space_node.get': ['wiki:node:read'],

  // Sheets (电子表格) 相关权限
  'feishu_sheet.read': ['sheets:spreadsheet:read'],
  'feishu_sheet.write': ['sheets:spreadsheet:read', 'sheets:spreadsheet:write_only'],
};

/**
 * 获取工具操作所需的权限
 */
export function getRequiredScopes(toolAction: string): string[] {
  return TOOL_SCOPES[toolAction] || [];
}

/**
 * 默认请求的权限集合
 * 包含大部分常用功能需要的权限
 */
export const DEFAULT_SCOPES = [
  // Bitable (多维表格)
  'bitable:app',
  'base:app:create',
  'base:app:read',
  'base:app:update',
  'base:table:create',
  'base:table:read',
  'base:table:update',
  'base:table:delete',
  'base:field:create',
  'base:field:read',
  'base:field:update',
  'base:field:delete',
  'base:record:create',
  'base:record:retrieve',
  'base:record:update',
  'base:record:delete',

  // Drive (云盘)
  'drive:drive',
  'drive:drive:readonly',
  'drive:file:upload',
  'drive:file:download',
  'space:document:retrieve',

  // Task (任务)
  'task:task:read',
  'task:task:write',
  'task:tasklist:read',
  'task:tasklist:write',

  // Calendar (日历)
  'calendar:calendar:read',
  'calendar:calendar.event:read',
  'calendar:calendar.event:create',
  'calendar:calendar.event:update',
  'calendar:calendar.event:delete',

  // Wiki (知识库)
  'wiki:space:retrieve',
  'wiki:space:read',
  'wiki:node:retrieve',
  'wiki:node:read',

  // Sheets (电子表格)
  'sheets:spreadsheet:read',
  'sheets:spreadsheet:write_only',

  // 离线访问 (获取 refresh token)
  'offline_access',
];

/**
 * 合并多个工具操作所需的权限（去重）
 */
export function mergeScopes(toolActions: string[]): string[] {
  const scopeSet = new Set<string>();
  for (const action of toolActions) {
    const scopes = TOOL_SCOPES[action] || [];
    for (const scope of scopes) {
      scopeSet.add(scope);
    }
  }
  // 确保 offline_access 在最后
  scopeSet.add('offline_access');
  return [...scopeSet];
}