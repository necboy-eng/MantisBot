// src/plugins/feishu-advanced/bitable/app-table.ts

/**
 * feishu_bitable_app_table tool -- 飞书多维表格数据表管理
 *
 * Actions: create, list, patch, delete, batch_create, batch_delete
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

const FeishuBitableAppTableSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'patch', 'delete', 'batch_create', 'batch_delete'],
      description: '操作类型',
    },
    app_token: { type: 'string', description: '多维表格 token' },
    table_id: { type: 'string', description: '数据表 ID（patch/delete 时必需）' },
    table_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '要删除的数据表 ID 列表（batch_delete 时使用）',
    },
    table: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '数据表名称' },
        default_view_name: { type: 'string', description: '默认视图名称' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field_name: { type: 'string', description: '字段名称' },
              type: {
                type: 'number',
                description:
                  '字段类型（1=文本，2=数字，3=单选，4=多选，5=日期，7=复选框，11=人员，13=电话，15=超链接，17=附件，1001=创建时间，1002=修改时间等）',
              },
              property: { type: 'object', description: '字段属性配置（根据类型而定）' },
            },
          },
          description: '字段列表（可选，但强烈建议在创建表时就传入所有字段）',
        },
      },
      description: '数据表定义（create 时使用）',
    },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '数据表名称' },
        },
      },
      description: '要批量创建的数据表列表（batch_create 时使用）',
    },
    name: { type: 'string', description: '新的表名（patch 时使用）' },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action', 'app_token'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerBitableAppTableTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_bitable_app_table',
    description:
      '【以用户身份】飞书多维表格数据表管理工具。当用户要求创建/查询/管理数据表时使用。\n\n' +
      'Actions:\n' +
      '- create（创建数据表，可选择在创建时传入 fields 数组定义字段）\n' +
      '- list（列出所有数据表）\n' +
      '- patch（更新数据表）\n' +
      '- delete（删除数据表）\n' +
      '- batch_create（批量创建）\n' +
      '- batch_delete（批量删除）',
    parameters: FeishuBitableAppTableSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'bitable_app_table' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.table || !p.table.name) {
              return json({
                error: 'table.name is required for create action',
              });
            }

            logger.info(
              `[bitable_app_table] create: app_token=${p.app_token}, table_name=${p.table.name}, fields_count=${p.table.fields?.length ?? 0}`
            );

            // 特殊处理：复选框（type=7）和超链接（type=15）字段不能传 property
            const tableData = { ...p.table };
            if (tableData.fields) {
              tableData.fields = tableData.fields.map((field: any) => {
                if ((field.type === 7 || field.type === 15) && field.property !== undefined) {
                  const fieldTypeName = field.type === 15 ? 'URL' : 'Checkbox';
                  logger.warn(
                    `[bitable_app_table] ${fieldTypeName} field (type=${field.type}, name="${field.field_name}") detected with property. Removing property to avoid API error.`
                  );
                  const { property: _property, ...fieldWithoutProperty } = field;
                  return fieldWithoutProperty;
                }
                return field;
              });
            }

            const res = await client.invoke(
              'feishu_bitable_app_table.create',
              (sdk, opts) =>
                sdk.bitable.appTable.create(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                    data: {
                      table: tableData,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table] created table ${res.data?.table_id}`);

            return json({
              table_id: res.data?.table_id,
              default_view_id: res.data?.default_view_id,
              field_id_list: res.data?.field_id_list,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[bitable_app_table] list: app_token=${p.app_token}, page_size=${p.page_size ?? 50}`);

            const res = await client.invoke(
              'feishu_bitable_app_table.list',
              (sdk, opts) =>
                sdk.bitable.appTable.list(
                  {
                    path: {
                      app_token: p.app_token,
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

            logger.info(`[bitable_app_table] list: returned ${data?.items?.length ?? 0} tables`);

            return json({
              tables: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // PATCH
          // -----------------------------------------------------------------
          case 'patch': {
            if (!p.table_id) {
              return json({
                error: 'table_id is required for patch action',
              });
            }

            logger.info(`[bitable_app_table] patch: app_token=${p.app_token}, table_id=${p.table_id}, name=${p.name}`);

            const res = await client.invoke(
              'feishu_bitable_app_table.patch',
              (sdk, opts) =>
                sdk.bitable.appTable.patch(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    data: {
                      name: p.name,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table] patched table ${p.table_id}`);

            return json({
              name: res.data?.name,
            });
          }

          // -----------------------------------------------------------------
          // DELETE
          // -----------------------------------------------------------------
          case 'delete': {
            if (!p.table_id) {
              return json({
                error: 'table_id is required for delete action',
              });
            }

            logger.info(`[bitable_app_table] delete: app_token=${p.app_token}, table_id=${p.table_id}`);

            const res = await client.invoke(
              'feishu_bitable_app_table.delete',
              (sdk, opts) =>
                sdk.bitable.appTable.delete(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table] deleted table ${p.table_id}`);

            return json({
              success: true,
            });
          }

          // -----------------------------------------------------------------
          // BATCH_CREATE
          // -----------------------------------------------------------------
          case 'batch_create': {
            if (!p.tables || p.tables.length === 0) {
              return json({
                error: 'tables is required and cannot be empty',
              });
            }

            logger.info(`[bitable_app_table] batch_create: app_token=${p.app_token}, tables_count=${p.tables.length}`);

            const res = await client.invoke(
              'feishu_bitable_app_table.batch_create',
              (sdk, opts) =>
                sdk.bitable.appTable.batchCreate(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                    data: {
                      tables: p.tables,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table] batch_create: created ${p.tables.length} tables`);

            return json({
              table_ids: res.data?.table_ids,
            });
          }

          // -----------------------------------------------------------------
          // BATCH_DELETE
          // -----------------------------------------------------------------
          case 'batch_delete': {
            if (!p.table_ids || p.table_ids.length === 0) {
              return json({
                error: 'table_ids is required and cannot be empty',
              });
            }

            logger.info(`[bitable_app_table] batch_delete: app_token=${p.app_token}, table_ids_count=${p.table_ids.length}`);

            const res = await client.invoke(
              'feishu_bitable_app_table.batch_delete',
              (sdk, opts) =>
                sdk.bitable.appTable.batchDelete(
                  {
                    path: {
                      app_token: p.app_token,
                    },
                    data: {
                      table_ids: p.table_ids,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table] batch_delete: deleted ${p.table_ids.length} tables`);

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

        logger.error(`[bitable_app_table] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[bitable] Registered feishu_bitable_app_table tool');
}