// src/plugins/feishu-advanced/bitable/app-table-record.ts

/**
 * feishu_bitable_app_table_record tool -- 飞书多维表格记录管理
 *
 * Actions: create, list, update, delete, batch_create, batch_update, batch_delete
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

const FeishuBitableAppTableRecordSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'update', 'delete', 'batch_create', 'batch_update', 'batch_delete'],
      description: '操作类型',
    },
    app_token: { type: 'string', description: '多维表格 token' },
    table_id: { type: 'string', description: '数据表 ID' },
    record_id: { type: 'string', description: '记录 ID（update/delete 时必需）' },
    fields: {
      type: 'object',
      additionalProperties: true,
      description: '记录字段（单条记录）。键为字段名，值根据字段类型而定',
    },
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          record_id: { type: 'string' },
          fields: { type: 'object', additionalProperties: true },
        },
      },
      description: '批量操作的记录列表',
    },
    record_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '批量删除的记录 ID 列表',
    },
    view_id: { type: 'string', description: '视图 ID（可选）' },
    field_names: {
      type: 'array',
      items: { type: 'string' },
      description: '要返回的字段名列表',
    },
    filter: {
      type: 'object',
      properties: {
        conjunction: { type: 'string', enum: ['and', 'or'] },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field_name: { type: 'string' },
              operator: {
                type: 'string',
                enum: ['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual'],
              },
              value: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      description: '筛选条件',
    },
    sort: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field_name: { type: 'string' },
          desc: { type: 'boolean' },
        },
      },
      description: '排序规则',
    },
    automatic_fields: { type: 'boolean', description: '是否返回自动字段' },
    page_size: { type: 'number', description: '每页数量，默认 50，最大 500' },
    page_token: { type: 'string', description: '分页标记' },
  },
  required: ['action', 'app_token', 'table_id'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerBitableAppTableRecordTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_bitable_app_table_record',
    description:
      '【以用户身份】飞书多维表格记录（行）管理工具。当用户要求创建/查询/更新/删除记录、搜索数据时使用。\n\n' +
      'Actions:\n' +
      '- create（创建单条记录，使用 fields 参数）\n' +
      '- batch_create（批量创建记录，使用 records 数组参数）\n' +
      '- list（列出/搜索记录）\n' +
      '- update（更新记录）\n' +
      '- delete（删除记录）\n' +
      '- batch_update（批量更新）\n' +
      '- batch_delete（批量删除）',
    parameters: FeishuBitableAppTableRecordSchema,
    async execute(params: Record<string, unknown>, context?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = context?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'bitable_record' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            // 参数验证
            if (p.records) {
              return json({
                error: "create action does not accept 'records' parameter",
                hint: "Use 'fields' for single record creation. For batch creation, use action: 'batch_create' with 'records' parameter.",
              });
            }

            if (!p.fields || Object.keys(p.fields).length === 0) {
              return json({
                error: 'fields is required and cannot be empty',
                hint: "create action requires 'fields' parameter",
              });
            }

            logger.info(`[bitable_record] create: app_token=${p.app_token}, table_id=${p.table_id}`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.create',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.create(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      fields: p.fields,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[bitable_record] created record ${res.data?.record?.record_id}`);

            return json({
              record: res.data?.record,
            });
          }

          // -----------------------------------------------------------------
          // UPDATE
          // -----------------------------------------------------------------
          case 'update': {
            if (p.records) {
              return json({
                error: "update action does not accept 'records' parameter",
                hint: "Use 'record_id' + 'fields' for single record update. For batch update, use action: 'batch_update' with 'records' parameter.",
              });
            }

            logger.info(`[bitable_record] update: record_id=${p.record_id}`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.update',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.update(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      record_id: p.record_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      fields: p.fields,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              record: res.data?.record,
            });
          }

          // -----------------------------------------------------------------
          // DELETE
          // -----------------------------------------------------------------
          case 'delete': {
            logger.info(`[bitable_record] delete: record_id=${p.record_id}`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.delete',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.delete(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                      record_id: p.record_id,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              success: true,
            });
          }

          // -----------------------------------------------------------------
          // BATCH_CREATE
          // -----------------------------------------------------------------
          case 'batch_create': {
            if (p.fields) {
              return json({
                error: "batch_create action does not accept 'fields' parameter",
                hint: "Use 'records' array for batch creation. For single record, use action: 'create' with 'fields' parameter.",
              });
            }

            if (!p.records || p.records.length === 0) {
              return json({
                error: 'records is required and cannot be empty',
              });
            }

            if (p.records.length > 500) {
              return json({
                error: 'records count exceeds limit (maximum 500)',
                received_count: p.records.length,
              });
            }

            logger.info(`[bitable_record] batch_create: ${p.records.length} records`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.batch_create',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.batchCreate(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      records: p.records,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              records: res.data?.records,
            });
          }

          // -----------------------------------------------------------------
          // BATCH_UPDATE
          // -----------------------------------------------------------------
          case 'batch_update': {
            if (p.record_id || p.fields) {
              return json({
                error: "batch_update action does not accept 'record_id' or 'fields' parameters",
                hint: "Use 'records' array for batch update.",
              });
            }

            if (!p.records || p.records.length === 0) {
              return json({
                error: 'records is required and cannot be empty',
              });
            }

            if (p.records.length > 500) {
              return json({
                error: 'records cannot exceed 500 items',
              });
            }

            logger.info(`[bitable_record] batch_update: ${p.records.length} records`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.batch_update',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.batchUpdate(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      records: p.records,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              records: res.data?.records,
            });
          }

          // -----------------------------------------------------------------
          // BATCH_DELETE
          // -----------------------------------------------------------------
          case 'batch_delete': {
            if (!p.record_ids || p.record_ids.length === 0) {
              return json({
                error: 'record_ids is required and cannot be empty',
              });
            }

            if (p.record_ids.length > 500) {
              return json({
                error: 'record_ids cannot exceed 500 items',
              });
            }

            logger.info(`[bitable_record] batch_delete: ${p.record_ids.length} records`);

            const res = await client.invoke(
              'feishu_bitable_app_table_record.batch_delete',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.batchDelete(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    data: {
                      records: p.record_ids,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            return json({
              success: true,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[bitable_record] list: table_id=${p.table_id}`);

            const searchData: any = {};
            if (p.view_id !== undefined) searchData.view_id = p.view_id;
            if (p.field_names !== undefined) searchData.field_names = p.field_names;

            // 特殊处理：isEmpty/isNotEmpty 必须带 value=[]
            if (p.filter !== undefined) {
              const filter = { ...p.filter };
              if (filter.conditions) {
                filter.conditions = filter.conditions.map((cond: any) => {
                  if ((cond.operator === 'isEmpty' || cond.operator === 'isNotEmpty') && !cond.value) {
                    return { ...cond, value: [] };
                  }
                  return cond;
                });
              }
              searchData.filter = filter;
            }

            if (p.sort !== undefined) searchData.sort = p.sort;
            if (p.automatic_fields !== undefined) searchData.automatic_fields = p.automatic_fields;

            const res = await client.invoke(
              'feishu_bitable_app_table_record.list',
              (sdk, opts) =>
                sdk.bitable.appTableRecord.search(
                  {
                    path: {
                      app_token: p.app_token,
                      table_id: p.table_id,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                      page_size: p.page_size,
                      page_token: p.page_token,
                    },
                    data: searchData,
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data;

            return json({
              records: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
              total: data?.total,
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

        logger.error(`[bitable_record] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[bitable] Registered feishu_bitable_app_table_record tool');
}