// src/agents/tools/feishu/im/get-thread-messages.ts

import { Tool } from '../../../types.js';
import { getFeishuClient } from '../client.js';
import { withFeishuErrorHandling } from '../helpers.js';

/**
 * 排序规则转换
 */
function sortRuleToSortType(rule?: string): string {
  if (rule === 'create_time_asc') return 'ByCreateTimeAsc';
  if (rule === 'create_time_desc') return 'ByCreateTimeDesc';
  return 'ByCreateTimeDesc'; // 默认
}

/**
 * feishu_im_get_thread_messages 工具
 */
export const getThreadMessagesTool: Tool = {
  name: 'feishu_im_get_thread_messages',
  description: '【以用户身份】获取话题（thread）内的消息列表。' +
    '\n\n用法：' +
    '\n- 通过 thread_id（omt_xxx）获取话题内的所有消息' +
    '\n- 支持分页：page_size + page_token' +
    '\n\n【注意】话题消息不支持时间范围过滤（飞书 API 限制）' +
    '\n\n返回消息列表，格式同 feishu_im_get_messages。',
  parameters: {
    type: 'object',
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
    required: ['thread_id'],
  },
  async execute(params, context) {
    return withFeishuErrorHandling(async () => {
      const client = await getFeishuClient(context?.userId);
      const sortType = sortRuleToSortType(params.sort_rule);
      const pageSize = params.page_size || 50;

      console.log('[FeishuIM] Getting thread messages:', {
        threadId: params.thread_id,
        sortType,
        pageSize,
      });

      // 调用飞书 API
      const response = await client.im.v1.message.list({
        params: {
          container_id_type: 'thread',
          container_id: params.thread_id,
          sort_type: sortType,
          page_size: pageSize,
          page_token: params.page_token,
          card_msg_content_type: 'raw_card_content',
        },
        query: { user_id_type: 'open_id' },
        as: 'user', // 尝试以用户身份调用
      });

      if (response.code !== 0) {
        return { error: response.msg || `错误码: ${response.code}` };
      }

      const data = response.data;

      console.log('[FeishuIM] Retrieved thread messages:', {
        threadId: params.thread_id,
        count: data.items?.length || 0,
        hasMore: data.has_more,
      });

      // 格式化返回结果
      return {
        messages: data.items || [],
        has_more: data.has_more || false,
        page_token: data.page_token,
      };
    }, 'feishu_im_get_thread_messages');
  },
};
