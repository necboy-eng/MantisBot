// src/plugins/feishu-advanced/task/task.ts

/**
 * feishu_task_task tool -- 飞书任务管理
 *
 * Actions: create, get, list, patch
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

const FeishuTaskTaskSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'get', 'list', 'patch'],
      description: '操作类型',
    },
    // Create/Patch 共用字段
    summary: { type: 'string', description: '任务标题' },
    description: { type: 'string', description: '任务描述' },
    // Get/Patch 共用字段
    task_guid: { type: 'string', description: '任务 GUID' },
    // 时间字段
    due: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', description: '截止时间（ISO 8601 格式）' },
        is_all_day: { type: 'boolean', description: '是否为全天任务' },
      },
      description: '截止时间',
    },
    start: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', description: '开始时间（ISO 8601 格式）' },
        is_all_day: { type: 'boolean', description: '是否为全天' },
      },
      description: '开始时间',
    },
    completed_at: {
      type: 'string',
      description: '完成时间（ISO 8601 格式，或 "0" 表示反完成）',
    },
    // 成员
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '成员 open_id' },
          role: { type: 'string', enum: ['assignee', 'follower'] },
        },
      },
      description: '任务成员列表',
    },
    // 其他
    repeat_rule: { type: 'string', description: '重复规则（RRULE 格式）' },
    tasklists: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tasklist_guid: { type: 'string' },
          section_guid: { type: 'string' },
        },
      },
      description: '任务所属清单列表',
    },
    // List 参数
    page_size: { type: 'number', description: '每页数量（默认 50，最大 100）' },
    page_token: { type: 'string', description: '分页标记' },
    completed: { type: 'boolean', description: '是否筛选已完成任务' },
    user_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '用户 ID 类型',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerTaskTaskTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_task_task',
    description:
      "【以用户身份】飞书任务管理工具。用于创建、查询、更新任务。Actions: create（创建任务）, get（获取任务详情）, list（查询任务列表，仅返回我负责的任务）, patch（更新任务）。时间参数使用ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'。",
    parameters: FeishuTaskTaskSchema,
    async execute(params: Record<string, unknown>, context?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = context?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'task' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE TASK
          // -----------------------------------------------------------------
          case 'create': {
            logger.info(`[task] create: summary=${p.summary}`);

            const taskData: any = {
              summary: p.summary,
            };

            if (p.description) taskData.description = p.description;

            // Handle due time conversion
            if (p.due?.timestamp) {
              const dueTs = parseTimeToTimestampMs(p.due.timestamp);
              if (!dueTs) {
                return json({
                  error:
                    "due 时间格式错误！必须使用ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'。",
                  received: p.due.timestamp,
                });
              }
              taskData.due = {
                timestamp: dueTs,
                is_all_day: p.due.is_all_day ?? false,
              };
            }

            // Handle start time conversion
            if (p.start?.timestamp) {
              const startTs = parseTimeToTimestampMs(p.start.timestamp);
              if (!startTs) {
                return json({
                  error:
                    "start 时间格式错误！必须使用ISO 8601 / RFC 3339 格式（包含时区）。",
                  received: p.start.timestamp,
                });
              }
              taskData.start = {
                timestamp: startTs,
                is_all_day: p.start.is_all_day ?? false,
              };
            }

            if (p.members) taskData.members = p.members;
            if (p.repeat_rule) taskData.repeat_rule = p.repeat_rule;
            if (p.tasklists) taskData.tasklists = p.tasklists;

            const res = await client.invoke(
              'feishu_task_task.create',
              (sdk, opts) =>
                sdk.task.v2.task.create(
                  {
                    data: taskData,
                    params: {
                      user_id_type: (p.user_id_type || 'open_id') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[task] created: task_guid=${res.data?.task?.guid}`);

            return json({
              task: res.data?.task,
            });
          }

          // -----------------------------------------------------------------
          // GET TASK
          // -----------------------------------------------------------------
          case 'get': {
            logger.info(`[task] get: task_guid=${p.task_guid}`);

            const res = await client.invoke(
              'feishu_task_task.get',
              (sdk, opts) =>
                sdk.task.v2.task.get(
                  {
                    path: { task_guid: p.task_guid },
                    params: {
                      user_id_type: (p.user_id_type || 'open_id') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              task: res.data?.task,
            });
          }

          // -----------------------------------------------------------------
          // LIST TASKS
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[task] list: page_size=${p.page_size ?? 50}`);

            const res = await client.invoke(
              'feishu_task_task.list',
              (sdk, opts) =>
                sdk.task.v2.task.list(
                  {
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                      completed: p.completed,
                      user_id_type: (p.user_id_type || 'open_id') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data;

            return json({
              tasks: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // PATCH TASK
          // -----------------------------------------------------------------
          case 'patch': {
            logger.info(`[task] patch: task_guid=${p.task_guid}`);

            const updateData: any = {};

            if (p.summary) updateData.summary = p.summary;
            if (p.description !== undefined) updateData.description = p.description;

            // Handle due time conversion
            if (p.due?.timestamp) {
              const dueTs = parseTimeToTimestampMs(p.due.timestamp);
              if (!dueTs) {
                return json({
                  error:
                    "due 时间格式错误！必须使用ISO 8601 / RFC 3339 格式（包含时区）。",
                  received: p.due.timestamp,
                });
              }
              updateData.due = {
                timestamp: dueTs,
                is_all_day: p.due.is_all_day ?? false,
              };
            }

            // Handle start time conversion
            if (p.start?.timestamp) {
              const startTs = parseTimeToTimestampMs(p.start.timestamp);
              if (!startTs) {
                return json({
                  error:
                    "start 时间格式错误！必须使用ISO 8601 / RFC 3339 格式（包含时区）。",
                  received: p.start.timestamp,
                });
              }
              updateData.start = {
                timestamp: startTs,
                is_all_day: p.start.is_all_day ?? false,
              };
            }

            // Handle completed_at conversion
            if (p.completed_at !== undefined) {
              // 特殊值：反完成（设为未完成）
              if (p.completed_at === '0') {
                updateData.completed_at = '0';
              }
              // 数字字符串时间戳（直通）
              else if (/^\d+$/.test(p.completed_at)) {
                updateData.completed_at = p.completed_at;
              }
              // 时间格式字符串（需要转换）
              else {
                const completedTs = parseTimeToTimestampMs(p.completed_at);
                if (!completedTs) {
                  return json({
                    error:
                      "completed_at 格式错误！支持：1) ISO 8601 / RFC 3339 格式；2) '0'（反完成）；3) 毫秒时间戳字符串。",
                    received: p.completed_at,
                  });
                }
                updateData.completed_at = completedTs;
              }
            }

            if (p.members) updateData.members = p.members;
            if (p.repeat_rule) updateData.repeat_rule = p.repeat_rule;

            // Build update_fields list (required by Task API)
            const updateFields = Object.keys(updateData);

            const res = await client.invoke(
              'feishu_task_task.patch',
              (sdk, opts) =>
                sdk.task.v2.task.patch(
                  {
                    path: { task_guid: p.task_guid },
                    data: {
                      task: updateData,
                      update_fields: updateFields,
                    },
                    params: {
                      user_id_type: (p.user_id_type || 'open_id') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[task] patched: task_guid=${p.task_guid}`);

            return json({
              task: res.data?.task,
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

        logger.error(`[task] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[task] Registered feishu_task_task tool');
}