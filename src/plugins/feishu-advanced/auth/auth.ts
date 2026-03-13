// src/plugins/feishu-advanced/auth/auth.ts

/**
 * feishu_auth tool - 飞书用户授权工具
 *
 * 当飞书工具返回 "requiresAuth: true" 时，调用此工具发起 OAuth 授权流程。
 */

import type { ToolRegistry } from '../../../agents/tools/registry.js';
import type { PluginToolContext } from '../../types.js';
import type { Tool } from '../../../types.js';
import { getFeishuOAuth } from '../../../agents/tools/feishu/oauth.js';
import { getConfig } from '../../../config/loader.js';

const FeishuAuthSchema = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['authorize', 'status'],
      description: 'authorize: 发起授权; status: 检查授权状态',
    },
  },
  required: ['action'],
};

export function registerFeishuAuthTool(
  registry: ToolRegistry,
  context: PluginToolContext
): void {
  const { feishuConfig, logger } = context;

  const tool: Tool = {
    name: 'feishu_auth',
    description:
      '飞书用户授权工具。' +
      '当其他飞书工具返回 "requiresAuth: true" 时，调用此工具发起 OAuth 授权流程。\n\n' +
      'Actions:\n' +
      '- authorize: 发起 OAuth 授权，返回授权链接\n' +
      '- status: 检查当前用户是否已授权',
    parameters: FeishuAuthSchema,
    async execute(params: Record<string, unknown>, execContext?: Record<string, unknown>) {
      const p = params as { action: string };

      // 从执行上下文获取 senderOpenId
      const senderOpenId = execContext?.senderOpenId as string | undefined;

      if (!senderOpenId) {
        return {
          error: '无法获取用户身份。此工具需要在飞书对话中使用。',
        };
      }

      const config = getConfig();
      const appId = feishuConfig?.appId;

      if (!appId) {
        return { error: '飞书应用未配置' };
      }

      try {
        switch (p.action) {
          case 'authorize': {
            logger.info(`[feishu_auth] Starting device auth flow for user: ${senderOpenId}`);

            const oauth = getFeishuOAuth();
            const authResult = await oauth.startDeviceAuthFlow(senderOpenId);

            // 启动后台轮询（不等待完成）
            const pollPromise = (async () => {
              for await (const status of oauth.pollAuthStatus(
                authResult.deviceCode,
                senderOpenId,
                authResult.interval
              )) {
                if (status.status === 'authorized') {
                  logger.info(`[feishu_auth] User ${senderOpenId} authorized successfully`);
                  break;
                } else if (status.status === 'expired' || status.status === 'error') {
                  logger.warn(`[feishu_auth] Auth flow ended: ${status.status}`);
                  break;
                }
              }
            })();
            // Fire and forget - 不等待轮询完成
            pollPromise.catch(err => logger.error(`[feishu_auth] Poll error: ${err}`));

            return {
              success: true,
              message: '请点击下方链接完成授权',
              authorization_url: authResult.verificationUriComplete, // 完整授权链接（已包含 app_id 和 user_code）
              verification_url: authResult.verificationUri,
              user_code: authResult.userCode,
              expires_in_seconds: authResult.expiresIn,
              instructions: [
                `1. 点击授权链接: ${authResult.verificationUriComplete}`,
                '2. 确认授权',
                '3. 授权完成后，重新执行之前的操作',
              ].join('\n'),
            };
          }

          case 'status': {
            // 检查 UAT 状态
            const { getUATStore } = await import('../../../agents/tools/feishu/uat-store.js');
            const uatStore = getUATStore();
            const uat = await uatStore.getUAT(senderOpenId, appId);

            if (!uat) {
              return {
                authorized: false,
                message: '用户尚未授权',
              };
            }

            const now = Date.now();
            if (uat.expiresAt < now) {
              return {
                authorized: false,
                message: '授权已过期，请重新授权',
                expired_at: new Date(uat.expiresAt).toISOString(),
              };
            }

            return {
              authorized: true,
              message: '用户已授权',
              expires_at: new Date(uat.expiresAt).toISOString(),
            };
          }

          default:
            return { error: `未知操作: ${p.action}` };
        }
      } catch (error: any) {
        logger.error(`[feishu_auth] Error: ${error.message}`);
        return {
          error: error.message || '授权流程失败',
        };
      }
    },
  };

  registry.registerTool(tool);
  logger.info('[feishu_auth] Registered feishu_auth tool');
}