// src/plugins/feishu-advanced/task/tasklist.ts

/**
 * feishu_task_tasklist tool -- 飞书任务清单管理
 *
 * Actions: create, get, list, tasks, patch, delete, add_members, remove_members
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

const FeishuTaskTasklistSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'get', 'list', 'tasks', 'patch', 'delete', 'add_members', 'remove_members'],
      description: '操作类型',
    },
    // Create 字段
    name: { type: 'string', description: '清单名称' },
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '成员 open_id' },
          role: { type: 'string', enum: ['editor', 'viewer'], description: '成员角色' },
        },
        required: ['id'],
      },
      description: '清单成员列表（editor=可编辑，viewer=可查看）。注意：创建人自动成为 owner',
    },
    // Get/Task/Patch/Delete/AddMembers/RemoveMembers 字段
    tasklist_guid: { type: 'string', description: '清单 GUID' },
    // List/Tasks 参数
    page_size: { type: 'number', description: '每页数量，默认 50，最大 100' },
    page_token: { type: 'string', description: '分页标记' },
    // Tasks 参数
    completed: { type: 'boolean', description: '是否只返回已完成的任务（默认返回所有）' },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerTaskTasklistTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_task_tasklist',
    description:
      '【以用户身份】飞书任务清单管理工具。当用户要求创建/查询/管理清单、查看清单内的任务时使用。\n\n' +
      'Actions:\n' +
      '- create（创建清单）\n' +
      '- get（获取清单详情）\n' +
      '- list（列出所有可读取的清单，包括我创建的和他人共享给我的）\n' +
      '- tasks（列出清单内的任务）\n' +
      '- patch（更新清单）\n' +
      '- delete（删除清单）\n' +
      '- add_members（添加成员）\n' +
      '- remove_members（移除成员）',
    parameters: FeishuTaskTasklistSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'tasklist' },
        });

        switch (p.action) {
          // -----------------------------------------------------------------
          // CREATE
          // -----------------------------------------------------------------
          case 'create': {
            logger.info(`[tasklist] create: name=${p.name}, members_count=${p.members?.length ?? 0}`);

            const data: any = { name: p.name };

            // 转换成员格式
            if (p.members && p.members.length > 0) {
              data.members = p.members.map((m: any) => ({
                id: m.id,
                type: 'user',
                role: m.role || 'editor',
              }));
            }

            const res = await client.invoke(
              'feishu_task_tasklist.create',
              (sdk, opts) =>
                sdk.task.v2.tasklist.create(
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

            logger.info(`[tasklist] created tasklist ${res.data?.tasklist?.guid}`);

            return json({
              tasklist: res.data?.tasklist,
            });
          }

          // -----------------------------------------------------------------
          // GET
          // -----------------------------------------------------------------
          case 'get': {
            logger.info(`[tasklist] get: tasklist_guid=${p.tasklist_guid}`);

            const res = await client.invoke(
              'feishu_task_tasklist.get',
              (sdk, opts) =>
                sdk.task.v2.tasklist.get(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
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

            logger.info(`[tasklist] get: returned tasklist ${p.tasklist_guid}`);

            return json({
              tasklist: res.data?.tasklist,
            });
          }

          // -----------------------------------------------------------------
          // LIST
          // -----------------------------------------------------------------
          case 'list': {
            logger.info(`[tasklist] list: page_size=${p.page_size ?? 50}`);

            const res = await client.invoke(
              'feishu_task_tasklist.list',
              (sdk, opts) =>
                sdk.task.v2.tasklist.list(
                  {
                    params: {
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
            logger.info(`[tasklist] list: returned ${data?.items?.length ?? 0} tasklists`);

            return json({
              tasklists: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // TASKS - 列出清单内的任务
          // -----------------------------------------------------------------
          case 'tasks': {
            logger.info(`[tasklist] tasks: tasklist_guid=${p.tasklist_guid}, completed=${p.completed ?? 'all'}`);

            const res = await client.invoke(
              'feishu_task_tasklist.tasks',
              (sdk, opts) =>
                sdk.task.v2.tasklist.tasks(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
                    },
                    params: {
                      page_size: p.page_size,
                      page_token: p.page_token,
                      completed: p.completed,
                      user_id_type: 'open_id' as any,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            const data = res.data as any;
            logger.info(`[tasklist] tasks: returned ${data?.items?.length ?? 0} tasks`);

            return json({
              tasks: data?.items,
              has_more: data?.has_more ?? false,
              page_token: data?.page_token,
            });
          }

          // -----------------------------------------------------------------
          // PATCH
          // -----------------------------------------------------------------
          case 'patch': {
            logger.info(`[tasklist] patch: tasklist_guid=${p.tasklist_guid}, name=${p.name}`);

            // 飞书 Task API 要求特殊的更新格式
            const tasklistData: any = {};
            const updateFields: string[] = [];

            if (p.name !== undefined) {
              tasklistData.name = p.name;
              updateFields.push('name');
            }

            if (updateFields.length === 0) {
              return json({
                error: 'No fields to update',
              });
            }

            const res = await client.invoke(
              'feishu_task_tasklist.patch',
              (sdk, opts) =>
                sdk.task.v2.tasklist.patch(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      tasklist: tasklistData,
                      update_fields: updateFields,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[tasklist] patched tasklist ${p.tasklist_guid}`);

            return json({
              tasklist: res.data?.tasklist,
            });
          }

          // -----------------------------------------------------------------
          // DELETE
          // -----------------------------------------------------------------
          case 'delete': {
            logger.info(`[tasklist] delete: tasklist_guid=${p.tasklist_guid}`);

            const res = await client.invoke(
              'feishu_task_tasklist.delete',
              (sdk, opts) =>
                sdk.task.v2.tasklist.delete(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[tasklist] deleted tasklist ${p.tasklist_guid}`);

            return json({
              success: true,
            });
          }

          // -----------------------------------------------------------------
          // ADD_MEMBERS
          // -----------------------------------------------------------------
          case 'add_members': {
            if (!p.members || p.members.length === 0) {
              return json({
                error: 'members is required and cannot be empty',
              });
            }

            logger.info(`[tasklist] add_members: tasklist_guid=${p.tasklist_guid}, members_count=${p.members.length}`);

            const memberData = p.members.map((m: any) => ({
              id: m.id,
              type: 'user',
              role: m.role || 'editor',
            }));

            const res = await client.invoke(
              'feishu_task_tasklist.add_members',
              (sdk, opts) =>
                sdk.task.v2.tasklist.addMembers(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      members: memberData,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[tasklist] added ${p.members.length} members to tasklist ${p.tasklist_guid}`);

            return json({
              tasklist: res.data?.tasklist,
            });
          }

          // -----------------------------------------------------------------
          // REMOVE_MEMBERS
          // -----------------------------------------------------------------
          case 'remove_members': {
            if (!p.members || p.members.length === 0) {
              return json({
                error: 'members is required and cannot be empty',
              });
            }

            logger.info(`[tasklist] remove_members: tasklist_guid=${p.tasklist_guid}, members_count=${p.members.length}`);

            const memberData = p.members.map((m: any) => ({
              id: m.id,
              type: m.type || 'user',
            }));

            const res = await client.invoke(
              'feishu_task_tasklist.remove_members',
              (sdk, opts) =>
                sdk.task.v2.tasklist.removeMembers(
                  {
                    path: {
                      tasklist_guid: p.tasklist_guid,
                    },
                    params: {
                      user_id_type: 'open_id' as any,
                    },
                    data: {
                      members: memberData,
                    },
                  },
                  opts
                ),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info(`[tasklist] removed ${p.members.length} members from tasklist ${p.tasklist_guid}`);

            return json({
              tasklist: res.data?.tasklist,
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

        logger.error(`[tasklist] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[task] Registered feishu_task_tasklist tool');
}