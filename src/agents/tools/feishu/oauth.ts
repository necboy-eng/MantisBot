// src/agents/tools/feishu/oauth.ts

import { getUATStore } from './uat-store.js';
import { getConfig } from '../../../config/loader.js';

/**
 * OAuth 设备授权结果
 */
export interface DeviceAuthResult {
  deviceCode: string;
  verificationUri: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

/**
 * OAuth 令牌响应
 */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * 飞书 OAuth 设备流授权
 */
export class FeishuOAuth {
  /**
   * 启动设备授权流程
   */
  async startDeviceAuthFlow(userId: string): Promise<DeviceAuthResult> {
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
      throw new Error('飞书 appId 或 appSecret 未配置');
    }

    const oauthConfig = feishuConfig.oauth || {};

    try {
      const response = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/device_code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: feishuConfig.appId,
          grant_type: 'device_code',
        }),
      });

      const data = await response.json();

      if (data.code !== 0) {
        throw new Error(`获取设备码失败: ${data.msg}`);
      }

      const result = data.data;

      console.log('[FeishuOAuth] Device auth started:', {
        userCode: result.user_code,
        expiresIn: result.expires_in,
      });

      return {
        deviceCode: result.device_code,
        verificationUri: result.verification_uri,
        userCode: result.user_code,
        expiresIn: result.expires_in,
        interval: result.interval,
      };
    } catch (error: any) {
      console.error('[FeishuOAuth] Failed to start device auth:', error);
      throw error;
    }
  }

  /**
   * 轮询授权状态
   * @param deviceCode 设备码
   * @param userId 用户 ID（用于存储 UAT）
   * @returns 授权结果或状态
   */
  async *pollAuthStatus(
    deviceCode: string,
    userId: string,
    onStatusChange?: (status: string) => void
  ): AsyncGenerator<
    | { status: 'pending' }
    | { status: 'authorized'; accessToken: string; refreshToken: string }
    | { status: 'expired' }
    | { status: 'error'; message: string }
  > {
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;
    const oauthConfig = feishuConfig.oauth || {};

    const maxAttempts = oauthConfig.maxPollAttempts || 60;
    const pollInterval = oauthConfig.pollInterval || 3000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const response = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'device_code',
            device_code: deviceCode,
            app_id: feishuConfig.appId,
            app_secret: feishuConfig.appSecret,
          }),
        });

        const data = await response.json();

        if (data.code === 99991663 || data.code === 99991402) {
          // 速率限制，等待后重试
          if (onStatusChange) {
            onStatusChange(`rate_limited (attempt ${attempts}/${maxAttempts})`);
          }
          yield { status: 'pending' };
          await this.sleep(pollInterval);
          continue;
        }

        if (data.code === 99991401 || data.code === 99991400) {
          // 授权过期
          console.log('[FeishuOAuth] Authorization expired');
          yield { status: 'expired' };
          return;
        }

        if (data.code === 99991663) {
          // 仍在等待授权
          if (onStatusChange) {
            onStatusChange(`waiting (attempt ${attempts}/${maxAttempts})`);
          }
          yield { status: 'pending' };
          await this.sleep(pollInterval);
          continue;
        }

        if (data.code !== 0) {
          // 其他错误
          const errorMsg = data.msg || `错误码: ${data.code}`;
          console.error('[FeishuOAuth] Poll error:', errorMsg);
          yield { status: 'error', message: errorMsg };
          return;
        }

        // 授权成功
        const tokenData = data.data;
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);

        console.log('[FeishuOAuth] Authorization successful', {
          userId,
          expiresAt: new Date(expiresAt).toISOString(),
        });

        // 保存 UAT 令牌
        const uatStore = getUATStore();
        await uatStore.saveUAT(userId, feishuConfig.appId, {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          userId,
          appId: feishuConfig.appId,
        });

        yield {
          status: 'authorized',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
        };
        return;
      } catch (error: any) {
        console.error('[FeishuOAuth] Poll request failed:', error);

        if (attempts >= maxAttempts) {
          yield {
            status: 'error',
            message: error.message || String(error),
          };
          return;
        }

        // 网络错误，重试
        if (onStatusChange) {
          onStatusChange(`network_error (attempt ${attempts}/${maxAttempts})`);
        }
        yield { status: 'pending' };
        await this.sleep(pollInterval);
      }
    }

    // 超过最大尝试次数
    console.log('[FeishuOAuth] Max poll attempts reached');
    yield { status: 'expired' };
  }

  /**
   * 延迟执行
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 单例
let feishuOAuthInstance: FeishuOAuth | null = null;

export function getFeishuOAuth(): FeishuOAuth {
  if (!feishuOAuthInstance) {
    feishuOAuthInstance = new FeishuOAuth();
  }
  return feishuOAuthInstance;
}
