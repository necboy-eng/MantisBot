// src/plugins/feishu-advanced/common/get-user.ts

/**
 * feishu_get_user tool -- 获取用户信息
 *
 * 支持两种模式:
 * 1. 不传 user_id: 获取当前用户自己的信息 (sdk.authen.userInfo.get)
 * 2. 传 user_id: 获取指定用户的信息 (sdk.contact.v3.user.get)
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

const GetUserSchema = {
  type: 'object' as const,
  properties: {
    user_id: {
      type: 'string',
      description: '用户 ID（格式如 ou_xxx）。若不传入，则获取当前用户自己的信息',
    },
    user_id_type: {
      type: 'string',
      enum: ['open_id', 'union_id', 'user_id'],
      description: '用户 ID 类型',
    },
  },
  required: [],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerGetUserTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_get_user',
    description:
      '【以用户身份】获取用户信息。不传 user_id 时获取当前用户自己的信息；传 user_id 时获取指定用户的信息。' +
      '返回用户姓名、头像、邮箱、手机号、部门等信息。',
    parameters: GetUserSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'get_user' },
        });

        // 模式 1: 获取当前用户自己的信息
        if (!p.user_id) {
          logger.info('[get_user] fetching current user info');

          try {
            const res = await client.invoke(
              'feishu_get_user.default',
              (sdk, opts) => sdk.authen.userInfo.get({}, opts),
              { as: 'user' }
            );
            assertLarkOk(res);

            logger.info('[get_user] current user fetched successfully');

            return json({
              user: res.data,
            });
          } catch (invokeErr: any) {
            // 特殊处理错误码 41050：用户组织架构可见范围限制
            if (invokeErr?.response?.data?.code === 41050) {
              return json({
                error:
                  '无权限查询该用户信息。\n\n' +
                  '说明：使用用户身份调用通讯录 API 时，可操作的权限范围不受应用的通讯录权限范围影响，' +
                  '而是受当前用户的组织架构可见范围影响。该范围限制了用户在企业内可见的组织架构数据范围。',
              });
            }
            throw invokeErr;
          }
        }

        // 模式 2: 获取指定用户的信息
        logger.info(`[get_user] fetching user ${p.user_id}`);

        const userIdType = p.user_id_type || 'open_id';

        try {
          const res = await client.invoke(
            'feishu_get_user.default',
            (sdk, opts) =>
              sdk.contact.v3.user.get(
                {
                  path: { user_id: p.user_id! },
                  params: {
                    user_id_type: userIdType as any,
                  },
                },
                opts
              ),
            { as: 'user' }
          );
          assertLarkOk(res);

          logger.info(`[get_user] user ${p.user_id} fetched successfully`);

          return json({
            user: res.data?.user,
          });
        } catch (invokeErr: any) {
          // 特殊处理错误码 41050：用户组织架构可见范围限制
          if (invokeErr?.response?.data?.code === 41050) {
            return json({
              error:
                '无权限查询该用户信息。\n\n' +
                '说明：使用用户身份调用通讯录 API 时，可操作的权限范围不受应用的通讯录权限范围影响，' +
                '而是受当前用户的组织架构可见范围影响。该范围限制了用户在企业内可见的组织架构数据范围。\n\n' +
                '建议：请联系管理员调整当前用户的组织架构可见范围，或使用应用身份（tenant_access_token）调用 API。',
            });
          }
          throw invokeErr;
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

        logger.error(`[get_user] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[common] Registered feishu_get_user tool');
}