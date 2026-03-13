// src/plugins/feishu-advanced/calendar/event-attendee.ts

/**
 * feishu_calendar_event_attendee tool -- 飞书日程参会人管理
 *
 * Actions: create, list, batch_delete
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

const FeishuCalendarEventAttendeeSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'batch_delete'],
      description: '操作类型',
    },
    calendar_id: { type: 'string', description: '日历 ID' },
    event_id: { type: 'string', description: '日程 ID' },
    attendees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['user', 'chat', 'resource', 'third_party'],
          },
          attendee_id: {
            type: 'string',
            description:
              '参会人 ID。type=user 时为 open_id，type=chat 时为 chat_id，type=resource 时为会议室 ID，type=third_party 时为邮箱地址',
          },
        },
      },
      description: '参会人列表（create 时使用）',
    },
    need_notification: { type: 'boolean', description: '是否给参会人发送通知（create 默认 true，batch_delete 默认 false）' },
    attendee_ability: {
      type: 'string',
      enum: ['none', 'can_see_others', 'can_invite_others', 'can_modify_event'],
      description: '参会人权限（create 时可选）',
    },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 500（list 时使用）' },
    page_token: { type: 'string', description: '分页标记（list 时使用）' },
    user_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '用户 ID 类型（list 时使用，默认 open_id）',
    },
    user_open_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '要删除的参会人的 open_id 列表（batch_delete 时使用）',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerCalendarEventAttendeeTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_calendar_event_attendee',
    description:
      '【以用户身份】飞书日程参会人管理工具。当用户要求邀请/添加参会人、查看参会人列表、移除参会人时使用。\n\n' +
      'Actions:\n' +
      '- create（添加参会人）\n' +
      '- list（查询参会人列表）\n' +
      '- batch_delete（批量删除参会人，注意：不能删除日程组织者）',
    parameters: FeishuCalendarEventAttendeeSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'calendar_event_attendee' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE ATTENDEES
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.calendar_id) {
              return json({ error: 'calendar_id is required' });
            }
            if (!p.event_id) {
              return json({ error: 'event_id is required' });
            }
            if (!p.attendees || p.attendees.length === 0) {
              return json({ error: 'attendees is required and cannot be empty' });
            }

            logger.info(
              `[calendar_event_attendee] create: calendar_id=${p.calendar_id}, event_id=${p.event_id}, attendees_count=${p.attendees.length}`
            );

            const attendeeData = p.attendees.map((a: any) => {
              const base: any = {
                type: a.type,
                is_optional: false,
              };

              if (a.type === 'user') {
                base.user_id = a.attendee_id;
              } else if (a.type === 'chat') {
                base.chat_id = a.attendee_id;
              } else if (a.type === 'resource') {
                base.room_id = a.attendee_id;
              } else if (a.type === 'third_party') {
                base.third_party_email = a.attendee_id;
              }

              return base;
            });

            const res = await client.invoke(
              'feishu_calendar_event_attendee.create',
              (sdk, opts) =>
                sdk.calendar.calendarEventAttendee.create(
                  {
                    path: {
                      calendar_id: p.calendar_id,
                      event_id: p.event_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      attendees: attendeeData,
                      need_notification: p.need_notification ?? true,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[calendar_event_attendee] create: added ${p.attendees.length} attendees to event ${p.event_id}`);

            return json({
              attendees: res.data?.attendees,
            });
          }

          // -----------------------------------------------------------------
          // LIST ATTENDEES
          // -----------------------------------------------------------------
          case 'list': {
            if (!p.calendar_id) {
              return json({ error: 'calendar_id is required' });
            }
            if (!p.event_id) {
              return json({ error: 'event_id is required' });
            }

            logger.info(
              `[calendar_event_attendee] list: calendar_id=${p.calendar_id}, event_id=${p.event_id}, page_size=${p.page_size ?? 50}`
            );

            const res = await client.invoke(
              'feishu_calendar_event_attendee.list',
              (sdk, opts) =>
                sdk.calendar.calendarEventAttendee.list(
                  {
                    path: {
                      calendar_id: p.calendar_id,
                      event_id: p.event_id,
                    },
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                      user_id_type: (p.user_id_type || 'open_id') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[calendar_event_attendee] list: returned ${data?.items?.length ?? 0} attendees`);

            return json({
              attendees: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // BATCH DELETE ATTENDEES
          // -----------------------------------------------------------------
          case 'batch_delete': {
            if (!p.calendar_id) {
              return json({ error: 'calendar_id is required' });
            }
            if (!p.event_id) {
              return json({ error: 'event_id is required' });
            }
            if (!p.user_open_ids || p.user_open_ids.length === 0) {
              return json({ error: 'user_open_ids is required and cannot be empty' });
            }

            logger.info(
              `[calendar_event_attendee] batch_delete: calendar_id=${p.calendar_id}, event_id=${p.event_id}, user_open_ids=${p.user_open_ids.join(',')}`
            );

            // Step 1: List all attendees to get attendee_id (user_...) from open_id (ou_...)
            const listRes = await client.invoke(
              'feishu_calendar_event_attendee.list_for_delete',
              (sdk, opts) =>
                sdk.calendar.calendarEventAttendee.list(
                  {
                    path: {
                      calendar_id: p.calendar_id,
                      event_id: p.event_id,
                    },
                    params: {
                      page_size: 500,
                      user_id_type: 'open_id' as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(listRes);

            interface AttendeeItem {
              user_id?: string;
              attendee_id?: string;
              is_organizer?: boolean;
            }
            const listData = listRes.data as any;
            const attendees: AttendeeItem[] = listData?.items || [];

            // Step 2: Map open_id to attendee_id (user_...) and track organizers
            const openIdToAttendeeId = new Map<string, string>();
            const organizerOpenIds = new Set<string>();

            for (const att of attendees) {
              if (att.user_id && att.attendee_id) {
                openIdToAttendeeId.set(att.user_id, att.attendee_id);
                if (att.is_organizer) {
                  organizerOpenIds.add(att.user_id);
                }
              }
            }

            // Step 2.5: Check if trying to delete organizer(s)
            const attemptingToDeleteOrganizers = p.user_open_ids.filter((id: string) =>
              organizerOpenIds.has(id)
            );

            if (attemptingToDeleteOrganizers.length > 0) {
              return json({
                error: 'cannot delete event organizer',
                organizers_cannot_delete: attemptingToDeleteOrganizers,
                hint: 'Event organizers cannot be removed. To remove organizer, consider deleting the event or transferring organizer role.',
              });
            }

            // Step 3: Find attendee_ids for the given open_ids
            const attendeeIdsToDelete: string[] = [];
            const notFound: string[] = [];

            for (const openId of p.user_open_ids) {
              const attendeeId = openIdToAttendeeId.get(openId);
              if (attendeeId) {
                attendeeIdsToDelete.push(attendeeId);
              } else {
                notFound.push(openId);
              }
            }

            if (attendeeIdsToDelete.length === 0) {
              return json({
                error: 'None of the provided open_ids were found in the attendee list',
                not_found: notFound,
              });
            }

            logger.info(
              `[calendar_event_attendee] batch_delete: mapped ${attendeeIdsToDelete.length} open_ids to attendee_ids, not_found=${notFound.length}`
            );

            // Step 4: Call batch_delete API with attendee_ids (user_...)
            const res = await client.invoke(
              'feishu_calendar_event_attendee.batch_delete',
              (sdk, opts) =>
                sdk.calendar.calendarEventAttendee.batchDelete(
                  {
                    path: {
                      calendar_id: p.calendar_id,
                      event_id: p.event_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      attendee_ids: attendeeIdsToDelete,
                      need_notification: p.need_notification ?? false,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[calendar_event_attendee] batch_delete: removed ${attendeeIdsToDelete.length} attendees from event ${p.event_id}`);

            return json({
              success: true,
              removed_count: attendeeIdsToDelete.length,
              not_found: notFound.length > 0 ? notFound : undefined,
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

        logger.error(`[calendar_event_attendee] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[calendar] Registered feishu_calendar_event_attendee tool');
}