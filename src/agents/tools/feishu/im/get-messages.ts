// src/agents/tools/feishu/im/get-messages.ts

import { getFeishuClient } from '../client.js';
import { withFeishuErrorHandling } from '../helpers.js';
import type { Tool } from '@/types.js';

/**
 * 排序规则转换
 */
function sortRuleToSortType(rule?: string): 'ByCreateTimeAsc' | 'ByCreateTimeDesc' {
  if (rule === 'create_time_asc') return 'ByCreateTimeAsc';
  if (rule === 'create_time_desc') return 'ByCreateTimeDesc';
  return 'ByCreateTimeDesc'; // 默认
}

/**
 * 解析时间参数为飞书 API 需要的时间戳格式（秒级）
 */
function parseTimeRange(params: any): { start?: string; end?: string } {
  if (params.start_time || params.end_time) {
    // 直接使用 ISO 格式（飞书 API 支持）
    const start = params.start_time ? new Date(params.start_time).toISOString() : undefined;
    const end = params.end_time ? new Date(params.end_time).toISOString() : undefined;
    return { start, end };
  }

  if (params.relative_time) {
    // 相对时间：飞书 API 支持字符串
    return {
      start: params.relative_time,
      end: undefined,
    };
  }

  return {};
}

/**
 * feishu_im_get_messages 工具
 */
export const getMessagesTool: Tool = {
  name: 'feishu_im_get_messages',
  description: '【以用户身份】获取飞书群聊或单聊的历史消息。' +
    '\n\n用法：' +
    '\n- 通过 chat_id 获取群聊/单聊消息' +
    '\n- 通过 open_id 获取与指定用户的单聊消息（自动解析 chat_id）' +
    '\n- 支持时间范围过滤：relative_time（如 today、last_3_days）或 start_time/end_time（ISO 8601 格式）' +
    '\n- 支持分页：page_size + page_token' +
    '\n\n【参数约束】' +
    '\n- open_id 和 chat_id 必须二选一，不能同时提供' +
    '\n- relative_time 和 start_time/end_time 不能同时使用' +
    '\n- page_size 范围 1-50，默认 50',
  parameters: {
    type: 'object',
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
        minimum: 1,
        maximum: 50,
        default: 50,
        description: '每页消息数（1-50），默认 50',
      },
      page_token: {
        type: 'string',
        description: '分页标记，用于获取下一页',
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
    },
  },
  async execute(params: any, context: any) {
    return withFeishuErrorHandling(async () => {
      // 参数验证
      if (params.open_id && params.chat_id) {
        return { error: 'open_id 和 chat_id 不能同时提供，请只传其中一个' };
      }

      if (!params.open_id && !params.chat_id) {
        return { error: 'open_id 和 chat_id 必须提供其中一个' };
      }

      if (params.relative_time && (params.start_time || params.end_time)) {
        return { error: 'relative_time 和 start_time/end_time 不能同时使用' };
      }

      const client = await getFeishuClient(context?.userId);
      let chatId = params.chat_id ?? '';

      // 如果提供了 open_id，解析为 chat_id（单聊）
      if (params.open_id) {
        try {
          const p2pResponse = await client.request({
            method: 'POST',
            url: '/open-apis/im/v1/chat_p2p/batch_query',
            data: { chatter_ids: [params.open_id] },
            params: { user_id_type: 'open_id' },
          });

          if (p2pResponse.code !== 0 || !p2pResponse.data?.p2p_chats?.length) {
            return { error: `未找到与 open_id=${params.open_id} 的单聊会话` };
          }

          chatId = p2pResponse.data.p2p_chats[0].chat_id;
        } catch (error: any) {
          return { error: `解析单聊会话失败：${error.message}` };
        }
      }

      // 解析时间范围
      const timeRange = parseTimeRange(params);
      const sortType = sortRuleToSortType(params.sort_rule);
      const pageSize = params.page_size || 50;

      console.log('[FeishuIM] Getting messages:', {
        chatId,
        sortType,
        pageSize,
        timeRange,
      });

      // 调用飞书 API - 使用类型断言绕过 SDK 类型限制
      const response = await client.im.v1.message.list({
        params: {
          container_id_type: 'chat',
          container_id: chatId,
          start_time: timeRange.start,
          end_time: timeRange.end,
          sort_type: sortType,
          page_size: pageSize,
          page_token: params.page_token,
        },
        query: {
          user_id_type: 'open_id',
          card_msg_content_type: 'raw_card_content',
        },
        // @ts-ignore - 飞书 SDK 支持 as 参数用于用户身份调用
        as: 'user',
      } as any);

      if (response.code !== 0) {
        return { error: response.msg || `错误码：${response.code}` };
      }

      const data = response.data as any;

      console.log('[FeishuIM] Retrieved messages:', {
        count: data.items?.length || 0,
        hasMore: data.has_more,
      });

      // 格式化返回结果
      return {
        messages: data.items || [],
        has_more: data.has_more || false,
        page_token: data.page_token,
      };
    }, 'feishu_im_get_messages');
  },
};
