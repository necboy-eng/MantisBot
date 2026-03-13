// src/plugins/feishu-advanced/scope-manager.ts

/**
 * 飞书 API Scope 管理
 * 维护各 API 所需权限的映射关系
 */

/**
 * API 所需权限映射表
 * 格式: 'apiName' => ['scope1', 'scope2', ...]
 *
 * Scope 说明:
 * - bitable:* - 多维表格权限
 * - task:* - 任务权限
 * - calendar:* - 日历权限
 * - drive:* - 云盘权限
 * - wiki:* - 知识库权限
 * - sheets:* - 电子表格权限
 * - docs:* - 文档权限
 * - search:* - 搜索权限
 * - im:* - 即时通讯权限
 * - contact:* - 通讯录权限
 */
const SCOPE_REGISTRY: Record<string, string[]> = {
  // ========== Bitable 多维表格 ==========
  'feishu_bitable_app.create': ['bitable:app'],
  'feishu_bitable_app.get': ['bitable:app:read'],
  'feishu_bitable_app.update': ['bitable:app'],
  'feishu_bitable_app.delete': ['bitable:app'],

  'feishu_bitable_app_table.create': ['bitable:table'],
  'feishu_bitable_app_table.get': ['bitable:table:read'],
  'feishu_bitable_app_table.update': ['bitable:table'],
  'feishu_bitable_app_table.delete': ['bitable:table'],

  'feishu_bitable_app_table_record.create': ['bitable:record'],
  'feishu_bitable_app_table_record.get': ['bitable:record:read'],
  'feishu_bitable_app_table_record.list': ['bitable:record:read'],
  'feishu_bitable_app_table_record.update': ['bitable:record'],
  'feishu_bitable_app_table_record.delete': ['bitable:record'],

  'feishu_bitable_app_table_field.create': ['bitable:field'],
  'feishu_bitable_app_table_field.get': ['bitable:field:read'],
  'feishu_bitable_app_table_field.list': ['bitable:field:read'],
  'feishu_bitable_app_table_field.update': ['bitable:field'],
  'feishu_bitable_app_table_field.delete': ['bitable:field'],

  'feishu_bitable_app_table_view.get': ['bitable:view:read'],
  'feishu_bitable_app_table_view.list': ['bitable:view:read'],

  // ========== Task 任务管理 ==========
  'feishu_task_task.create': ['task:task'],
  'feishu_task_task.get': ['task:task:read'],
  'feishu_task_task.list': ['task:task:read'],
  'feishu_task_task.update': ['task:task'],
  'feishu_task_task.delete': ['task:task'],
  'feishu_task_task.patch': ['task:task'],

  'feishu_task_tasklist.create': ['task:tasklist'],
  'feishu_task_tasklist.get': ['task:tasklist:read'],
  'feishu_task_tasklist.list': ['task:tasklist:read'],
  'feishu_task_tasklist.update': ['task:tasklist'],
  'feishu_task_tasklist.delete': ['task:tasklist'],

  'feishu_task_subtask.create': ['task:task'],
  'feishu_task_subtask.get': ['task:task:read'],
  'feishu_task_subtask.update': ['task:task'],
  'feishu_task_subtask.delete': ['task:task'],

  'feishu_task_comment.create': ['task:task'],
  'feishu_task_comment.get': ['task:task:read'],
  'feishu_task_comment.list': ['task:task:read'],
  'feishu_task_comment.delete': ['task:task'],

  // ========== Calendar 日历 ==========
  'feishu_calendar_calendar.create': ['calendar:calendar'],
  'feishu_calendar_calendar.get': ['calendar:calendar:read'],
  'feishu_calendar_calendar.list': ['calendar:calendar:read'],
  'feishu_calendar_calendar.update': ['calendar:calendar'],
  'feishu_calendar_calendar.delete': ['calendar:calendar'],
  'feishu_calendar_calendar.subscribe': ['calendar:calendar'],
  'feishu_calendar_calendar.unsubscribe': ['calendar:calendar'],

  'feishu_calendar_event.create': ['calendar:calendar:event'],
  'feishu_calendar_event.get': ['calendar:calendar:event:read'],
  'feishu_calendar_event.list': ['calendar:calendar:event:read'],
  'feishu_calendar_event.update': ['calendar:calendar:event'],
  'feishu_calendar_event.delete': ['calendar:calendar:event'],

  'feishu_calendar_event_attendee.list': ['calendar:calendar:event:read'],
  'feishu_calendar_event_attendee.create': ['calendar:calendar:event'],
  'feishu_calendar_event_attendee.delete': ['calendar:calendar:event'],

  'feishu_calendar_freebusy.query': ['calendar:calendar:read'],

  // ========== Drive 云盘 ==========
  'feishu_drive_file.list': ['drive:drive:read'],
  'feishu_drive_file.get': ['drive:drive:read'],
  'feishu_drive_file.create': ['drive:drive'],
  'feishu_drive_file.update': ['drive:drive'],
  'feishu_drive_file.delete': ['drive:drive'],
  'feishu_drive_file.copy': ['drive:drive'],
  'feishu_drive_file.move': ['drive:drive'],
  'feishu_drive_file.download': ['drive:drive:read'],
  'feishu_drive_file.upload': ['drive:drive'],

  'feishu_drive_folder.create': ['drive:drive'],
  'feishu_drive_folder.get': ['drive:drive:read'],

  // ========== Wiki 知识库 ==========
  'feishu_wiki_node.list': ['wiki:wiki:read'],
  'feishu_wiki_node.get': ['wiki:wiki:read'],
  'feishu_wiki_node.create': ['wiki:wiki'],
  'feishu_wiki_node.update': ['wiki:wiki'],
  'feishu_wiki_node.delete': ['wiki:wiki'],
  'feishu_wiki_node.move': ['wiki:wiki'],

  'feishu_wiki_space.list': ['wiki:wiki:read'],
  'feishu_wiki_space.get': ['wiki:wiki:read'],

  // ========== Sheets 电子表格 ==========
  'feishu_sheets_spreadsheet.get': ['sheets:spreadsheet:read'],
  'feishu_sheets_spreadsheet.create': ['sheets:spreadsheet'],
  'feishu_sheets_spreadsheet.update': ['sheets:spreadsheet'],
  'feishu_sheets_spreadsheet.delete': ['sheets:spreadsheet'],

  'feishu_sheets_sheet.get': ['sheets:spreadsheet:read'],
  'feishu_sheets_sheet.create': ['sheets:spreadsheet'],
  'feishu_sheets_sheet.delete': ['sheets:spreadsheet'],
  'feishu_sheets_sheet.update': ['sheets:spreadsheet'],

  'feishu_sheets_range.get': ['sheets:spreadsheet:read'],
  'feishu_sheets_range.update': ['sheets:spreadsheet'],

  // ========== Docs 文档 ==========
  'feishu_docs_doc.create': ['docs:doc'],
  'feishu_docs_doc.get': ['docs:doc:read'],
  'feishu_docs_doc.update': ['docs:doc'],
  'feishu_docs_doc.delete': ['docs:doc'],

  'feishu_docs_block.get': ['docs:doc:read'],
  'feishu_docs_block.create': ['docs:doc'],
  'feishu_docs_block.update': ['docs:doc'],
  'feishu_docs_block.delete': ['docs:doc'],

  // ========== Search 搜索 ==========
  'feishu_search_user': ['search:user:read'],
  'feishu_search_user_batch': ['search:user:read'],
  'feishu_search_chat': ['search:chat:read'],
  'feishu_search_doc': ['search:doc:read'],

  // ========== Chat 群聊 ==========
  'feishu_chat.create': ['im:chat'],
  'feishu_chat.get': ['im:chat:read'],
  'feishu_chat.list': ['im:chat:read'],
  'feishu_chat.update': ['im:chat'],
  'feishu_chat.delete': ['im:chat'],

  'feishu_chat_member.list': ['im:chat:read'],
  'feishu_chat_member.add': ['im:chat'],
  'feishu_chat_member.remove': ['im:chat'],

  // ========== Contact 通讯录 ==========
  'feishu_contact_user.get': ['contact:user:read'],
  'feishu_contact_user.list': ['contact:user:read'],
  'feishu_contact_user.batch': ['contact:user:read'],

  'feishu_contact_group.get': ['contact:group:read'],
  'feishu_contact_group.list': ['contact:group:read'],
};

