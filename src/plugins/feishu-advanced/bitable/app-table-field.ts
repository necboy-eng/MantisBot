// src/plugins/feishu-advanced/bitable/app-table-field.ts

/**
 * feishu_bitable_app_table_field tool -- 飞书多维表格字段管理
 *
 * Actions: create, list, update, delete
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

const FeishuBitableAppTableFieldSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'update', 'delete'],
      description: '操作类型',
    },
    app_token: { type: 'string', description: '多维表格 token' },
    table_id: { type: 'string', description: '数据表 ID' },
    field_id: { type: 'string', description: '字段 ID（update/delete 时必需）' },
    field_name: { type: 'string', description: '字段名称' },
    type: {
      type: 'number',
      description:
        '字段类型（1=文本，2=数字，3=单选，4=多选，5=日期，7=复选框，11=人员，13=电话，15=超链接，17=附件，1001=创建时间，1002=修改时间等）',
    },
    property: {
      type: 'object',
      description:
        '字段属性配置（根据类型而定，例如单选/多选需要options，数字需要formatter等）。⚠️ 超链接字段（type=15）必须省略此参数。',
    },
    view_id: { type: 'string', description: '视图 ID（list 时可选）' },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action', 'app_token', 'table_id'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerBitableAppTableFieldTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_bitable_app_table_field',
    description:
      '【以用户身份】飞书多维表格字段（列）管理工具。当用户要求创建/查询/更新/删除字段、调整表结构时使用。\n\n' +
      'Actions:\n' +
      '- create（创建字段）\n' +
      '- list（列出所有字段）\n' +
      '- update（更新字段，支持只传 field_name 改名）\n' +
      '- delete（删除字段）',
    parameters: FeishuBitableAppTableFieldSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'bitable_app_table_field' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            if (!p.field_name) {
              return json({
                error: 'field_name is required for create action',
              });
            }
            if (p.type === undefined) {
              return json({
                error: 'type is required for create action',
              });
            }

            logger.info(
              `[bitable_app_table_field] create: app_token=${p.app_token}, table_id=${p.table_id}, field_name=${p.field_name}, type=${p.type}`
            );

            // 特殊处理：超链接字段（type=15）和复选框字段（type=7）不能传 property
            let propertyToSend = p.property;
            if ((p.type === 15 || p.type === 7) && p.property !== undefined) {
              const fieldTypeName = p.type === 15 ? 'URL' : 'Checkbox';
              logger.warn(
                `[bitable_app_table_field] ${fieldTypeName} field (type=${p.type}) detected with property. Removing property to avoid API error.`
              );
              propertyToSend = undefined;
            }

            const res = await client.invoke(
              'feishu_bitable_app_table_field.create',
              (sdk, opts) =>
                sdk.bitable.appTableField.create(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    data: {
                      field_name: p.field_name,
                      type: p.type,
                      property: propertyToSend,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;

            logger.info(`[bitable_app_table_field] created field ${data?.field?.field_id ?? 'unknown'}`);

            return json({
              field: data?.field ?? res.data,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(
              `[bitable_app_table_field] list: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id ?? 'none'}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_field.list',
              (sdk, opts) =>
                sdk.bitable.appTableField.list(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    params: {
                      view_id: p.view_id,
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

            logger.info(`[bitable_app_table_field] list: returned ${data?.items?.length ?? 0} fields`);

            return json({
              fields: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // UPDATE
          // -----------------------------------------------------------------
          case 'update': {
            if (!p.field_id) {
              return json({
                error: 'field_id is required for update action',
              });
            }

            logger.info(
              `[bitable_app_table_field] update: app_token=${p.app_token}, table_id=${p.table_id}, field_id=${p.field_id}`
            );

            // 如果缺少 type 或 field_name，自动查询当前字段信息
            let finalFieldName = p.field_name;
            let finalType = p.type;
            let finalProperty = p.property;

            if (!finalType || !finalFieldName) {
              logger.info(`[bitable_app_table_field] update: missing type or field_name, auto-querying field info`);

              const listRes = await client.invoke(
                'feishu_bitable_app_table_field.update_query',
                (sdk, opts) =>
                  sdk.bitable.appTableField.list(
                    {
                      path: {
                        app_token: p.app_token,
                        table_id: p.table_id,
                      },
                      params: {
                        page_size: 500,
                      },
                    },
                    opts
                  ),
                { as: 'user' }
              );
              assertLarkOk(listRes);

              const listData = listRes.data as any;
              const currentField = listData?.items?.find((f: any) => f.field_id === p.field_id);

              if (!currentField) {
                return json({
                  error: `field ${p.field_id} does not exist`,
                  hint: 'Please verify field_id is correct. Use list action to view all fields.',
                });
              }

              // 合并：用户传的优先，否则用查询到的
              finalFieldName = p.field_name || currentField.field_name;
              finalType = p.type ?? currentField.type;
              finalProperty = p.property !== undefined ? p.property : currentField.property;

              logger.info(
                `[bitable_app_table_field] update: auto-filled type=${finalType}, field_name=${finalFieldName}`
              );
            }

            const updateData: any = {
              field_name: finalFieldName,
              type: finalType,
            };
            if (finalProperty !== undefined) {
              updateData.property = finalProperty;
            }

            const res = await client.invoke(
              'feishu_bitable_app_table_field.update',
              (sdk, opts) =>
                sdk.bitable.appTableField.update(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      field_id: p.field_id,
                    },
                    data: updateData,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table_field] updated field ${p.field_id}`);

            const updateData2 = res.data as any;

            return json({
              field: updateData2?.field ?? res.data,
            });
          }

          // -----------------------------------------------------------------
          // DELETE
          // -----------------------------------------------------------------
          case 'delete': {
            if (!p.field_id) {
              return json({
                error: 'field_id is required for delete action',
              });
            }

            logger.info(
              `[bitable_app_table_field] delete: app_token=${p.app_token}, table_id=${p.table_id}, field_id=${p.field_id}`
            );

            const res = await client.invoke(
              'feishu_bitable_app_table_field.delete',
              (sdk, opts) =>
                sdk.bitable.appTableField.delete(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      field_id: p.field_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_app_table_field] deleted field ${p.field_id}`);

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

        logger.error(`[bitable_app_table_field] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[bitable] Registered feishu_bitable_app_table_field tool');
}