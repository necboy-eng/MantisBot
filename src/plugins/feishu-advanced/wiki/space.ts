// src/plugins/feishu-advanced/wiki/space.ts

/**
 * feishu_wiki_space tool -- 飞书知识库空间管理
 *
 * Actions: list, get, create
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

const FeishuWikiSpaceSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'get', 'create'],
      description: '操作类型',
    },
    // list 参数
    page_size: {
      type: 'number',
      description: '分页大小（默认 10，最大 50）',
      minimum: 1,
      maximum: 50,
    },
    page_token: {
      type: 'string',
      description: '分页标记。首次请求无需填写',
    },
    // get 参数
    space_id: {
      type: 'string',
      description: '知识空间 ID（必填）',
    },
    // create 参数
    name: {
      type: 'string',
      description: '知识空间名称',
    },
    description: {
      type: 'string',
      description: '知识空间描述',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerWikiSpaceTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_wiki_space',
    description:
      '【以用户身份】飞书知识空间管理工具。当用户要求查看知识库列表、获取知识库信息、创建知识库时使用。\n\n' +
      'Actions:\n' +
      '- list（列出知识空间）\n' +
      '- get（获取知识空间信息）\n' +
      '- create（创建知识空间）\n\n' +
      '【重要】space_id 可以从浏览器 URL 中获取，或通过 list 接口获取。\n' +
      '【重要】知识空间（Space）是知识库的基本组成单位，包含多个具有层级关系的文档节点。',
    parameters: FeishuWikiSpaceSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'wiki_space' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // LIST SPACES
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[wiki_space] list: page_size=${p.page_size ?? 10}`);

            const res = await client.invoke(
              'feishu_wiki_space.list',
              (sdk, opts) =>
                sdk.wiki.space.list(
                  {
                    params: {
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
            logger.info(`[wiki_space] list: returned ${data?.items?.length ?? 0} spaces`);

            return json({
              spaces: data?.items,
              has_more: data?.has_more,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET SPACE
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.space_id) {
              return json({
                error: 'space_id is required for get action',
              });
            }

            logger.info(`[wiki_space] get: space_id=${p.space_id}`);

            const res = await client.invoke(
              'feishu_wiki_space.get',
              (sdk, opts) =>
                sdk.wiki.space.get(
                  {
                    path: { space_id: p.space_id },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space] get: retrieved space ${p.space_id}`);

            return json({
              space: res.data?.space,
            });
          }

          // -----------------------------------------------------------------
          // CREATE SPACE
          // -----------------------------------------------------------------
          case 'create': {
            logger.info(`[wiki_space] create: name=${p.name ?? '(empty)'}, description=${p.description ?? '(empty)'}`);

            const res = await client.invoke(
              'feishu_wiki_space.create',
              (sdk, opts) =>
                sdk.wiki.space.create(
                  {
                    data: {
                      name: p.name,
                      description: p.description,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space] create: created space_id=${(res.data?.space as any)?.space_id}`);

            return json({
              space: res.data?.space,
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

        logger.error(`[wiki_space] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[wiki] Registered feishu_wiki_space tool');
}