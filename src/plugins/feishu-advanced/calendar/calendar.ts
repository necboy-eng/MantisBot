// src/plugins/feishu-advanced/calendar/calendar.ts

/**
 * feishu_calendar_calendar tool -- 飞书日历管理
 *
 * Actions: list, get, primary
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuCalendarCalendarSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'get', 'primary'],
      description: '操作类型',
    },
    calendar_id: { type: 'string', description: '日历 ID（get 时必需）' },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 1000' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerCalendarCalendarTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_calendar_calendar',
    description:
      '【以用户身份】飞书日历管理工具。用于查询日历列表、获取日历信息、查询主日历。\n\n' +
      'Actions:\n' +
      '- list（查询日历列表）\n' +
      '- get（查询指定日历信息）\n' +
      '- primary（查询主日历信息）',
    parameters: FeishuCalendarCalendarSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'calendar_calendar' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // LIST CALENDARS
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[calendar_calendar] list: page_size=${p.page_size ?? 50}, page_token=${p.page_token ?? 'none'}`);

            const res = await client.invoke(
              'feishu_calendar_calendar.list',
              (sdk, opts) =>
                sdk.calendar.calendar.list(
                  {
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            const calendars = data?.calendar_list ?? [];
            logger.info(`[calendar_calendar] list: returned ${calendars.length} calendars`);

            return json({
              calendars,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET CALENDAR
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.calendar_id) {
              return json({
                error: "calendar_id is required for 'get' action",
              });
            }

            logger.info(`[calendar_calendar] get: calendar_id=${p.calendar_id}`);

            const res = await client.invoke(
              'feishu_calendar_calendar.get',
              (sdk, opts) =>
                sdk.calendar.calendar.get(
                  {
                    path: { calendar_id: p.calendar_id },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[calendar_calendar] get: retrieved calendar ${p.calendar_id}`);

            const data = res.data as any;
            return json({
              calendar: data?.calendar ?? res.data,
            });
          }

          // -----------------------------------------------------------------
          // PRIMARY CALENDAR
          // -----------------------------------------------------------------
          case 'primary': {
            logger.info(`[calendar_calendar] primary: querying primary calendar`);

            const res = await client.invoke(
              'feishu_calendar_calendar.primary',
              (sdk, opts) => sdk.calendar.calendar.primary({}, opts),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            const calendars = data?.calendars ?? [];
            logger.info(`[calendar_calendar] primary: returned ${calendars.length} primary calendars`);

            return json({
              calendars,
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

        logger.error(`[calendar_calendar] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[calendar] Registered feishu_calendar_calendar tool');
}