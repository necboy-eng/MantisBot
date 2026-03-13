// src/plugins/feishu-advanced/common/search-user.ts

/**
 * feishu_search_user tool -- 搜索员工
 *
 * 通过关键词搜索员工，结果按亲密度排序
 * 使用搜索接口（/open-apis/search/v1/user）
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

const SearchUserSchema = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: '搜索关键词，用于匹配用户名（必填）',
    },
    page_size: {
      type: 'number',
      description: '分页大小，控制每次返回的用户数量（默认20，最大200）',
      minimum: 1,
      maximum: 200,
    },
    page_token: {
      type: 'string',
      description: '分页标识。首次请求无需填写；当返回结果中包含 page_token 时，可传入该值继续请求下一页',
    },
  },
  required: ['query'],
};

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function registerSearchUserTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_search_user',
    description:
      '【以用户身份】搜索员工信息（通过关键词搜索姓名、手机号、邮箱）。' +
      '返回匹配的员工列表，包含姓名、部门、open_id 等信息。',
    parameters: SearchUserSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as any;

      // 从上下文中获取 senderOpenId（飞书用户的 open_id）
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      try {
        const client = await createToolClient(feishuConfig!, senderOpenId, {
          extra: { tool: 'search_user' },
        });

        logger.info(`[search_user] query="${p.query}", page_size=${p.page_size ?? 20}`);

        const requestQuery: Record<string, string> = {
          query: p.query,
          page_size: String(p.page_size ?? 20),
        };
        if (p.page_token) requestQuery.page_token = p.page_token;

        // 使用 invokeByPath 调用搜索 API
        const res = await client.invokeByPath<{ code: number; msg: string; data?: { users?: any[]; has_more?: boolean; page_token?: string } }>(
          'feishu_search_user.default',
          '/open-apis/search/v1/user',
          {
            method: 'GET',
            query: requestQuery,
            as: 'user',
          }
        );

        if (res.code !== 0) {
          return json({
            error: `Lark API error: ${res.msg || `code ${res.code}`}`,
          });
        }

        const users = res.data?.users ?? [];
        const userCount = users.length;
        logger.info(`[search_user] found ${userCount} users`);

        return json({
          users,
          has_more: res.data?.has_more ?? false,
          page_token: res.data?.page_token,
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

        logger.error(`[search_user] Error: ${err.message}`);
        return json({
          error: err.message || 'Unknown error',
        });
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[common] Registered feishu_search_user tool');
}