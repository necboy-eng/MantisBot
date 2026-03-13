// src/plugins/feishu-advanced/bitable/app.ts

/**
 * feishu_bitable_app tool -- 飞书多维表格应用管理
 *
 * Actions: create, get, list, patch, copy
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

const FeishuBitableAppSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'get', 'list', 'patch', 'copy'],
      description: '操作类型',
    },
    name: { type: 'string', description: '多维表格名称（create/copy 时必需）' },
    app_token: { type: 'string', description: '多维表格 token（get/patch/copy 时必需）' },
    folder_token: { type: 'string', description: '所在文件夹 token（可选，默认创建在我的空间）' },
    is_advanced: { type: 'boolean', description: '是否开启高级权限（patch 时使用）' },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 200' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerBitableAppTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_bitable_app',
    description:
      '【以用户身份】飞书多维表格应用管理工具。当用户要求创建/查询/管理多维表格时使用。\n\n' +
      'Actions:\n' +
      '- create（创建新的多维表格应用）\n' +
      '- get（获取多维表格元数据）\n' +
      '- list（列出多维表格）\n' +
      '- patch（更新多维表格元数据）\n' +
      '- copy（复制多维表格）',
    parameters: FeishuBitableAppSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'bitable_app' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.name) {
              return json({
                error: 'name is required for create action',
              });
            }

            logger.info(`[bitable_app] create: name=${p.name}, folder_token=${p.folder_token ?? 'my_space'}`);

            const data: any = { name: p.name };
            if (p.folder_token) {
              data.folder_token = p.folder_token;
            }

            const res = await client.invoke(
              'feishu_bitable_app.create',
              (sdk, opts) =>
                sdk.bitable.app.create(
                  {
                    data,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app] created app ${res.data?.app?.app_token}`);

            return json({
              app: res.data?.app,
            });
          }

          // -----------------------------------------------------------------
          // GET
          // -----------------------------------------------------------------
          case 'get': {
            if (!p.app_token) {
              return json({
                error: 'app_token is required for get action',
              });
            }

            logger.info(`[bitable_app] get: app_token=${p.app_token}`);

            const res = await client.invoke(
              'feishu_bitable_app.get',
              (sdk, opts) =>
                sdk.bitable.app.get(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              app: res.data?.app,
            });
          }

          // -----------------------------------------------------------------
          // LIST - 使用 Drive API 筛选 bitable 类型文件
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[bitable_app] list: folder_token=${p.folder_token ?? 'my_space'}, page_size=${p.page_size ?? 50}`);

            const res = await client.invoke(
              'feishu_bitable_app.list',
              (sdk, opts) =>
                sdk.drive.v1.file.list(
                  {
                    params: {
                      folder_token: p.folder_token || '',
                      page_size: p.page_size,
                      page_token: p.page_token,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            // 筛选出 type === "bitable" 的文件
            const data = res.data as any;
            const bitables = data?.files?.filter((f: any) => f.type === 'bitable') || [];

            logger.info(`[bitable_app] list: returned ${bitables.length} bitable apps`);

            return json({
              apps: bitables,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // PATCH
          // -----------------------------------------------------------------
          case 'patch': {
            if (!p.app_token) {
              return json({
                error: 'app_token is required for patch action',
              });
            }

            logger.info(`[bitable_app] patch: app_token=${p.app_token}, name=${p.name}, is_advanced=${p.is_advanced}`);

            const updateData: any = {};
            if (p.name !== undefined) updateData.name = p.name;
            if (p.is_advanced !== undefined) updateData.is_advanced = p.is_advanced;

            const res = await client.invoke(
              'feishu_bitable_app.patch',
              (sdk, opts) =>
                sdk.bitable.app.update(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                    data: updateData,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app] patched app ${p.app_token}`);

            return json({
              app: res.data?.app,
            });
          }

          // -----------------------------------------------------------------
          // COPY
          // -----------------------------------------------------------------
          case 'copy': {
            if (!p.app_token) {
              return json({
                error: 'app_token is required for copy action',
              });
            }
            if (!p.name) {
              return json({
                error: 'name is required for copy action',
              });
            }

            logger.info(`[bitable_app] copy: app_token=${p.app_token}, name=${p.name}, folder_token=${p.folder_token ?? 'my_space'}`);

            const data: any = { name: p.name };
            if (p.folder_token) {
              data.folder_token = p.folder_token;
            }

            const res = await client.invoke(
              'feishu_bitable_app.copy',
              (sdk, opts) =>
                sdk.bitable.app.copy(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                    data,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app] copied to ${res.data?.app?.app_token}`);

            return json({
              app: res.data?.app,
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

        logger.error(`[bitable_app] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[bitable] Registered feishu_bitable_app tool');
}