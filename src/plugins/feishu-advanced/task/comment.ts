// src/plugins/feishu-advanced/task/comment.ts

/**
 * feishu_task_comment tool -- 飞书任务评论管理
 *
 * Actions: create, list, get
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

const FeishuTaskCommentSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'get'],
      description: '操作类型',
    },
    // Create 字段
    task_guid: { type: 'string', description: '任务 GUID' },
    content: { type: 'string', description: '评论内容（纯文本，最长 3000 字符）' },
    reply_to_comment_id: { type: 'string', description: '要回复的评论 ID（用于回复评论）' },
    // List 字段
    resource_id: { type: 'string', description: '要获取评论的资源 ID（任务 GUID）' },
    direction: {
      type: 'string',
      enum: ['asc', 'desc'],
      description: '排序方式（asc=从旧到新，desc=从新到旧，默认 asc）',
    },
    // List 参数
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
    // Get 字段
    comment_id: { type: 'string', description: '评论 ID' },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerTaskCommentTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_task_comment',
    description:
      '【以用户身份】飞书任务评论管理工具。当用户要求添加/查询任务评论、回复评论时使用。\n\n' +
      'Actions:\n' +
      '- create（添加评论）\n' +
      '- list（列出任务的所有评论）\n' +
      '- get（获取单个评论详情）',
    parameters: FeishuTaskCommentSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'comment' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            logger.info(`[comment] create: task_guid=${p.task_guid}, reply_to=${p.reply_to_comment_id ?? 'none'}`);

            const data: any = {
              content: p.content,
              resource_type: 'task',
              resource_id: p.task_guid,
            };

            if (p.reply_to_comment_id) {
              data.reply_to_comment_id = p.reply_to_comment_id;
            }

            const res = await client.invoke(
              'feishu_task_comment.create',
              (sdk, opts) =>
                sdk.task.v2.comment.create(
                  {
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[comment] created comment ${res.data?.comment?.id}`);

            return json({
              comment: res.data?.comment,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(
              `[comment] list: resource_id=${p.resource_id}, direction=${p.direction ?? 'asc'}, page_size=${p.page_size ?? 50}`
            );

            const res = await client.invoke(
              'feishu_task_comment.list',
              (sdk, opts) =>
                sdk.task.v2.comment.list(
                  {
                    params: {
                      resource_type: 'task',
                      resource_id: p.resource_id,
                      direction: p.direction,
                      page_size: p.page_size,
                      page_token: p.page_token,
                      user_id_type: 'open_id' as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[comment] list: returned ${data?.items?.length ?? 0} comments`);

            return json({
              comments: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET
          // -----------------------------------------------------------------
          case 'get': {
            logger.info(`[comment] get: comment_id=${p.comment_id}`);

            const res = await client.invoke(
              'feishu_task_comment.get',
              (sdk, opts) =>
                sdk.task.v2.comment.get(
                  {
                    path: {
                      comment_id: p.comment_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[comment] get: returned comment ${p.comment_id}`);

            return json({
              comment: res.data?.comment,
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

        logger.error(`[comment] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[task] Registered feishu_task_comment tool');
}