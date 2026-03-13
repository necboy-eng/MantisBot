// src/agents/tools/feishu/oauth.ts

import { getUATStore } from './uat-store.js';
import { getConfig } from '../../../config/loader.js';
import { DEFAULT_SCOPES } from '../../../plugins/feishu-advanced/tool-scopes.js';

/**
 * OAuth 设备授权结果
 */
export interface DeviceAuthResult {
  deviceCode: string;
  verificationUri: string;
  verificationUriComplete: string; // 完整授权链接（包含 app_id 和 user_code）
  userCode: string;
  expiresIn: number;
  interval: number;
}

/**
 * 飞书 OAuth 设备流授权
 * 使用标准 OAuth 2.0 Device Authorization Grant (RFC 8628)
 */
export class FeishuOAuth {
  /**
   * 获取 OAuth 端点
   */
  private getOAuthEndpoints(brand?: string): {
    deviceAuthorization: string;
    token: string;
  } {
    // 默认使用飞书端点
    if (!brand || brand === 'feishu') {
      return {
        deviceAuthorization: 'https://accounts.feishu.cn/oauth/v1/device_authorization',
        token: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      };
    }
    // Lark 端点
    if (brand === 'lark') {
      return {
        deviceAuthorization: 'https://accounts.larksuite.com/oauth/v1/device_authorization',
        token: 'https://open.larksuite.com/open-apis/authen/v2/oauth/token',
      };
    }
    // 自定义域名
    const base = brand.replace(/\/+$/, '');
    return {
      deviceAuthorization: `${base}/oauth/v1/device_authorization`,
      token: `${base}/open-apis/authen/v2/oauth/token`,
    };
  }

  /**
   * 启动设备授权流程
   * 使用标准 OAuth 2.0 Device Authorization Grant
   * @param userId 用户 ID
   * @param scope 可选的权限范围，不传则使用默认权限集
   */
  async startDeviceAuthFlow(userId: string, scope?: string): Promise<DeviceAuthResult> {
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
      throw new Error('飞书 appId 或 appSecret 未配置');
    }

    const brand = feishuConfig.brand || 'feishu';
    const endpoints = this.getOAuthEndpoints(brand);

    // 使用传入的 scope 或默认权限集
    // 默认权限集包含 bitable、drive、task、calendar 等常用功能所需的权限
    let effectiveScope = scope || DEFAULT_SCOPES.join(' ');

    // 确保 offline_access 在 scope 中，以获取 refresh_token
    if (!effectiveScope.includes('offline_access')) {
      effectiveScope = `${effectiveScope} offline_access`;
    }

    console.log('[FeishuOAuth] Requesting scopes:', effectiveScope.split(' ').length, 'scopes');

    // 使用 HTTP Basic 认证
    const basicAuth = Buffer.from(`${feishuConfig.appId}:${feishuConfig.appSecret}`).toString('base64');

    const body = new URLSearchParams();
    body.set('client_id', feishuConfig.appId);
    body.set('scope', effectiveScope);

    try {
      const response = await fetch(endpoints.deviceAuthorization, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: body.toString(),
      });

      const text = await response.text();
      console.log('[FeishuOAuth] Device auth response:', {
        status: response.status,
        body: text.slice(0, 500),
      });

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`设备授权请求失败: HTTP ${response.status} - ${text.slice(0, 200)}`);
      }

      if (!response.ok || data.error) {
        const errorMsg = (data.error_description as string) ?? (data.error as string) ?? '未知错误';
        throw new Error(`设备授权请求失败: ${errorMsg}`);
      }

      const expiresIn = (data.expires_in as number) ?? 240;
      const interval = (data.interval as number) ?? 5;

      console.log('[FeishuOAuth] Device auth started:', {
        userCode: data.user_code as string,
        expiresIn,
        interval,
      });

      return {
        deviceCode: data.device_code as string,
        verificationUri: data.verification_uri as string,
        verificationUriComplete: (data.verification_uri_complete as string) ?? (data.verification_uri as string),
        userCode: data.user_code as string,
        expiresIn,
        interval,
      };
    } catch (error: any) {
      console.error('[FeishuOAuth] Failed to start device auth:', error);
      throw error;
    }
  }

  /**
   * 轮询授权状态
   * 使用标准 OAuth 2.0 Device Flow token 端点
   * @param deviceCode 设备码
   * @param userId 用户 ID（用于存储 UAT）
   * @returns 授权结果或状态
   */
  async *pollAuthStatus(
    deviceCode: string,
    userId: string,
    interval: number = 5,
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

    const brand = feishuConfig.brand || 'feishu';
    const endpoints = this.getOAuthEndpoints(brand);

    const maxAttempts = oauthConfig.maxPollAttempts || 60;
    const maxPollInterval = 60; // 最大轮询间隔（秒）
    let pollInterval = interval;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const response = await fetch(endpoints.token, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: feishuConfig.appId,
            client_secret: feishuConfig.appSecret,
          }).toString(),
        });

        const data = await response.json() as Record<string, unknown>;
        const error = data.error as string | undefined;

        // 授权成功
        if (!error && data.access_token) {
          const tokenData = data;
          const expiresAt = Date.now() + ((data.expires_in as number) ?? 7200) * 1000;
          const grantedScope = (data.scope as string) ?? '';

          console.log('[FeishuOAuth] Authorization successful', {
            userId,
            expiresAt: new Date(expiresAt).toISOString(),
            scope: grantedScope.split(' ').length + ' scopes',
          });

          // 保存 UAT 令牌
          const uatStore = getUATStore();
          await uatStore.saveUAT(userId, feishuConfig.appId, {
            accessToken: tokenData.access_token as string,
            refreshToken: (tokenData.refresh_token as string) ?? '',
            expiresAt,
            userId,
            appId: feishuConfig.appId,
            scope: grantedScope,
          });

          yield {
            status: 'authorized',
            accessToken: tokenData.access_token as string,
            refreshToken: (tokenData.refresh_token as string) ?? '',
          };
          return;
        }

        // 授权等待中
        if (error === 'authorization_pending') {
          if (onStatusChange) {
            onStatusChange(`waiting (attempt ${attempts}/${maxAttempts})`);
          }
          yield { status: 'pending' };
          await this.sleep(pollInterval * 1000);
          continue;
        }

        // 速率限制，增加轮询间隔
        if (error === 'slow_down') {
          pollInterval = Math.min(pollInterval + 5, maxPollInterval);
          console.log(`[FeishuOAuth] Slow down, interval increased to ${pollInterval}s`);
          yield { status: 'pending' };
          await this.sleep(pollInterval * 1000);
          continue;
        }

        // 用户拒绝授权
        if (error === 'access_denied') {
          console.log('[FeishuOAuth] User denied authorization');
          yield { status: 'error', message: '用户拒绝了授权' };
          return;
        }

        // 授权码过期
        if (error === 'expired_token' || error === 'invalid_grant') {
          console.log('[FeishuOAuth] Device code expired');
          yield { status: 'expired' };
          return;
        }

        // 其他错误
        const errorMsg = (data.error_description as string) ?? error ?? '未知错误';
        console.error('[FeishuOAuth] Poll error:', errorMsg);
        yield { status: 'error', message: errorMsg };
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
        await this.sleep(pollInterval * 1000);
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