/**
 * 获取 API 所需的 Scope 列表
 */
export function getRequiredScopes(apiName: string): string[] {
  return SCOPE_REGISTRY[apiName] ?? [];
}

/**
 * 获取模块所需的所有 Scope
 * @param module 模块名称: bitable, task, calendar, drive, wiki, sheets, docs, search, chat, contact
 */
export function getModuleScopes(module: string): string[] {
  const prefix = `${module}:`;
  const scopes = new Set<string>();

  for (const scopeList of Object.values(SCOPE_REGISTRY)) {
    for (const scope of scopeList) {
      if (scope.startsWith(prefix)) {
        // 提取基础权限 (去掉 :read 后缀)
        const baseScope = scope.replace(':read', '');
        scopes.add(baseScope);
      }
    }
  }

  return Array.from(scopes);
}

/**
 * 获取所有已注册的 API 名称
 */
export function getRegisteredApis(): string[] {
  return Object.keys(SCOPE_REGISTRY);
}

/**
 * 检查 Scope 是否满足 API 需求
 */
export function checkScopes(
  apiName: string,
  grantedScopes: string[]
): { sufficient: boolean; missing: string[] } {
  const required = getRequiredScopes(apiName);
  const missing = required.filter(
    (scope) =>
      !grantedScopes.includes(scope) &&
      !grantedScopes.includes(`${scope}:read`) &&
      !grantedScopes.some((granted) => {
        // 检查是否有更宽泛的权限
        // 例如: bitable:app 包含 bitable:app:read
        const baseScope = granted.replace(':read', '');
        return baseScope === scope;
      })
  );

  return {
    sufficient: missing.length === 0,
    missing,
  };
}

