// src/plugins/feishu-advanced/calendar/freebusy.ts

/**
 * feishu_calendar_freebusy tool -- 飞书日历忙闲查询
 *
 * Actions: list
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk, parseTimeToRFC3339 } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuCalendarFreebusySchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list'],
      description: '操作类型（目前仅支持 list）',
    },
    time_min: {
      type: 'string',
      description: "查询起始时间（ISO 8601 / RFC 3339 格式，包含时区），例如 '2024-01-01T00:00:00+08:00'",
    },
    time_max: {
      type: 'string',
      description: "查询结束时间（ISO 8601 / RFC 3339 格式，包含时区），例如 '2024-01-01T00:00:00+08:00'",
    },
    user_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '要查询忙闲的用户 open_id 列表（1-10 个用户）',
      minItems: 1,
      maxItems: 10,
    },
  },
  required: ['action', 'time_min', 'time_max', 'user_ids'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerCalendarFreebusyTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_calendar_freebusy',
    description:
      '【以用户身份】飞书日历忙闲查询工具。当用户要求查询某时间段内某人是否空闲、查看忙闲状态时使用。\n\n' +
      '支持批量查询 1-10 个用户的主日历忙闲信息，用于安排会议时间。\n\n' +
      'Actions:\n' +
      '- list（查询用户忙闲状态）',
    parameters: FeishuCalendarFreebusySchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      logger.info(`[calendar_freebusy] Execute called with params: ${JSON.stringify(p)}`);

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'calendar_freebusy' },
        });

        if (p.action !== 'list') {
          logger.warn(`[calendar_freebusy] Unknown action: ${p.action}`);
          return json({ error: `Unknown action: ${p.action}` });
        }

        // Validate user_ids (batch API requires 1-10 users)
        if (!p.user_ids || p.user_ids.length === 0) {
          logger.warn(`[calendar_freebusy] user_ids is empty`);
          return json({
            error: 'user_ids is required (1-10 user IDs)',
          });
        }

        if (p.user_ids.length > 10) {
          logger.warn(`[calendar_freebusy] user_ids exceeds limit: ${p.user_ids.length}`);
          return json({
            error: `user_ids count exceeds limit, maximum 10 users (current: ${p.user_ids.length})`,
          });
        }

        logger.info(`[calendar_freebusy] Validation passed, user_ids count: ${p.user_ids.length}`);

        // Convert time strings to RFC 3339 format (required by freebusy API)
        const timeMin = parseTimeToRFC3339(p.time_min);
        const timeMax = parseTimeToRFC3339(p.time_max);

        if (!timeMin || !timeMax) {
          logger.warn(
            `[calendar_freebusy] Time format error: time_min=${p.time_min}, time_max=${p.time_max}`
          );
          return json({
            error:
              "Invalid time format. Must use ISO 8601 / RFC 3339 with timezone, e.g. '2024-01-01T00:00:00+08:00' or '2026-02-25 14:00:00'.",
            received_time_min: p.time_min,
            received_time_max: p.time_max,
          });
        }

        logger.info(
          `[calendar_freebusy] Calling batch API: time_min=${p.time_min} -> ${timeMin}, time_max=${p.time_max} -> ${timeMax}, user_ids=${p.user_ids.length}`
        );

        const res = await client.invoke(
          'feishu_calendar_freebusy.list',
          (sdk, opts) =>
            sdk.calendar.freebusy.batch(
              {
                data: {
                  time_min: timeMin,
                  time_max: timeMax,
                  user_ids: p.user_ids,
                  include_external_calendar: true,
                  only_busy: true,
                } as any, // SDK 类型定义可能未包含所有字段
              },
              opts
            ),
          { as: 'user' }
        );
        assertLarkOk(res);

        const data = res.data as any;
        const freebusyLists = data?.freebusy_lists ?? [];
        logger.info(`[calendar_freebusy] Success: returned ${freebusyLists.length} user(s) freebusy data`);

        return json({
          freebusy_lists: freebusyLists,
          _debug: {
            time_min_input: p.time_min,
            time_min_rfc3339: timeMin,
            time_max_input: p.time_max,
            time_max_rfc3339: timeMax,
            user_count: p.user_ids.length,
          },
        });
      } catch (err: any) {
        // 处理授权错误
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }

        logger.error(`[calendar_freebusy] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[calendar] Registered feishu_calendar_freebusy tool');
}