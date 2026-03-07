// src/agents/tools/feishu/im/search-messages.ts

import { Tool } from '../../../types.js';
import { getFeishuClient } from '../client.js';
import { withFeishuErrorHandling } from '../helpers.js';

/**
 * 解析时间参数
 */
function parseTimeRange(params: any): { start?: string; end?: string } {
  if (params.start_time || params.end_time) {
    // 飞书搜索 API 使用秒级时间戳
    const start = params.start_time ? Math.floor(new Date(params.start_time).getTime() / 1000).toString() : undefined;
    const end = params.end_time ? Math.floor(new Date(params.end_time).getTime() / 1000).toString() : undefined;
    return { start, end };
  }
  return {};
}

/**
 * feishu_im_user_search_messages 工具
 */
export const searchMessagesTool: Tool = {
  name: 'feishu_im_user_search_messages',
  description: '【以用户身份】跨会话搜索飞书消息。' +
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
    '\n\n返回消息列表，每条消息包含 message_id、msg_type、content、sender、create_time 等字段。' +
    '\n每条消息还包含 chat_id、chat_type（p2p/group）、chat_name（群名或单聊对方名字）。' +
    '\n单聊消息额外包含 chat_partner（对方 open_id 和名字）。' +
    '\n搜索结果中的 chat_id 和 thread_id 可配合 feishu_im_get_messages / feishu_im_get_thread_messages 查看上下文。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，匹配消息内容。可为空字符串表示不按内容过滤',
      },
      sender_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '发送者的 open_id（ou_xxx）列表。如需根据用户名查找 open_id，请先使用 search_user 工具',
      },
      chat_id: {
        type: 'string',
        description: '限定搜索范围的会话 ID（oc_xxx）',
      },
      mention_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '被@用户的 open_id（ou_xxx）列表',
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
        description: '相对时间范围：today / yesterday / day_before_yesterday / this_week / last_week / this_month / last_month / last_{N}_{unit}（unit: minutes/hours/days）',
      },
      start_time: {
        type: 'string',
        description: '起始时间（ISO 8601 格式，如 2026-02-27T00:00:00+08:00）',
      },
      end_time: {
        type: 'string',
        description: '结束时间（ISO 8601 格式，如 2026-02-27T23:59:59+08:00）',
      },
      page_size: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        default: 50,
        description: '每页消息数（1-50），默认 50',
      },
      page_token: {
        type: 'string',
        description: '分页标记，用于获取下一页',
      },
    },
  },
  async execute(params, context) {
    return withFeishuErrorHandling(async () => {
      const client = await getFeishuClient(context?.userId);

      // 参数验证
      if (params.relative_time && (params.start_time || params.end_time)) {
        return { error: 'relative_time 和 start_time/end_time 不能同时使用' };
      }

      // 解析时间范围
      const timeRange = parseTimeRange(params);

      // 构建搜索数据
      const searchData: any = {
        query: params.query ?? '',
      };

      if (params.sender_ids?.length) {
        searchData.from_ids = params.sender_ids;
      }

      if (params.chat_id) {
        searchData.chat_ids = [params.chat_id];
      }

      if (params.mention_ids?.length) {
        searchData.at_chatter_ids = params.mention_ids;
      }

      if (params.message_type) {
        searchData.message_type = params.message_type;
      }

      if (params.sender_type && params.sender_type !== 'all') {
        searchData.from_type = params.sender_type;
      }

      if (params.chat_type) {
        searchData.chat_type = params.chat_type === 'group' ? 'group_chat' : 'p2p_chat';
      }

      // 默认时间范围（如果不指定）
      const searchTime = {
        start: timeRange.start || '978307200', // 2001-01-01
        end: timeRange.end || Math.floor(Date.now() / 1000).toString(),
      };

      const pageSize = params.page_size || 50;

      console.log('[FeishuIM] Searching messages:', {
        query: searchData.query,
        chatType: searchData.chat_type,
        timeRange: searchTime,
      });

      // 1. 搜索消息 ID
      const searchResponse = await client.search.message.create({
        data: searchData,
        params: {
          user_id_type: 'open_id',
          page_size: pageSize,
          page_token: params.page_token,
          start_time: searchTime.start,
          end_time: searchTime.end,
        },
      });

      if (searchResponse.code !== 0) {
        return { error: searchResponse.msg || `错误码: ${searchResponse.code}` };
      }

      const searchDataResult = searchResponse.data;
      const messageIds = searchDataResult.items || [];
      const hasMore = searchDataResult.has_more || false;
      const pageToken = searchDataResult.page_token;

      console.log('[FeishuIM] Search found IDs:', {
        count: messageIds.length,
        hasMore,
      });

      if (messageIds.length === 0) {
        return {
          messages: [],
          has_more,
          page_token: pageToken,
        };
      }

      // 2. 批量获取消息详情
      const queryStr = messageIds
        .map((id) => `message_ids=${encodeURIComponent(id)}`)
        .join('&');

      const mgetResponse = await client.request({
        method: 'GET',
        url: `/open-apis/im/v1/messages/mget?${queryStr}`,
        query: {
          user_id_type: 'open_id',
          card_msg_content_type: 'raw_card_content',
        },
        as: 'user',
      });

      if (mgetResponse.code !== 0) {
        return { error: mgetResponse.msg || `错误码: ${mgetResponse.code}` };
      }

      const items = mgetResponse.data?.items || [];
      const chatIds = [...new Set(items.map((i: any) => i.chat_id).filter(Boolean))];

      // 3. 批量获取会话信息
      let chatMap: Record<string, any> = {};
      if (chatIds.length > 0) {
        try {
          const chatResponse = await client.request({
            method: 'POST',
            url: '/open-apis/im/v1/chats/batch_query',
            body: { chat_ids: chatIds },
            query: { user_id_type: 'open_id' },
            as: 'user',
          });

          if (chatResponse.code === 0) {
            for (const chat of chatResponse.data?.items || []) {
              if (chat.chat_id) {
                chatMap[chat.chat_id] = {
                  name: chat.name || '',
                  chat_mode: chat.chat_mode || '',
                  p2p_target_id: chat.p2p_target_id,
                };
              }
            }
          }
        } catch (error: any) {
          console.warn('[FeishuIM] Failed to query chat contexts:', error.message);
        }
      }

      console.log('[FeishuIM] Batch query chats:', {
        count: Object.keys(chatMap).length,
      });

      // 4. 格式化消息
      const messages = items.map((item: any, idx: number) => {
        const chatId = item.chat_id;
        const ctx = chatId ? chatMap[chatId] : undefined;

        let formatted: any = {
          message_id: item.message_id,
          msg_type: item.msg_type,
          content: item.content,
          sender: item.sender,
          create_time: item.create_time,
          chat_id: chatId,
        };

        // 添加会话上下文
        if (ctx) {
          formatted.chat_type = ctx.chat_mode;
          formatted.chat_name = ctx.name || undefined;

          if (ctx.chat_mode === 'p2p' && ctx.p2p_target_id) {
            formatted.chat_type = 'p2p';
            formatted.chat_partner = {
              open_id: ctx.p2p_target_id,
              name: undefined, // 需要额外查询用户名
            };
          }
        }

        // 添加 thread_id
        if (item.thread_id) {
          formatted.thread_id = item.thread_id;
        }

        return formatted;
      });

      return {
        messages,
        has_more,
        page_token: pageToken,
      };
    }, 'feishu_im_user_search_messages');
  },
};