/**
 * 权限模块分组
 */
export const SCOPE_GROUPS = {
  bitable: {
    name: '多维表格',
    scopes: getModuleScopes('bitable'),
    description: '管理多维表格、数据表、记录和字段',
  },
  task: {
    name: '任务管理',
    scopes: getModuleScopes('task'),
    description: '创建和管理任务、清单和子任务',
  },
  calendar: {
    name: '日历',
    scopes: getModuleScopes('calendar'),
    description: '管理日历、事件和忙闲状态',
  },
  drive: {
    name: '云盘',
    scopes: getModuleScopes('drive'),
    description: '管理云盘文件和文件夹',
  },
  wiki: {
    name: '知识库',
    scopes: getModuleScopes('wiki'),
    description: '管理知识库节点和空间',
  },
  sheets: {
    name: '电子表格',
    scopes: getModuleScopes('sheets'),
    description: '管理电子表格和工作表',
  },
  docs: {
    name: '文档',
    scopes: getModuleScopes('docs'),
    description: '创建和管理文档',
  },
  search: {
    name: '搜索',
    scopes: getModuleScopes('search'),
    description: '搜索用户、群聊和文档',
  },
  chat: {
    name: '群聊',
    scopes: getModuleScopes('im'),
    description: '创建和管理群聊',
  },
  contact: {
    name: '通讯录',
    scopes: getModuleScopes('contact'),
    description: '查看用户和组织信息',
  },
} as const;