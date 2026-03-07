// src/agents/tools/feishu/uat-store.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * UAT 令牌存储
 */
interface UATToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  appId: string;
}

/**
 * UAT 存储管理器
 */
export class UATStore {
  private storagePath: string;
  private dataDir: string;

  constructor() {
    this.dataDir = join(process.cwd(), 'data');
    this.storagePath = join(this.dataDir, 'feishu-uats.json');
    this.ensureStorageDir();
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 保存 UAT 令牌
   */
  async saveUAT(userId: string, appId: string, token: UATToken): Promise<void> {
    try {
      const all = await this.loadAll();
      const key = `${userId}:${appId}`;
      all[key] = token;

      writeFileSync(this.storagePath, JSON.stringify(all, null, 2));
      console.log(`[UATStore] Saved UAT for user=${userId}, app=${appId}, expiresAt=${new Date(token.expiresAt).toISOString()}`);
    } catch (error) {
      console.error('[UATStore] Failed to save UAT:', error);
      throw error;
    }
  }

  /**
   * 获取 UAT 令牌
   * 如果令牌过期，自动尝试刷新
   */
  async getUAT(userId: string, appId: string): Promise<UATToken | null> {
    try {
      const all = await this.loadAll();
      const key = `${userId}:${appId}`;
      const token = all[key];

      if (!token) {
        console.log(`[UATStore] No UAT found for user=${userId}, app=${appId}`);
        return null;
      }

      // 检查是否过期（提前 5 分钟刷新）
      const now = Date.now();
      const EXPIRE_BUFFER = 5 * 60 * 1000; // 5 分钟

      if (now + EXPIRE_BUFFER > token.expiresAt) {
        console.log(`[UATStore] UAT expired or expiring soon, attempting refresh...`);
        const refreshed = await this.refreshToken(token);
        if (refreshed) {
          return refreshed;
        }
        console.log(`[UATStore] Refresh failed, returning expired token`);
        return token;
      }

      return token;
    } catch (error) {
      console.error('[UATStore] Failed to get UAT:', error);
      return null;
    }
  }

  /**
   * 删除 UAT 令牌（用于授权失效时）
   */
  async deleteUAT(userId: string, appId: string): Promise<void> {
    try {
      const all = await this.loadAll();
      const key = `${userId}:${appId}`;

      if (all[key]) {
        delete all[key];
        writeFileSync(this.storagePath, JSON.stringify(all, null, 2));
        console.log(`[UATStore] Deleted UAT for user=${userId}, app=${appId}`);
      }
    } catch (error) {
      console.error('[UATStore] Failed to delete UAT:', error);
    }
  }

  /**
   * 加载所有 UAT 令牌
   */
  private async loadAll(): Promise<Record<string, UATToken>> {
    try {
      if (!existsSync(this.storagePath)) {
        return {};
      }

      const content = readFileSync(this.storagePath, 'utf-8');
      return JSON.parse(content || '{}');
    } catch (error) {
      console.error('[UATStore] Failed to load UATs:', error);
      return {};
    }
  }

  /**
   * 刷新令牌
   * 注意：这里简化处理，实际需要调用飞书 OAuth 刷新端点
   */
  private async refreshToken(token: UATToken): Promise<UATToken | null> {
    // TODO: 实现实际的令牌刷新逻辑
    // 需要调用飞书 OAuth 刷新端点：
    // POST https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token
    // with grant_type=refresh_token&refresh_token=xxx

    console.log('[UATStore] Token refresh not implemented yet, returning null');
    return null;
  }
}

// 单例
let uatStoreInstance: UATStore | null = null;

export function getUATStore(): UATStore {
  if (!uatStoreInstance) {
    uatStoreInstance = new UATStore();
  }
  return uatStoreInstance;
}
