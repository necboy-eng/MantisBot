// src/plugins/feishu-advanced/bitable/app-table-view.ts

/**
 * feishu_bitable_app_table_view tool -- 飞书多维表格视图管理
 *
 * Actions: create, get, list, patch, delete
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

const FeishuBitableAppTableViewSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'get', 'list', 'patch', 'delete'],
      description: '操作类型',
    },
    app_token: { type: 'string', description: '多维表格 token' },
    table_id: { type: 'string', description: '数据表 ID' },
    view_id: { type: 'string', description: '视图 ID（get/patch/delete 时必需）' },
    view_name: { type: 'string', description: '视图名称' },
    view_type: {
      type: 'string',
      enum: ['grid', 'kanban', 'gallery', 'gantt', 'form'],
      description: '视图类型：grid(表格), kanban(看板), gallery(画册), gantt(甘特图), form(表单)',
    },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action', 'app_token', 'table_id'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerBitableAppTableViewTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_bitable_app_table_view',
    description:
      '【以用户身份】飞书多维表格视图管理工具。当用户要求创建/查询/更新/删除视图、切换展示方式时使用。\n\n' +
      'Actions:\n' +
      '- create（创建视图）\n' +
      '- get（获取视图详情）\n' +
      '- list（列出所有视图）\n' +
      '- patch（更新视图）\n' +
      '- delete（删除视图）',
    parameters: FeishuBitableAppTableViewSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'bitable_app_table_view' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.view_name) {
              return json({
                error: 'view_name is required for create action',
              });
            }

            logger.info(
              `[bitable_app_table_view] create: app_token=${p.app_token}, table_id=${p.table_id}, view_name=${p.view_name}, view_type=${p.view_type ?? 'grid'}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_view.create',
              (sdk, opts) =>
                sdk.bitable.appTableView.create(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    data: {
                      view_name: p.view_name,
                      view_type: (p.view_type || 'grid') as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table_view] created view ${res.data?.view?.view_id}`);

            return json({
              view: res.data?.view,
            });
          }

          // -----------------------------------------------------------------
          // GET
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.view_id) {
              return json({
                error: 'view_id is required for get action',
              });
            }

            logger.info(
              `[bitable_app_table_view] get: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_view.get',
              (sdk, opts) =>
                sdk.bitable.appTableView.get(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      view_id: p.view_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              view: res.data?.view,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(
              `[bitable_app_table_view] list: app_token=${p.app_token}, table_id=${p.table_id}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_view.list',
              (sdk, opts) =>
                sdk.bitable.appTableView.list(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
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

            logger.info(`[bitable_app_table_view] list: returned ${data?.items?.length ?? 0} views`);

            return json({
              views: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // PATCH
          // -----------------------------------------------------------------
          case 'patch': {
            if (!p.view_id) {
              return json({
                error: 'view_id is required for patch action',
              });
            }

            logger.info(
              `[bitable_app_table_view] patch: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id}, view_name=${p.view_name}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_view.patch',
              (sdk, opts) =>
                sdk.bitable.appTableView.patch(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      view_id: p.view_id,
                    },
                    data: {
                      view_name: p.view_name,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table_view] patched view ${p.view_id}`);

            return json({
              view: res.data?.view,
            });
          }

          // -----------------------------------------------------------------
          // DELETE
          // -----------------------------------------------------------------
          case 'delete': {
            if (!p.view_id) {
              return json({
                error: 'view_id is required for delete action',
              });
            }

            logger.info(
              `[bitable_app_table_view] delete: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_view.delete',
              (sdk, opts) =>
                sdk.bitable.appTableView.delete(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      view_id: p.view_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table_view] deleted view ${p.view_id}`);

            return json({
              success: true,
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

        logger.error(`[bitable_app_table_view] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[bitable] Registered feishu_bitable_app_table_view tool');
}