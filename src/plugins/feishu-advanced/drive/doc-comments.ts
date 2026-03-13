// src/plugins/feishu-advanced/drive/doc-comments.ts

/**
 * feishu_doc_comments tool -- 云文档评论管理
 *
 * 支持获取、创建、解决/恢复云文档评论
 * Actions: list, create, patch
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

const ReplyElementSchema = {
  type: 'object' as const,
  properties: {
    type: {
      type: 'string',
      enum: ['text', 'mention', 'link'],
      description: '元素类型',
    },
    text: { type: 'string', description: '文本内容(type=text时必填)' },
    open_id: { type: 'string', description: '被@用户的open_id(type=mention时必填)' },
    url: { type: 'string', description: '链接URL(type=link时必填)' },
  },
  required: ['type'],
};

const FeishuDocCommentsSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'create', 'patch'],
      description: '操作类型',
    },
    file_token: {
      type: 'string',
      description: '云文档token或wiki节点token(可从文档URL获取)。如果是wiki token，会自动转换为实际文档的obj_token',
    },
    file_type: {
      type: 'string',
      enum: ['doc', 'docx', 'sheet', 'file', 'slides', 'wiki'],
      description: '文档类型。wiki类型会自动解析为实际文档类型(docx/sheet/bitable等)',
    },
    // list action 参数
    is_whole: { type: 'boolean', description: '是否只获取全文评论(action=list时可选)' },
    is_solved: { type: 'boolean', description: '是否只获取已解决的评论(action=list时可选)' },
    page_size: { type: 'number', description: '分页大小' },
    page_token: { type: 'string', description: '分页标记' },
    // create action 参数
    elements: {
      type: 'array',
      items: ReplyElementSchema,
      description:
        '评论内容元素数组(action=create时必填)。支持text(纯文本)、mention(@用户)、link(超链接)三种类型',
    },
    // patch action 参数
    comment_id: { type: 'string', description: '评论ID(action=patch时必填)' },
    is_solved_value: { type: 'boolean', description: '解决状态:true=解决,false=恢复(action=patch时必填)' },
    user_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '用户 ID 类型',
    },
  },
  required: ['action', 'file_token', 'file_type'],
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function convertElementsToSDKFormat(elements: any[]) {
  return elements.map((el) => {
    if (el.type === 'text') {
      return {
        type: 'text_run',
        text_run: { text: el.text! },
      };
    } else if (el.type === 'mention') {
      return {
        type: 'person',
        person: { user_id: el.open_id! },
      };
    } else if (el.type === 'link') {
      return {
        type: 'docs_link',
        docs_link: { url: el.url! },
      };
    }
    return { type: 'text_run', text_run: { text: '' } };
  });
}

/**
 * 组装评论和回复数据
 * 获取评论列表API会返回部分回复,但可能不完整
 * 此函数会为每个评论获取完整的回复列表
 */
