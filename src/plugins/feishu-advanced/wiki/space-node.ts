// src/plugins/feishu-advanced/wiki/space-node.ts

/**
 * feishu_wiki_space_node tool -- 飞书知识库节点管理
 *
 * Actions: list, get, create, move, copy
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

const FeishuWikiSpaceNodeSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'get', 'create', 'move', 'copy'],
      description: '操作类型',
    },
    // list 参数
    space_id: {
      type: 'string',
      description: '知识空间 ID',
    },
    parent_node_token: {
      type: 'string',
      description: '父节点 token，不填则查询根目录',
    },
    page_size: {
      type: 'number',
      description: '分页大小',
      minimum: 1,
    },
    page_token: {
      type: 'string',
      description: '分页标记',
    },
    // get 参数
    token: {
      type: 'string',
      description: '节点 token',
    },
    obj_type: {
      type: 'string',
      enum: ['doc', 'sheet', 'mindnote', 'bitable', 'file', 'docx', 'slides', 'wiki'],
      description: '对象类型',
    },
    // create 参数
    node_type: {
      type: 'string',
      enum: ['origin', 'shortcut'],
      description: '节点类型：origin（创建新文档）或 shortcut（创建快捷方式）',
    },
    origin_node_token: {
      type: 'string',
      description: '原节点 token（创建快捷方式时使用）',
    },
    title: {
      type: 'string',
      description: '节点标题',
    },
    // move 参数
    node_token: {
      type: 'string',
      description: '节点 token',
    },
    target_parent_token: {
      type: 'string',
      description: '目标父节点 token',
    },
    // copy 参数
    target_space_id: {
      type: 'string',
      description: '目标知识空间 ID',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerWikiSpaceNodeTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_wiki_space_node',
    description:
      '【以用户身份】飞书知识库节点管理工具。用于操作知识库中的文档节点。\n\n' +
      'Actions:\n' +
      '- list（列出节点）\n' +
      '- get（获取节点信息）\n' +
      '- create（创建节点）\n' +
      '- move（移动节点）\n' +
      '- copy（复制节点）\n\n' +
      '节点是知识库中的文档，包括 doc、bitable(多维表格)、sheet(电子表格) 等类型。\n' +
      'node_token 是节点的唯一标识符，obj_token 是实际文档的 token。可通过 get 操作将 wiki 类型的 node_token 转换为实际文档的 obj_token。',
    parameters: FeishuWikiSpaceNodeSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'wiki_space_node' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // LIST NODES
          // -----------------------------------------------------------------
          case 'list': {
            if (!p.space_id) {
              return json({
                error: 'space_id is required for list action',
              });
            }

            logger.info(
              `[wiki_space_node] list: space_id=${p.space_id}, parent=${p.parent_node_token ?? '(root)'}, page_size=${p.page_size ?? 50}`
            );

            const res = await client.invoke(
              'feishu_wiki_space_node.list',
              (sdk, opts) =>
                sdk.wiki.spaceNode.list(
                  {
                    path: { space_id: p.space_id },
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                      parent_node_token: p.parent_node_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[wiki_space_node] list: returned ${data?.items?.length ?? 0} nodes`);

            return json({
              nodes: data?.items,
              has_more: data?.has_more,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // GET NODE
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.token) {
              return json({
                error: 'token is required for get action',
              });
            }

            logger.info(`[wiki_space_node] get: token=${p.token}, obj_type=${p.obj_type ?? 'wiki'}`);

            const res = await client.invoke(
              'feishu_wiki_space_node.get',
              (sdk, opts) =>
                sdk.wiki.space.getNode(
                  {
                    params: {
                      token: p.token,
                      obj_type: (p.obj_type || 'wiki') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space_node] get: retrieved node ${p.token}`);

            return json({
              node: res.data?.node,
            });
          }

          // -----------------------------------------------------------------
          // CREATE NODE
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.space_id) {
              return json({
                error: 'space_id is required for create action',
              });
            }
            if (!p.obj_type) {
              return json({
                error: 'obj_type is required for create action',
              });
            }

            logger.info(
              `[wiki_space_node] create: space_id=${p.space_id}, obj_type=${p.obj_type}, parent=${p.parent_node_token ?? '(root)'}, title=${p.title ?? '(empty)'}`
            );

            const res = await client.invoke(
              'feishu_wiki_space_node.create',
              (sdk, opts) =>
                sdk.wiki.spaceNode.create(
                  {
                    path: { space_id: p.space_id },
                    data: {
                      obj_type: p.obj_type as any,
                      parent_node_token: p.parent_node_token,
                      node_type: p.node_type as any,
                      origin_node_token: p.origin_node_token,
                      title: p.title,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space_node] create: created node_token=${(res.data?.node as any)?.node_token}`);

            return json({
              node: res.data?.node,
            });
          }

          // -----------------------------------------------------------------
          // MOVE NODE
          // -----------------------------------------------------------------
          case 'move': {
            if (!p.space_id) {
              return json({
                error: 'space_id is required for move action',
              });
            }
            if (!p.node_token) {
              return json({
                error: 'node_token is required for move action',
              });
            }

            logger.info(
              `[wiki_space_node] move: space_id=${p.space_id}, node_token=${p.node_token}, target_parent=${p.target_parent_token ?? '(root)'}`
            );

            const res = await client.invoke(
              'feishu_wiki_space_node.move',
              (sdk, opts) =>
                sdk.wiki.spaceNode.move(
                  {
                    path: {
                      space_id: p.space_id,
                      node_token: p.node_token,
                    },
                    data: {
                      target_parent_token: p.target_parent_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space_node] move: moved node ${p.node_token}`);

            return json({
              node: res.data?.node,
            });
          }

          // -----------------------------------------------------------------
          // COPY NODE
          // -----------------------------------------------------------------
          case 'copy': {
            if (!p.space_id) {
              return json({
                error: 'space_id is required for copy action',
              });
            }
            if (!p.node_token) {
              return json({
                error: 'node_token is required for copy action',
              });
            }

            logger.info(
              `[wiki_space_node] copy: space_id=${p.space_id}, node_token=${p.node_token}, target_space=${p.target_space_id ?? '(same)'}, target_parent=${p.target_parent_token ?? '(root)'}`
            );

            const res = await client.invoke(
              'feishu_wiki_space_node.copy',
              (sdk, opts) =>
                sdk.wiki.spaceNode.copy(
                  {
                    path: {
                      space_id: p.space_id,
                      node_token: p.node_token,
                    },
                    data: {
                      target_space_id: p.target_space_id,
                      target_parent_token: p.target_parent_token,
                      title: p.title,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[wiki_space_node] copy: copied to node_token=${(res.data?.node as any)?.node_token}`);

            return json({
              node: res.data?.node,
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

        logger.error(`[wiki_space_node] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[wiki] Registered feishu_wiki_space_node tool');
}