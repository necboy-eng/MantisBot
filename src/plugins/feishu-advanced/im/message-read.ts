// src/plugins/feishu-advanced/im/message-read.ts

/**
 * 消息读取工具集 -- 以用户身份获取/搜索飞书消息
 *
 * 包含：
 *   - feishu_im_user_get_messages       (chat_id / open_id → 会话消息)
 *   - feishu_im_user_get_thread_messages (thread_id → 话题消息)
 *   - feishu_im_user_search_messages     (跨会话关键词搜索)
 *
 * 简化版本：不依赖消息转换器模块，直接返回飞书 API 的原始数据
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { createToolClient, type ToolClient } from '../tool-client.js';
import { json, assertLarkOk } from '../helpers.js';
import { isAuthError, getAuthGuide } from '../auth-errors.js';

// ===========================================================================
// 时间工具函数
// ===========================================================================

const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 将 Date 格式化为北京时间 ISO 8601 字符串 */
function formatBeijingISO(d: Date): string {
  const bj = new Date(d.getTime() + BJ_OFFSET_MS);
  const y = bj.getUTCFullYear();
  const mo = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const da = String(bj.getUTCDate()).padStart(2, '0');
  const h = String(bj.getUTCHours()).padStart(2, '0');
  const mi = String(bj.getUTCMinutes()).padStart(2, '0');
  const s = String(bj.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}:${s}+08:00`;
}

/** ISO 8601 → Unix 秒（字符串） */
function dateTimeToSecondsString(datetime: string): string {
  const d = new Date(datetime);
  return Math.floor(d.getTime() / 1000).toString();
}

/** Unix 毫秒字符串 → ISO 8601 北京时间 */
function millisStringToDateTime(millis: string): string {
  return formatBeijingISO(new Date(parseInt(millis, 10)));
}

/** 解析时间范围标识 */
function parseTimeRangeToSeconds(input: string): { start: string; end: string } {
  const now = new Date();
  const bjNow = new Date(now.getTime() + BJ_OFFSET_MS);

  let start: Date;
  let end: Date = now;

  const beijingStartOfDay = (bjDate: Date): Date => {
    return new Date(
      Date.UTC(bjDate.getUTCFullYear(), bjDate.getUTCMonth(), bjDate.getUTCDate()) - BJ_OFFSET_MS
    );
  };

  const beijingEndOfDay = (bjDate: Date): Date => {
    return new Date(
      Date.UTC(bjDate.getUTCFullYear(), bjDate.getUTCMonth(), bjDate.getUTCDate(), 23, 59, 59) -
        BJ_OFFSET_MS
    );
  };

  switch (input) {
    case 'today':
      start = beijingStartOfDay(bjNow);
      break;
    case 'yesterday': {
      const d = new Date(bjNow);
      d.setUTCDate(d.getUTCDate() - 1);
      start = beijingStartOfDay(d);
      end = beijingEndOfDay(d);
      break;
    }
    case 'day_before_yesterday': {
      const d = new Date(bjNow);
      d.setUTCDate(d.getUTCDate() - 2);
      start = beijingStartOfDay(d);
      end = beijingEndOfDay(d);
      break;
    }
    case 'this_week': {
      const day = bjNow.getUTCDay();
      const diffToMon = day === 0 ? 6 : day - 1;
      const monday = new Date(bjNow);
      monday.setUTCDate(monday.getUTCDate() - diffToMon);
      start = beijingStartOfDay(monday);
      break;
    }
    case 'last_week': {
      const day = bjNow.getUTCDay();
      const diffToMon = day === 0 ? 6 : day - 1;
      const thisMonday = new Date(bjNow);
      thisMonday.setUTCDate(thisMonday.getUTCDate() - diffToMon);
      const lastMonday = new Date(thisMonday);
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
      start = beijingStartOfDay(lastMonday);
      end = beijingEndOfDay(lastSunday);
      break;
    }
    case 'this_month': {
      const firstDay = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), 1));
      start = beijingStartOfDay(firstDay);
      break;
    }
    case 'last_month': {
      const firstDayThisMonth = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), 1));
      const lastDayPrevMonth = new Date(firstDayThisMonth);
      lastDayPrevMonth.setUTCDate(lastDayPrevMonth.getUTCDate() - 1);
      const firstDayPrevMonth = new Date(
        Date.UTC(lastDayPrevMonth.getUTCFullYear(), lastDayPrevMonth.getUTCMonth(), 1)
      );
      start = beijingStartOfDay(firstDayPrevMonth);
      end = beijingEndOfDay(lastDayPrevMonth);
      break;
    }
    default: {
      // last_{N}_{unit}
      const match = input.match(/^last_(\d+)_(minutes?|hours?|days?)$/);
      if (!match) {
        throw new Error(
          `不支持的 relative_time 格式: "${input}"。` +
            '支持: today, yesterday, day_before_yesterday, this_week, last_week, this_month, last_month, last_{N}_{unit}（unit: minutes/hours/days）'
        );
      }
      const n = parseInt(match[1], 10);
      const unit = match[2].replace(/s$/, '');
      start = new Date(now);
      switch (unit) {
        case 'minute':
          start.setMinutes(start.getMinutes() - n);
          break;
        case 'hour':
          start.setHours(start.getHours() - n);
          break;
        case 'day':
          start.setDate(start.getDate() - n);
          break;
      }
      break;
    }
  }

  return {
    start: dateTimeToSecondsString(formatBeijingISO(start)),
    end: dateTimeToSecondsString(formatBeijingISO(end)),
  };
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function sortRuleToSortType(rule?: 'create_time_asc' | 'create_time_desc'): 'ByCreateTimeAsc' | 'ByCreateTimeDesc' {
  return rule === 'create_time_asc' ? 'ByCreateTimeAsc' : 'ByCreateTimeDesc';
}

/** open_id → chat_id (P2P 单聊) */
async function resolveP2PChatId(
  client: ToolClient,
  openId: string,
  log: { info: (msg: string) => void }
): Promise<string> {
  const res = await client.invokeByPath<{ code: number; msg: string; data?: { p2p_chats?: Array<{ chat_id: string }> } }>(
    'feishu_im_user_get_messages.resolveP2P',
    '/open-apis/im/v1/chat_p2p/batch_query',
    {
      method: 'POST',
      body: { chatter_ids: [openId] },
      query: { user_id_type: 'open_id' },
      as: 'user',
    }
  );

  if (res.code !== 0) {
    throw new Error(`Lark API error: ${res.msg || `code ${res.code}`}`);
  }

  const chats = res.data?.p2p_chats;
  if (!chats?.length) {
    log.info(`batch_query: no p2p chat found for open_id=${openId}`);
    throw new Error(`no 1-on-1 chat found with open_id=${openId}. You may not have chat history with this user.`);
  }

  log.info(`batch_query: resolved chat_id=${chats[0].chat_id}`);
  return chats[0].chat_id;
}

/** 解析时间参数 */
function resolveTimeRange(
  p: { relative_time?: string; start_time?: string; end_time?: string },
  logInfo: (msg: string) => void
): { start?: string; end?: string } {
  if (p.relative_time) {
    const range = parseTimeRangeToSeconds(p.relative_time);
    logInfo(`relative_time="${p.relative_time}" → start=${range.start}, end=${range.end}`);
    return range;
  }
  return {
    start: p.start_time ? dateTimeToSecondsString(p.start_time) : undefined,
    end: p.end_time ? dateTimeToSecondsString(p.end_time) : undefined,
  };
}

/** 格式化消息列表 */
function formatMessages(items: any[]): any[] {
  return items.map((item) => ({
    message_id: item.message_id,
    msg_type: item.msg_type,
    content: item.body?.content,
    sender: item.sender,
    create_time: item.create_time ? millisStringToDateTime(item.create_time) : undefined,
    chat_id: item.chat_id,
    thread_id: item.thread_id,
    parent_id: item.parent_id,
    mentions: item.mentions,
    deleted: item.deleted ?? false,
    updated: item.updated ?? false,
  }));
}

// ===========================================================================
// feishu_im_user_get_messages
// ===========================================================================

const GetMessagesSchema = {
  type: 'object' as const,
  properties: {
    open_id: {
      type: 'string',
      description: '用户 open_id（ou_xxx），获取与该用户的单聊消息。与 chat_id 互斥',
    },
    chat_id: {
      type: 'string',
      description: '会话 ID（oc_xxx），支持单聊和群聊。与 open_id 互斥',
    },
    sort_rule: {
      type: 'string',
      enum: ['create_time_asc', 'create_time_desc'],
      description: '排序方式，默认 create_time_desc（最新消息在前）',
    },
    page_size: {
      type: 'number',
      description: '每页消息数（1-50），默认 50',
      minimum: 1,
      maximum: 50,
    },
    page_token: {
      type: 'string',
      description: '分页标记，用于获取下一页',
    },
    relative_time: {
      type: 'string',
      description:
        '相对时间范围：today / yesterday / day_before_yesterday / this_week / last_week / this_month / last_month / last_{N}_{unit}（unit: minutes/hours/days）。与 start_time/end_time 互斥',
    },
    start_time: {
      type: 'string',
      description: '起始时间（ISO 8601 格式，如 2026-02-27T00:00:00+08:00）。与 relative_time 互斥',
    },
    end_time: {
      type: 'string',
      description: '结束时间（ISO 8601 格式，如 2026-02-27T23:59:59+08:00）。与 relative_time 互斥',
    },
  },
  required: [],
};

function registerGetMessages(registry: ToolRegistry, context: PluginToolContext) {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_im_user_get_messages',
    description:
      '【以用户身份】获取群聊或单聊的历史消息。' +
      '\n\n用法：' +
      '\n- 通过 chat_id 获取群聊/单聊消息' +
      '\n- 通过 open_id 获取与指定用户的单聊消息（自动解析 chat_id）' +
      '\n- 支持时间范围过滤：relative_time（如 today、last_3_days）或 start_time/end_time（ISO 8601 格式）' +
      '\n- 支持分页：page_size + page_token' +
      '\n\n【参数约束】' +
      '\n- open_id 和 chat_id 必须二选一，不能同时提供' +
      '\n- relative_time 和 start_time/end_time 不能同时使用' +
      '\n- page_size 范围 1-50，默认 50' +
      '\n\n返回消息列表，每条消息包含 message_id、msg_type、content、sender、create_time 等字段。',
    parameters: GetMessagesSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        if (p.open_id && p.chat_id) {
          return json({ error: 'cannot provide both open_id and chat_id, please provide only one' });
        }
        if (!p.open_id && !p.chat_id) {
          return json({ error: 'either open_id or chat_id is required' });
        }
        if (p.relative_time && (p.start_time || p.end_time)) {
          return json({ error: 'cannot use both relative_time and start_time/end_time' });
        }

        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'im_user_get_messages' },
        });

        let chatId = p.chat_id ?? '';
        if (p.open_id) {
          logger.info(`[im_user_get_messages] resolving P2P chat for open_id=${p.open_id}`);
          chatId = await resolveP2PChatId(client, p.open_id, logger);
        }

        const time = resolveTimeRange(p, (msg) => logger.info(`[im_user_get_messages] ${msg}`));
        logger.info(
          `[im_user_get_messages] list: chat_id=${chatId}, sort=${p.sort_rule ?? 'create_time_desc'}, page_size=${p.page_size ?? 50}`
        );

        const res = await client.invoke(
          'feishu_im_user_get_messages.default',
          (sdk, opts) =>
            sdk.im.v1.message.list(
              {
                params: {
                  container_id_type: 'chat',
                  container_id: chatId,
                  start_time: time.start,
                  end_time: time.end,
                  sort_type: sortRuleToSortType(p.sort_rule),
                  page_size: p.page_size ?? 50,
                  page_token: p.page_token,
                  card_msg_content_type: 'raw_card_content',
                } as any,
              },
              opts
            ),
          { as: 'user' }
        );
        assertLarkOk(res);

        const items = (res.data as any)?.items ?? [];
        const messages = formatMessages(items);
        const hasMore = (res.data as any)?.has_more ?? false;
        const pageToken = (res.data as any)?.page_token;

        logger.info(`[im_user_get_messages] list: returned ${messages.length} messages, has_more=${hasMore}`);

        return json({ messages, has_more: hasMore, page_token: pageToken });
      } catch (err: any) {
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }
        logger.error(`[im_user_get_messages] Error: ${err.message}`);
        return json({ error: err.message || 'Unknown error' });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[im] Registered feishu_im_user_get_messages tool');
}

// ===========================================================================
// feishu_im_user_get_thread_messages
// ===========================================================================

const GetThreadMessagesSchema = {
  type: 'object' as const,
  properties: {
    thread_id: {
      type: 'string',
      description: '话题 ID（omt_xxx 格式）',
    },
    sort_rule: {
      type: 'string',
      enum: ['create_time_asc', 'create_time_desc'],
      description: '排序方式，默认 create_time_desc（最新消息在前）',
    },
    page_size: {
      type: 'number',
      description: '每页消息数（1-50），默认 50',
      minimum: 1,
      maximum: 50,
    },
    page_token: {
      type: 'string',
      description: '分页标记，用于获取下一页',
    },
  },
  required: ['thread_id'],
};

function registerGetThreadMessages(registry: ToolRegistry, context: PluginToolContext) {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_im_user_get_thread_messages',
    description:
      '【以用户身份】获取话题（thread）内的消息列表。' +
      '\n\n用法：' +
      '\n- 通过 thread_id（omt_xxx）获取话题内的所有消息' +
      '\n- 支持分页：page_size + page_token' +
      '\n\n【注意】话题消息不支持时间范围过滤（飞书 API 限制）' +
      '\n\n返回消息列表，格式同 feishu_im_user_get_messages。',
    parameters: GetThreadMessagesSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'im_user_get_thread_messages' },
        });

        logger.info(
          `[im_user_get_thread_messages] list: thread_id=${p.thread_id}, sort=${p.sort_rule ?? 'create_time_desc'}, page_size=${p.page_size ?? 50}`
        );

        const res = await client.invoke(
          'feishu_im_user_get_thread_messages.default',
          (sdk, opts) =>
            sdk.im.v1.message.list(
              {
                params: {
                  container_id_type: 'thread',
                  container_id: p.thread_id,
                  sort_type: sortRuleToSortType(p.sort_rule),
                  page_size: p.page_size ?? 50,
                  page_token: p.page_token,
                  card_msg_content_type: 'raw_card_content',
                } as any,
              },
              opts
            ),
          { as: 'user' }
        );
        assertLarkOk(res);

        const items = (res.data as any)?.items ?? [];
        const messages = formatMessages(items);
        const hasMore = (res.data as any)?.has_more ?? false;
        const pageToken = (res.data as any)?.page_token;

        return json({ messages, has_more: hasMore, page_token: pageToken });
      } catch (err: any) {
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }
        logger.error(`[im_user_get_thread_messages] Error: ${err.message}`);
        return json({ error: err.message || 'Unknown error' });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[im] Registered feishu_im_user_get_thread_messages tool');
}

// ===========================================================================
// feishu_im_user_search_messages
// ===========================================================================

const SearchMessagesSchema = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: '搜索关键词，匹配消息内容。可为空字符串表示不按内容过滤',
    },
    sender_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '发送者 open_id 列表（ou_xxx）。如需根据用户名查找 open_id，请先使用 search_user 工具',
    },
    chat_id: {
      type: 'string',
      description: '限定搜索范围的会话 ID（oc_xxx）',
    },
    mention_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '被@用户的 open_id 列表',
    },
    message_type: {
      type: 'string',
      enum: ['file', 'image', 'media'],
      description: '消息类型过滤：file / image / media。为空则搜索所有类型',
    },
    sender_type: {
      type: 'string',
      enum: ['user', 'bot', 'all'],
      description: '发送者类型：user / bot / all。默认 user',
    },
    chat_type: {
      type: 'string',
      enum: ['group', 'p2p'],
      description: '会话类型：group（群聊）/ p2p（单聊）',
    },
    relative_time: {
      type: 'string',
      description:
        '相对时间范围：today / yesterday / day_before_yesterday / this_week / last_week / this_month / last_month / last_{N}_{unit}（unit: minutes/hours/days）。与 start_time/end_time 互斥',
    },
    start_time: {
      type: 'string',
      description: '起始时间（ISO 8601 格式，如 2026-02-27T00:00:00+08:00）。与 relative_time 互斥',
    },
    end_time: {
      type: 'string',
      description: '结束时间（ISO 8601 格式，如 2026-02-27T23:59:59+08:00）。与 relative_time 互斥',
    },
    page_size: {
      type: 'number',
      description: '每页消息数（1-50），默认 50',
      minimum: 1,
      maximum: 50,
    },
    page_token: {
      type: 'string',
      description: '分页标记，用于获取下一页',
    },
  },
  required: [],
};

function registerSearchMessages(registry: ToolRegistry, context: PluginToolContext) {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_im_user_search_messages',
    description:
      '【以用户身份】跨会话搜索飞书消息。' +
      '\n\n用法：' +
      '\n- 按关键词搜索消息内容' +
      '\n- 按发送者、被@用户、消息类型过滤' +
      '\n- 按时间范围过滤：relative_time 或 start_time/end_time' +
      '\n- 限定在某个会话内搜索（chat_id）' +
      '\n- 支持分页：page_size + page_token' +
      '\n\n【参数约束】' +
      '\n- 所有参数均可选，但至少应提供一个过滤条件' +
      '\n- relative_time 和 start_time/end_time 不能同时使用' +
      '\n- page_size 范围 1-50，默认 50' +
      '\n\n返回消息列表，每条消息包含 message_id、msg_type、content、sender、create_time 等字段。',
    parameters: SearchMessagesSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        if (p.relative_time && (p.start_time || p.end_time)) {
          return json({ error: 'cannot use both relative_time and start_time/end_time' });
        }

        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'im_user_search_messages' },
        });

        // 1. 构建搜索数据
        const time = resolveTimeRange(p, (msg) => logger.info(`[im_user_search_messages] ${msg}`));
        const searchData: Record<string, unknown> = {
          query: p.query ?? '',
          start_time: time.start ?? '978307200',
          end_time: time.end ?? Math.floor(Date.now() / 1000).toString(),
        };
        if (p.sender_ids?.length) searchData.from_ids = p.sender_ids;
        if (p.chat_id) searchData.chat_ids = [p.chat_id];
        if (p.mention_ids?.length) searchData.at_chatter_ids = p.mention_ids;
        if (p.message_type) searchData.message_type = p.message_type;
        if (p.sender_type && p.sender_type !== 'all') searchData.from_type = p.sender_type;
        if (p.chat_type) searchData.chat_type = p.chat_type === 'group' ? 'group_chat' : 'p2p_chat';

        logger.info(`[im_user_search_messages] search: query="${p.query ?? ''}", page_size=${p.page_size ?? 50}`);

        // 2. 搜索消息 ID
        const searchRes = await client.invoke(
          'feishu_im_user_search_messages.default',
          (sdk, opts) =>
            sdk.search.message.create(
              {
                data: searchData as any,
                params: {
                  user_id_type: 'open_id',
                  page_size: p.page_size ?? 50,
                  page_token: p.page_token,
                },
              },
              opts!
            ),
          { as: 'user' }
        );
        assertLarkOk(searchRes as any);

        const messageIds: string[] = (searchRes as any).data?.items ?? [];
        const hasMore: boolean = (searchRes as any).data?.has_more ?? false;
        const pageToken: string | undefined = (searchRes as any).data?.page_token;
        logger.info(`[im_user_search_messages] search: found ${messageIds.length} IDs, has_more=${hasMore}`);

        if (messageIds.length === 0) {
          return json({ messages: [], has_more: hasMore, page_token: pageToken });
        }

        // 3. 批量获取消息详情
        const queryStr = messageIds.map((id) => `message_ids=${encodeURIComponent(id)}`).join('&');
        const mgetRes = await client.invoke(
          'feishu_im_user_search_messages.mget',
          (sdk, opts) =>
            sdk.im.v1.message.get(
              {
                params: {
                  message_id: messageIds.join(','),
                  user_id_type: 'open_id',
                  card_msg_content_type: 'raw_card_content',
                },
              } as any,
              opts
            ),
          { as: 'user' }
        );

        const items = (mgetRes as any).data?.items ?? [];
        const messages = formatMessages(items);
        logger.info(`[im_user_search_messages] mget: ${items.length} details`);

        return json({ messages, has_more: hasMore, page_token: pageToken });
      } catch (err: any) {
        if (isAuthError(err)) {
          return json({
            error: err.message,
            requiresAuth: true,
            authGuide: getAuthGuide(err),
          });
        }
        logger.error(`[im_user_search_messages] Error: ${err.message}`);
        return json({ error: err.message || 'Unknown error' });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[im] Registered feishu_im_user_search_messages tool');
}

// ===========================================================================
// Unified registration
// ===========================================================================

export function registerMessageReadTools(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  registerGetMessages(registry, context);
  registerGetThreadMessages(registry, context);
  registerSearchMessages(registry, context);
}