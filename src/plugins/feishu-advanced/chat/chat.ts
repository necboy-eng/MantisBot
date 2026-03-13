// src/plugins/feishu-advanced/chat/chat.ts

/**
 * feishu_chat tool -- 管理飞书群聊
 *
 * Actions:
 *   - search: 搜索对用户或机器人可见的群列表
 *   - get:    获取指定群的详细信息
 *
 * Uses the Feishu IM v1 API:
 *   - search: GET /open-apis/im/v1/chats/search
 *   - get:    GET /open-apis/im/v1/chats/:chat_id
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

const FeishuChatSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'get'],
      description: '操作类型',
    },
    // SEARCH 参数
    query: {
      type: 'string',
      description: '搜索关键词（search 时必填）。支持匹配群名称、群成员名称。支持多语种、拼音、前缀等模糊搜索。',
    },
    page_size: {
      type: 'number',
      description: '分页大小（默认20）',
      minimum: 1,
    },
    page_token: {
      type: 'string',
      description: '分页标记。首次请求无需填写',
    },
    // GET 参数
    chat_id: {
      type: 'string',
      description: '群 ID（格式如 oc_xxx）',
    },
    // 通用参数
    user_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '用户 ID 类型（默认 open_id）',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Params type
// ---------------------------------------------------------------------------

type FeishuChatParams =
  | {
      action: 'search';
      query: string;
      page_size?: number;
      page_token?: string;
      user_id_type?: 'open_id' | 'union_id' | 'user_id';
    }
  | {
      action: 'get';
      chat_id: string;
      user_id_type?: 'open_id' | 'union_id' | 'user_id';
    };

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerChatTool(registry: ToolRegistry, context: PluginToolContext): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_chat',
    description:
      '【以用户身份】飞书群聊管理工具。Actions: search（搜索群列表，支持关键词匹配群名称、群成员）, get（获取指定群的详细信息，包括群名称、描述、头像、群主、权限配置等）。',
    parameters: FeishuChatSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as unknown as FeishuChatParams;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'chat' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // SEARCH
          // -----------------------------------------------------------------
          case 'search': {
            logger.info(`[chat] search: query="${p.query}", page_size=${p.page_size ?? 20}`);

            const res = await client.invoke(
              'feishu_chat.search',
              (sdk, opts) =>
                sdk.im.v1.chat.search(
                  {
                    params: {
                      user_id_type: p.user_id_type || 'open_id',
                      query: p.query,
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
            const chatCount = data?.items?.length ?? 0;
            logger.info(`[chat] search: found ${chatCount} chats`);

            return json({
              items: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET
          // -----------------------------------------------------------------
          case 'get': {
            logger.info(`[chat] get: chat_id=${p.chat_id}, user_id_type=${p.user_id_type ?? 'open_id'}`);

            const res = await client.invoke(
              'feishu_chat.get',
              (sdk, opts) =>
                sdk.im.v1.chat.get(
                  {
                    path: {
                      chat_id: p.chat_id,
                    },
                    params: {
                      user_id_type: p.user_id_type || 'open_id',
                    },
                  },
                  {
                    ...(opts ?? {}),
                    headers: {
                      ...((opts as any)?.headers ?? {}),
                      'X-Chat-Custom-Header': 'enable_chat_list_security_check',
                    },
                  } as any
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[chat] get: retrieved chat info for ${p.chat_id}`);

            return json({
              chat: res.data,
            });
          }

          default:
            return json({
              error: `Unknown action: ${(p as any).action}`,
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

        logger.error(`[chat] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[chat] Registered feishu_chat tool');
}