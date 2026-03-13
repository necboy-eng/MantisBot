// src/plugins/feishu-advanced/calendar/event.ts

/**
 * feishu_calendar_event tool -- 飞书日程管理
 *
 * Actions: create, list, get, patch, delete
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient } from '../tool-client.js';
import { json, assertLarkOk, parseTimeToTimestamp } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

const FeishuCalendarEventSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'get', 'patch', 'delete'],
      description: '操作类型',
    },
    // 时间字段
    start_time: {
      type: 'string',
      description: "开始时间（ISO 8601 / RFC 3339 格式，包含时区），例如 '2024-01-01T00:00:00+08:00'",
    },
    end_time: {
      type: 'string',
      description: "结束时间（ISO 8601 / RFC 3339 格式，包含时区），例如 '2024-01-01T01:00:00+08:00'",
    },
    // 日程信息
    summary: { type: 'string', description: '日程标题' },
    description: { type: 'string', description: '日程描述' },
    // 日程 ID
    event_id: { type: 'string', description: '日程 ID' },
    calendar_id: { type: 'string', description: '日历 ID（可选，默认使用主日历）' },
    // 参会人
    attendees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['user', 'chat', 'resource', 'third_party'] },
          id: { type: 'string', description: '参会人 ID（open_id/chat_id/resource_id/邮箱）' },
        },
      },
      description: '参会人列表',
    },
    // 地点
    location: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '地点名称' },
        address: { type: 'string', description: '地点地址' },
      },
      description: '日程地点',
    },
    // 其他
    visibility: {
      type: 'string',
      enum: ['default', 'public', 'private'],
      description: '日程公开范围',
    },
    need_notification: { type: 'boolean', description: '是否通知参会人（默认 true）' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerCalendarEventTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_calendar_event',
    description:
      "【以用户身份】飞书日程管理工具。用于创建、查询、更新日程。Actions: create（创建日程）, list（查询日程列表）, get（获取日程详情）, patch（更新日程）, delete（删除日程）。时间参数使用ISO 8601 / RFC 3339 格式（包含时区），例如 '2024-01-01T00:00:00+08:00'。",
    parameters: FeishuCalendarEventSchema,
    async execute(params: Record<string, unknown>, context?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = context?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'calendar_event' },
        });

        // 获取主日历 ID（如果未指定）
        const resolveCalendarId = async (): Promise<string | null> => {
          const res = await client.invoke(
            'feishu_calendar_calendar.primary',
            (sdk, opts) => sdk.calendar.calendar.primary({}, opts),
            { as: 'user' }
          );

          const cid = res.data?.calendars?.[0]?.calendar?.calendar_id;
          if (cid) {
            logger.info(`[calendar_event] resolved primary calendar_id=${cid}`);
          }
          return cid || null;
        };

        const resolveCalendarIdOrFail = async (calendarId?: string): Promise<string> => {
          if (calendarId) return calendarId;
          const resolved = await resolveCalendarId();
          if (!resolved) throw new Error('Could not determine primary calendar');
          return resolved;
        };

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE EVENT
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.summary) return json({ error: 'summary is required' });
            if (!p.start_time) return json({ error: 'start_time is required' });
            if (!p.end_time) return json({ error: 'end_time is required' });

            const startTs = parseTimeToTimestamp(p.start_time);
            const endTs = parseTimeToTimestamp(p.end_time);
            if (!startTs || !endTs) {
              return json({
                error:
                  "Invalid time format. Must use ISO 8601 / RFC 3339 with timezone, e.g. '2024-01-01T00:00:00+08:00'.",
              });
            }

            logger.info(
              `[calendar_event] create: summary=${p.summary}, start=${startTs}, end=${endTs}`
            );

            const calendarId = await resolveCalendarIdOrFail(p.calendar_id);

            const eventData: any = {
              summary: p.summary,
              start_time: { timestamp: startTs },
              end_time: { timestamp: endTs },
              need_notification: true,
            };
            if (p.description) eventData.description = p.description;
            if (p.visibility) eventData.visibility = p.visibility;

            const res = await client.invoke(
              'feishu_calendar_event.create',
              (sdk, opts) =>
                sdk.calendar.calendarEvent.create(
                  {
                    path: { calendar_id: calendarId },
                    data: eventData,
                    params: {},
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const eventId = res.data?.event?.event_id;
            logger.info(`[calendar_event] created: event_id=${eventId}`);

            // 如果有参会人，添加参会人
            if (p.attendees && p.attendees.length > 0 && eventId) {
              try {
                await client.invoke(
                  'feishu_calendar_event_attendee.create',
                  (sdk, opts) =>
                    sdk.calendar.calendarEventAttendee.create(
                      {
                        path: { calendar_id: calendarId, event_id: eventId },
                        data: {
                          attendees: p.attendees.map((a: any) => ({
                            type: a.type,
                            user_id: a.type === 'user' ? a.id : undefined,
                            third_party_email: a.type === 'third_party' ? a.id : undefined,
                            chat_id: a.type === 'chat' ? a.id : undefined,
                            resource_id: a.type === 'resource' ? a.id : undefined,
                          })),
                        },
                        params: {},
                      },
                      opts
                    ),
                  { as: 'user' }
                );
                logger.info(`[calendar_event] added ${p.attendees.length} attendees`);
              } catch (err: any) {
                logger.warn(`[calendar_event] failed to add attendees: ${err.message}`);
              }
            }

            return json({
              event: res.data?.event,
            });
          }

          // -----------------------------------------------------------------
          // LIST EVENTS
          // -----------------------------------------------------------------
          case 'list': {
            if (!p.start_time) return json({ error: 'start_time is required' });
            if (!p.end_time) return json({ error: 'end_time is required' });

            const startTs = parseTimeToTimestamp(p.start_time);
            const endTs = parseTimeToTimestamp(p.end_time);
            if (!startTs || !endTs) {
              return json({
                error: "Invalid time format. Must use ISO 8601 / RFC 3339 with timezone.",
              });
            }

            logger.info(`[calendar_event] list: start=${startTs}, end=${endTs}`);

            const calendarId = await resolveCalendarIdOrFail(p.calendar_id);

            const res = await client.invoke(
              'feishu_calendar_event.list',
              (sdk, opts) =>
                sdk.calendar.calendarEvent.instanceView(
                  {
                    path: { calendar_id: calendarId },
                    params: {
                      start_time: startTs,
                      end_time: endTs,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;

            return json({
              events: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET EVENT
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.event_id) return json({ error: 'event_id is required' });

            logger.info(`[calendar_event] get: event_id=${p.event_id}`);

            const calendarId = await resolveCalendarIdOrFail(p.calendar_id);

            const res = await client.invoke(
              'feishu_calendar_event.get',
              (sdk, opts) =>
                sdk.calendar.calendarEvent.get(
                  {
                    path: {
                      calendar_id: calendarId,
                      event_id: p.event_id,
                    },
                    params: {},
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              event: res.data?.event,
            });
          }

          // -----------------------------------------------------------------
          // PATCH EVENT
          // -----------------------------------------------------------------
          case 'patch': {
            if (!p.event_id) return json({ error: 'event_id is required' });

            logger.info(`[calendar_event] patch: event_id=${p.event_id}`);

            const calendarId = await resolveCalendarIdOrFail(p.calendar_id);

            const updateData: any = {};

            if (p.summary) updateData.summary = p.summary;
            if (p.description !== undefined) updateData.description = p.description;

            if (p.start_time) {
              const startTs = parseTimeToTimestamp(p.start_time);
              if (!startTs) {
                return json({ error: "start_time format error" });
              }
              updateData.start_time = { timestamp: startTs };
            }

            if (p.end_time) {
              const endTs = parseTimeToTimestamp(p.end_time);
              if (!endTs) {
                return json({ error: "end_time format error" });
              }
              updateData.end_time = { timestamp: endTs };
            }

            if (p.location) updateData.location = p.location;

            const res = await client.invoke(
              'feishu_calendar_event.patch',
              (sdk, opts) =>
                sdk.calendar.calendarEvent.patch(
                  {
                    path: {
                      calendar_id: calendarId,
                      event_id: p.event_id,
                    },
                    data: updateData,
                    params: {},
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[calendar_event] patched: event_id=${p.event_id}`);

            return json({
              event: res.data?.event,
            });
          }

          // -----------------------------------------------------------------
          // DELETE EVENT
          // -----------------------------------------------------------------
          case 'delete': {
            if (!p.event_id) return json({ error: 'event_id is required' });

            logger.info(`[calendar_event] delete: event_id=${p.event_id}`);

            const calendarId = await resolveCalendarIdOrFail(p.calendar_id);

            const res = await client.invoke(
              'feishu_calendar_event.delete',
              (sdk, opts) =>
                sdk.calendar.calendarEvent.delete(
                  {
                    path: {
                      calendar_id: calendarId,
                      event_id: p.event_id,
                    },
                    params: {
                      need_notification: p.need_notification ?? true,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[calendar_event] deleted: event_id=${p.event_id}`);

            return json({
              success: true,
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

        logger.error(`[calendar_event] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[calendar] Registered feishu_calendar_event tool');
}