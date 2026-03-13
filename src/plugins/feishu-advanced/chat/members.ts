// src/plugins/feishu-advanced/chat/members.ts

/**
 * feishu_chat_members tool -- 获取群成员列表
 *
 * 获取指定群组的成员信息，包括成员名字与 ID
 * 使用 sdk.im.v1.chatMembers.get 接口
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

const ChatMembersSchema = {
  type: 'object' as const,
  properties: {
    chat_id: {
      type: 'string',
      description: '群 ID（格式如 oc_xxx）。可以通过 feishu_chat 工具搜索获取',
    },
    member_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '成员 ID 类型（默认 open_id）',
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
  },
  required: ['chat_id'],
};

// ---------------------------------------------------------------------------
// Params type
// ---------------------------------------------------------------------------

interface ChatMembersParams {
  chat_id: string;
  member_id_type?: 'open_id' | 'union_id' | 'user_id';
  page_size?: number;
  page_token?: string;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerChatMembersTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_chat_members',
    description:
      '【以用户身份】获取指定群组的成员列表。\n' +
      '返回成员信息，包含成员 ID、姓名等。\n' +
      '注意：不会返回群组内的机器人成员。',
    parameters: ChatMembersSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as unknown as ChatMembersParams;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'chat_members' },
        });

        logger.info(`[chat_members] chat_id="${p.chat_id}", page_size=${p.page_size ?? 20}`);

        const res = await client.invoke(
          'feishu_chat_members.default',
          (sdk, opts) =>
            sdk.im.v1.chatMembers.get(
              {
                path: { chat_id: p.chat_id },
                params: {
                  member_id_type: p.member_id_type || 'open_id',
                  page_size: p.page_size,
                  page_token: p.page_token,
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

        const data = res.data as any;
        const memberCount = data?.items?.length ?? 0;
        const memberTotal = data?.member_total ?? 0;
        logger.info(`[chat_members] found ${memberCount} members (total: ${memberTotal})`);

        return json({
          items: data?.items,
          has_more: data?.has_more ?? false,
          page_token: data?.page_token,
          member_total: memberTotal,
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

        logger.error(`[chat_members] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[chat] Registered feishu_chat_members tool');
}