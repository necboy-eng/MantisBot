// src/plugins/feishu-advanced/task/subtask.ts

/**
 * feishu_task_subtask tool -- 飞书任务子任务管理
 *
 * Actions: create, list
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk, parseTimeToTimestampMs } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuTaskSubtaskSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list'],
      description: '操作类型',
    },
    // 共用字段
    task_guid: { type: 'string', description: '父任务 GUID' },
    // Create 字段
    summary: { type: 'string', description: '子任务标题' },
    description: { type: 'string', description: '子任务描述' },
    due: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', description: "截止时间（ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'）" },
        is_all_day: { type: 'boolean', description: '是否为全天任务' },
      },
      description: '截止时间',
    },
    start: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', description: "开始时间（ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'）" },
        is_all_day: { type: 'boolean', description: '是否为全天' },
      },
      description: '开始时间',
    },
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '成员 open_id' },
          role: { type: 'string', enum: ['assignee', 'follower'], description: '成员角色（assignee=负责人，follower=关注人）' },
        },
        required: ['id'],
      },
      description: '子任务成员列表',
    },
    // List 参数
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action', 'task_guid'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerTaskSubtaskTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_task_subtask',
    description:
      '【以用户身份】飞书任务的子任务管理工具。当用户要求创建子任务、查询任务的子任务列表时使用。\n\n' +
      'Actions:\n' +
      '- create（创建子任务）\n' +
      '- list（列出任务的所有子任务）',
    parameters: FeishuTaskSubtaskSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'subtask' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            logger.info(`[subtask] create: task_guid=${p.task_guid}, summary=${p.summary}`);

            const data: any = {
              summary: p.summary,
            };

            if (p.description) {
              data.description = p.description;
            }

            // 转换截止时间
            if (p.due) {
              const dueTs = parseTimeToTimestampMs(p.due.timestamp);
              if (!dueTs) {
                return json({
                  error: `时间格式错误！due.timestamp 必须使用ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'，当前值：${p.due.timestamp}`,
                });
              }
              data.due = {
                timestamp: dueTs,
                is_all_day: p.due.is_all_day ?? false,
              };
            }

            // 转换开始时间
            if (p.start) {
              const startTs = parseTimeToTimestampMs(p.start.timestamp);
              if (!startTs) {
                return json({
                  error: `时间格式错误！start.timestamp 必须使用ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'，当前值：${p.start.timestamp}`,
                });
              }
              data.start = {
                timestamp: startTs,
                is_all_day: p.start.is_all_day ?? false,
              };
            }

            // 转换成员格式
            if (p.members && p.members.length > 0) {
              data.members = p.members.map((m: any) => ({
                id: m.id,
                type: 'user',
                role: m.role || 'assignee',
              }));
            }

            const res = await client.invoke(
              'feishu_task_subtask.create',
              (sdk, opts) =>
                sdk.task.v2.taskSubtask.create(
                  {
                    path: {
                      task_guid: p.task_guid,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[subtask] created subtask ${res.data?.subtask?.guid ?? 'unknown'}`);

            return json({
              subtask: res.data?.subtask,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[subtask] list: task_guid=${p.task_guid}, page_size=${p.page_size ?? 50}`);

            const res = await client.invoke(
              'feishu_task_subtask.list',
              (sdk, opts) =>
                sdk.task.v2.taskSubtask.list(
                  {
                    path: {
                      task_guid: p.task_guid,
                    },
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                      user_id_type: 'open_id' as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[subtask] list: returned ${data?.items?.length ?? 0} subtasks`);

            return json({
              subtasks: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          default:
            return json({
              error: `Unknown action: ${p.action}`,
            });
        }
      } catch (err: any) {
        // 处理授权错误
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }

        logger.error(`[subtask] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[task] Registered feishu_task_subtask tool');
}