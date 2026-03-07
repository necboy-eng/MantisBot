// src/agents/tools/feishu/client.ts

import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from '../../../config/loader.js';
import { getUATStore } from './uat-store.js';

/**
 * 飞书 SDK 客户端管理器
 * 管理 Bot 客户端和用户客户端（UAT）
 */
class FeishuClientManager {
  private botClient: lark.Client | null = null;
  private userClients: Map<string, lark.Client> = new Map();

  /**
   * 获取 Bot 客户端（单例）
   */
  async getBotClient(): Promise<lark.Client> {
    if (this.botClient) {
      return this.botClient;
    }

    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
      throw new Error('飞书 appId 或 appSecret 未配置');
    }

    console.log('[FeishuClient] Creating Bot client');

    this.botClient = new lark.Client({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: this.resolveDomain(feishuConfig.domain),
      loggerLevel: feishuConfig.debug ? lark.LoggerLevel.debug : lark.LoggerLevel.info,
    });

    return this.botClient;
  }

  /**
   * 获取用户客户端（使用 UAT）
   * 优先从 context 获取 userId
   */
  async getUserClient(userId?: string): Promise<lark.Client> {
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    // 如果没有提供 userId，使用 Bot 客户端
    if (!userId) {
      console.log('[FeishuClient] No userId provided, using Bot client');
      return this.getBotClient();
    }

    // 检查缓存
    if (this.userClients.has(userId)) {
      return this.userClients.get(userId)!;
    }

    // 从存储加载 UAT
    const uatStore = getUATStore();
    const uat = await uatStore.getUAT(userId, feishuConfig.appId);

    if (!uat) {
      console.log(`[FeishuClient] No UAT for userId=${userId}, falling back to Bot client`);
      return this.getBotClient();
    }

    console.log(`[FeishuClient] Creating user client for userId=${userId}`);

    // 创建用户客户端（使用 UAT 令牌）
    const userClient = new lark.Client({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: this.resolveDomain(feishuConfig.domain),
      loggerLevel: feishuConfig.debug ? lark.LoggerLevel.debug : lark.LoggerLevel.info,
    });

    // 设置 UAT 令牌 - 使用 userAccessToken 属性
    (userClient as any).userAccessToken = uat.accessToken;

    // 缓存客户端
    this.userClients.set(userId, userClient);

    return userClient;
  }

  /**
   * 解析域名
   */
  private resolveDomain(domain?: string): any {
    if (!domain || domain === 'feishu') return lark.Domain.Feishu;
    if (domain === 'lark') return lark.Domain.Lark;
    // 自定义域名（移除末尾斜杠）
    return domain?.replace(/\/+$/, '') || lark.Domain.Feishu;
  }

  /**
   * 清除用户客户端缓存（用于令牌失效时）
   */
  clearUserClient(userId: string): void {
    this.userClients.delete(userId);
    console.log(`[FeishuClient] Cleared user client for userId=${userId}`);
  }

  /**
   * 清除所有客户端缓存（用于测试或重置）
   */
  clearAllClients(): void {
    this.botClient = null;
    this.userClients.clear();
    console.log('[FeishuClient] Cleared all clients');
  }
}

// 单例
let feishuClientManager: FeishuClientManager | null = null;

/**
 * 获取 Bot 客户端
 */
export async function getFeishuBotClient(): Promise<lark.Client> {
  if (!feishuClientManager) {
    feishuClientManager = new FeishuClientManager();
  }
  return feishuClientManager.getBotClient();
}

/**
 * 获取用户客户端（自动切换 Bot/User）
 * @param userId 用户 ID（可选，不提供则使用 Bot 客户端）
 */
export async function getFeishuClient(userId?: string): Promise<lark.Client> {
  if (!feishuClientManager) {
    feishuClientManager = new FeishuClientManager();
  }
  return feishuClientManager.getUserClient(userId);
}

/**
 * 清除用户客户端缓存
 */
export function clearFeishuUserClient(userId: string): void {
  if (!feishuClientManager) {
    feishuClientManager = new FeishuClientManager();
  }
  feishuClientManager.clearUserClient(userId);
}
