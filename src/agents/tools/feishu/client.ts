// src/agents/tools/feishu/client.ts

import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from '../../../config/loader.js';
import type { FeishuInstanceConfig, FeishuConfig } from '../../../config/schema.js';
import { getUATStore } from './uat-store.js';

/**
 * 飞书 SDK 客户端管理器
 * 管理 Bot 客户端和用户客户端（UAT）
 * 支持通过构造函数传入实例配置（多实例模式）或使用全局配置（单实例兼容模式）
 */
export class FeishuClientManager {
  private botClient: lark.Client | null = null;
  private userClients: Map<string, lark.Client> = new Map();
  private instanceConfig: FeishuInstanceConfig | null = null;

  constructor(config?: FeishuInstanceConfig) {
    if (config) {
      this.instanceConfig = config;
    }
  }

  /**
   * 获取有效的飞书配置（优先使用实例配置，回退到全局配置）
   */
  private getFeishuConfig(): FeishuInstanceConfig | FeishuConfig | undefined {
    if (this.instanceConfig) {
      return this.instanceConfig;
    }
    const config = getConfig();
    return (config.channels as any)?.feishu;
  }

  /**
   * 获取 Bot 客户端（单例）
   */
  async getBotClient(): Promise<lark.Client> {
    if (this.botClient) {
      return this.botClient;
    }

    const feishuConfig = this.getFeishuConfig();

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
      throw new Error('飞书 appId 或 appSecret 未配置');
    }

    const instanceId = this.instanceConfig?.id ?? 'default';
    console.log(`[FeishuClient] Creating Bot client (instance=${instanceId})`);

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
    const feishuConfig = this.getFeishuConfig();

    if (!feishuConfig?.enabled) {
      throw new Error('飞书集成未启用');
    }

    if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
      throw new Error('飞书 appId 或 appSecret 未配置');
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
  private resolveDomain(domain?: 'feishu' | 'lark'): any {
    if (domain === 'lark') return lark.Domain.Lark;
    return lark.Domain.Feishu;
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

// ── 多实例支持 ──────────────────────────────────────────────────────────────

/**
 * 实例注册表：instanceId -> FeishuClientManager
 */
const instanceManagers: Map<string, FeishuClientManager> = new Map();

/**
 * 注册飞书实例的 ClientManager（供 initializer.ts 调用）
 * @param instanceId 实例 ID（如 "default"、"hr-bot"）
 * @param config 实例配置
 */
export function registerFeishuInstance(instanceId: string, config: FeishuInstanceConfig): void {
  const manager = new FeishuClientManager(config);
  instanceManagers.set(instanceId, manager);
  console.log(`[FeishuClientManager] Registered instance: ${instanceId}`);
}

/**
 * 注销飞书实例的 ClientManager（供 hotStopChannel 调用）
 * @param instanceId 实例 ID
 */
export function unregisterFeishuInstance(instanceId: string): void {
  instanceManagers.delete(instanceId);
  console.log(`[FeishuClientManager] Unregistered instance: ${instanceId}`);
}

/**
 * 辅助函数：获取默认管理器（兼容旧代码路径）
 */
function getDefaultManager(): FeishuClientManager {
  // 检查注册表中是否有 'default' 实例
  const defaultManager = instanceManagers.get('default');
  if (defaultManager) {
    return defaultManager;
  }
  // 最后回退：使用全局单例管理器（旧代码路径）
  if (!feishuClientManager) {
    feishuClientManager = new FeishuClientManager();
  }
  return feishuClientManager;
}

/**
 * 按实例 ID 获取 FeishuClientManager
 * @param instanceId 实例 ID，默认为 'default'
 */
export function getFeishuClientManagerByInstance(instanceId?: string): FeishuClientManager {
  const id = instanceId ?? 'default';
  const manager = instanceManagers.get(id);
  if (manager) {
    return manager;
  }
  // 回退到默认管理器（兼容旧代码）
  return getDefaultManager();
}

// ── 导出函数 ─────────────────────────────────────────────────────────────────

/**
 * 获取 Bot 客户端
 * @param instanceId 实例 ID（多实例时指定，默认为 'default'）
 */
export async function getFeishuBotClient(instanceId?: string): Promise<lark.Client> {
  return getFeishuClientManagerByInstance(instanceId).getBotClient();
}

/**
 * 获取用户客户端（自动切换 Bot/User，支持多实例）
 * @param userId 用户 ID（可选，不提供则使用 Bot 客户端）
 * @param instanceId 实例 ID（多实例时指定，默认为 'default'）
 */
export async function getFeishuClient(userId?: string, instanceId?: string): Promise<lark.Client> {
  const manager = getFeishuClientManagerByInstance(instanceId);
  return manager.getUserClient(userId);
}

/**
 * 清除用户客户端缓存
 * @param userId 用户 ID
 * @param instanceId 实例 ID（多实例时指定，默认为 'default'）
 */
export function clearFeishuUserClient(userId: string, instanceId?: string): void {
  getFeishuClientManagerByInstance(instanceId).clearUserClient(userId);
}
