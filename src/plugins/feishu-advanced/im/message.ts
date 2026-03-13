// src/plugins/feishu-advanced/im/message.ts

/**
 * feishu_im_user_message tool -- 以用户身份发送/回复 IM 消息
 *
 * Actions: send, reply
 *
 * Uses the Feishu IM API:
 *   - send:  POST /open-apis/im/v1/messages?receive_id_type=...
 *   - reply: POST /open-apis/im/v1/messages/:message_id/reply
 *
 * 全部以用户身份（user_access_token）调用
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

const FeishuImMessageSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['send', 'reply'],
      description: '操作类型',
    },
    // SEND 参数
    receive_id_type: {
      type: 'string',
      enum: ['open_id', 'chat_id'],
      description: '接收者 ID 类型：open_id（私聊，ou_xxx）、chat_id（群聊，oc_xxx）',
    },
    receive_id: {
      type: 'string',
      description: "接收者 ID，与 receive_id_type 对应。open_id 填 'ou_xxx'，chat_id 填 'oc_xxx'",
    },
    // REPLY 参数
    message_id: {
      type: 'string',
      description: '被回复消息的 ID（om_xxx 格式）',
    },
    // 通用参数
    msg_type: {
      type: 'string',
      enum: ['text', 'post', 'image', 'file', 'audio', 'media', 'interactive', 'share_chat', 'share_user'],
      description:
        '消息类型：text（纯文本）、post（富文本）、image（图片）、file（文件）、interactive（消息卡片）、share_chat（群名片）、share_user（个人名片）等',
    },
    content: {
      type: 'string',
      description:
        '消息内容（JSON 字符串），格式取决于 msg_type。' +
        "示例：text → '{\"text\":\"你好\"}'，" +
        "image → '{\"image_key\":\"img_xxx\"}'，" +
        "share_chat → '{\"chat_id\":\"oc_xxx\"}'，" +
        "post → '{\"zh_cn\":{\"title\":\"标题\",\"content\":[[{\"tag\":\"text\",\"text\":\"正文\"}]]}}'",
    },
    reply_in_thread: {
      type: 'boolean',
      description: '是否以话题形式回复。true 则消息出现在该消息的话题中，false（默认）则出现在聊天主流',
    },
    uuid: {
      type: 'string',
      description: '幂等唯一标识。同一 uuid 在 1 小时内只会发送一条消息，用于去重',
    },
  },
  required: ['action', 'msg_type', 'content'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerImUserMessageTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_im_user_message',
    description:
      '【以用户身份】飞书用户身份 IM 消息工具。**有且仅当用户明确要求以自己身份发消息、回复消息时使用，当没有明确要求时优先使用message系统工具**。' +
      '\n\nActions:' +
      '\n- send（发送消息）：发送消息到私聊或群聊。私聊用 receive_id_type=open_id，群聊用 receive_id_type=chat_id' +
      '\n- reply（回复消息）：回复指定 message_id 的消息，支持话题回复（reply_in_thread=true）' +
      '\n\n【重要】content 必须是合法 JSON 字符串，格式取决于 msg_type。' +
      "最常用：text 类型 content 为 '{\"text\":\"消息内容\"}'。" +
      '\n\n【安全约束】此工具以用户身份发送消息，发出后对方看到的发送者是用户本人。' +
      '调用前必须先向用户确认：1) 发送对象（哪个人或哪个群）2) 消息内容。' +
      '禁止在用户未明确同意的情况下自行发送消息。',
    parameters: FeishuImMessageSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'im_user_message' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // SEND MESSAGE
          // -----------------------------------------------------------------
          case 'send': {
            if (!p.receive_id_type || !p.receive_id) {
              return json({
                error: 'receive_id_type and receive_id are required for send action',
              });
            }

            logger.info(
              `[im_user_message] send: receive_id_type=${p.receive_id_type}, receive_id=${p.receive_id}, msg_type=${p.msg_type}`
            );

            const res = await client.invoke(
              'feishu_im_user_message.send',
              (sdk, opts) =>
                sdk.im.v1.message.create(
                  {
                    params: { receive_id_type: p.receive_id_type },
                    data: {
                      receive_id: p.receive_id,
                      msg_type: p.msg_type,
                      content: p.content,
                      uuid: p.uuid,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[im_user_message] send: message sent, message_id=${data?.message_id}`);

            return json({
              message_id: data?.message_id,
              chat_id: data?.chat_id,
              create_time: data?.create_time,
            });
          }

          // -----------------------------------------------------------------
          // REPLY MESSAGE
          // -----------------------------------------------------------------
          case 'reply': {
            if (!p.message_id) {
              return json({
                error: 'message_id is required for reply action',
              });
            }

            logger.info(
              `[im_user_message] reply: message_id=${p.message_id}, msg_type=${p.msg_type}, reply_in_thread=${p.reply_in_thread ?? false}`
            );

            const res = await client.invoke(
              'feishu_im_user_message.reply',
              (sdk, opts) =>
                sdk.im.v1.message.reply(
                  {
                    path: { message_id: p.message_id },
                    data: {
                      content: p.content,
                      msg_type: p.msg_type,
                      reply_in_thread: p.reply_in_thread,
                      uuid: p.uuid,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[im_user_message] reply: message sent, message_id=${data?.message_id}`);

            return json({
              message_id: data?.message_id,
              chat_id: data?.chat_id,
              create_time: data?.create_time,
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

        logger.error(`[im_user_message] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[im] Registered feishu_im_user_message tool');
}