async function assembleCommentsWithReplies(
  client: any,
  file_token: string,
  file_type: string,
  comments: any[],
  user_id_type: string,
  logger: any,
) {
  const result = [];

  for (const comment of comments) {
    const assembled: any = { ...comment };

    // 如果评论有回复,获取完整的回复列表
    if (comment.reply_list?.replies?.length > 0 || comment.has_more) {
      try {
        const replies = [];
        let pageToken: string | undefined = undefined;
        let hasMore = true;

        while (hasMore) {
          const replyRes = await client.invoke(
            'drive.v1.fileCommentReply.list',
            (sdk: any, opts: any) =>
              sdk.drive.v1.fileCommentReply.list(
                {
                  path: {
                    file_token,
                    comment_id: comment.comment_id,
                  },
                  params: {
                    file_type,
                    page_token: pageToken,
                    page_size: 50,
                    user_id_type,
                  },
                },
                opts,
              ),
            { as: 'user' },
          );

          const replyData = replyRes.data as any;
          if (replyRes.code === 0 && replyData?.items) {
            replies.push(...(replyData.items || []));
            hasMore = replyData.has_more || false;
            pageToken = replyData.page_token;
          } else {
            break;
          }
        }

        assembled.reply_list = { replies };
        logger.info(`[doc_comments] Assembled ${replies.length} replies for comment ${comment.comment_id}`);
      } catch (err) {
        logger.warn(`[doc_comments] Failed to fetch replies for comment ${comment.comment_id}: ${err}`);
        // 保留原始回复数据
      }
    }

    result.push(assembled);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerDocCommentsTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_doc_comments',
    description:
      '【以用户身份】管理云文档评论。支持: ' +
      '(1) list - 获取评论列表(含完整回复); ' +
      '(2) create - 添加全文评论(支持文本、@用户、超链接); ' +
      '(3) patch - 解决/恢复评论。' +
      '支持 wiki token。',
    parameters: FeishuDocCommentsSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'doc_comments' },
        });

        const userIdType = p.user_id_type || 'open_id';

        // 如果是 wiki token，先转换为实际的 obj_token 和 obj_type
        let actualFileToken = p.file_token;
        let actualFileType = p.file_type;

        if (p.file_type === 'wiki') {
          logger.info(`[doc_comments] detected wiki token="${p.file_token}", converting to obj_token...`);

          try {
            const wikiNodeRes = await client.invoke(
              'feishu_wiki_space_node.get',
              (sdk: any, opts: any) =>
                sdk.wiki.space.getNode(
                  {
                    params: {
                      token: p.file_token,
                      obj_type: 'wiki',
                    },
                  },
                  opts,
                ),
              { as: 'user' },
            );
            assertLarkOk(wikiNodeRes as any);

            const node = (wikiNodeRes as any).data?.node;
            if (!node || !node.obj_token || !node.obj_type) {
              return json({
                error: `failed to resolve wiki token "${p.file_token}" to document object (may be a folder node rather than a document)`,
                wiki_node: node,
              });
            }

            actualFileToken = node.obj_token;
            actualFileType = node.obj_type;

            logger.info(
              `[doc_comments] wiki token converted: obj_token="${actualFileToken}", obj_type="${actualFileType}"`,
            );
          } catch (err) {
            logger.error(`[doc_comments] failed to convert wiki token: ${err}`);
            return json({
              error: `failed to resolve wiki token "${p.file_token}": ${err}`,
            });
          }
        }

        // Action: list - 获取评论列表
        if (p.action === 'list') {
          logger.info(`[doc_comments] list: file_token="${actualFileToken}", file_type=${actualFileType}`);

          const res = await client.invoke(
            'feishu_doc_comments.list',
            (sdk: any, opts: any) =>
              sdk.drive.v1.fileComment.list(
                {
                  path: { file_token: actualFileToken },
                  params: {
                    file_type: actualFileType,
                    is_whole: p.is_whole,
                    is_solved: p.is_solved,
                    page_size: p.page_size || 50,
                    page_token: p.page_token,
                    user_id_type: userIdType,
                  },
                },
                opts,
              ),
            { as: 'user' },
          );
          assertLarkOk(res as any);

          const items = ((res as any).data as any)?.items || [];
          logger.info(`[doc_comments] list: found ${items.length} comments`);

          // 组装评论和完整回复
          const assembledItems = await assembleCommentsWithReplies(
            client,
            actualFileToken,
            actualFileType,
            items,
            userIdType,
            logger,
          );

          return json({
            items: assembledItems,
            has_more: ((res as any).data as any)?.has_more ?? false,
            page_token: ((res as any).data as any)?.page_token,
          });
        }

        // Action: create - 创建评论
        if (p.action === 'create') {
          if (!p.elements || p.elements.length === 0) {
            return json({
              error: 'elements 参数必填且不能为空',
            });
          }

          logger.info(`[doc_comments] create: file_token="${actualFileToken}", elements=${p.elements.length}`);

          const sdkElements = convertElementsToSDKFormat(p.elements);

          const res = await client.invoke(
            'feishu_doc_comments.create',
            (sdk: any, opts: any) =>
              sdk.drive.v1.fileComment.create(
                {
                  path: { file_token: actualFileToken },
                  params: {
                    file_type: actualFileType,
                    user_id_type: userIdType,
                  },
                  data: {
                    reply_list: {
                      replies: [
                        {
                          content: {
                            elements: sdkElements,
                          },
                        },
                      ],
                    },
                  },
                },
                opts,
              ),
            { as: 'user' },
          );
          assertLarkOk(res as any);

          logger.info(`[doc_comments] create: created comment ${((res as any).data as any)?.comment_id}`);

          return json((res as any).data);
        }

        // Action: patch - 解决/恢复评论
        if (p.action === 'patch') {
          if (!p.comment_id) {
            return json({
              error: 'comment_id 参数必填',
            });
          }
          if (p.is_solved_value === undefined) {
            return json({
              error: 'is_solved_value 参数必填',
            });
          }

          logger.info(`[doc_comments] patch: comment_id="${p.comment_id}", is_solved=${p.is_solved_value}`);

          const res = await client.invoke(
            'feishu_doc_comments.patch',
            (sdk: any, opts: any) =>
              sdk.drive.v1.fileComment.patch(
                {
                  path: {
                    file_token: actualFileToken,
                    comment_id: p.comment_id!,
                  },
                  params: {
                    file_type: actualFileType,
                  },
                  data: {
                    is_solved: p.is_solved_value!,
                  },
                },
                opts,
              ),
            { as: 'user' },
          );
          assertLarkOk(res as any);

          logger.info(`[doc_comments] patch: success`);

          return json({ success: true });
        }

        return json({
          error: `未知的 action: ${p.action}`,
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

        logger.error(`[doc_comments] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[drive] Registered feishu_doc_comments tool');
}