// src/storage/manager.ts

import type {
  IStorage,
  StorageConfig,
  StorageManagerConfig,
} from './storage.interface.js';
import {
  StorageError,
  StorageConnectionError
} from './storage.interface.js';
import { LocalStorage } from './local-storage.js';
import { NasStorage } from './nas-storage.js';
import { SmbStorage } from './smb-storage.js';

function createStorage(config: StorageConfig): IStorage {
  if (config.type === 'local') return new LocalStorage(config);
  if (config.type === 'nas') {
    if (config.protocol === 'smb') return new SmbStorage(config);
    return new NasStorage(config);
  }
  throw new StorageError(`Unsupported storage type: ${config.type}`, 'INVALID_CONFIG');
}

export interface StorageInfo {
  id: string;
  name: string;
  type: string;
  connected: boolean;
}

export class StorageManager {
  private storages: Map<string, IStorage> = new Map();
  private currentStorageId: string | null = null;
  private config: StorageManagerConfig;

  constructor(config: StorageManagerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('[StorageManager] Initializing storage providers...');

    // 初始化所有已配置的存储
    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) {
        console.log(`[StorageManager] Skipping disabled provider: ${providerConfig.id}`);
        continue;
      }

      try {
        const storage = createStorage(providerConfig);
        this.registerStorage(providerConfig.id, storage);
        console.log(`[StorageManager] Registered storage: ${providerConfig.id} (${providerConfig.type}/${providerConfig.protocol || 'local'})`);
      } catch (error) {
        console.error(`[StorageManager] Failed to create storage '${providerConfig.id}':`, error);
      }
    }

    // 设置默认存储
    const defaultId = this.config.default;
    if (defaultId && this.storages.has(defaultId)) {
      try {
        await this.switchTo(defaultId);
        console.log(`[StorageManager] Default storage set to: ${defaultId}`);
      } catch (error) {
        console.error(`[StorageManager] Failed to connect to default storage '${defaultId}':`, error);
        // 尝试连接到第一个可用的存储
        await this.connectToFirstAvailable();
      }
    } else {
      console.warn(`[StorageManager] Default storage '${defaultId}' not found, using first available`);
      await this.connectToFirstAvailable();
    }
  }

  private async connectToFirstAvailable(): Promise<void> {
    for (const [id, storage] of this.storages) {
      try {
        await storage.connect();
        this.currentStorageId = id;
        console.log(`[StorageManager] Connected to fallback storage: ${id}`);
        return;
      } catch (error) {
        console.warn(`[StorageManager] Failed to connect to storage '${id}':`, error);
      }
    }

    throw new StorageConnectionError('No storage providers available');
  }

  registerStorage(id: string, storage: IStorage): void {
    this.storages.set(id, storage);
  }

  async switchTo(storageId: string): Promise<void> {
    const storage = this.storages.get(storageId);
    if (!storage) {
      throw new StorageError(`Storage '${storageId}' not found`, 'NOT_FOUND');
    }

    // 断开当前连接
    if (this.currentStorageId && this.currentStorageId !== storageId) {
      const current = this.storages.get(this.currentStorageId);
      if (current && current.isConnected()) {
        try {
          await current.disconnect();
          console.log(`[StorageManager] Disconnected from: ${this.currentStorageId}`);
        } catch (error) {
          console.warn(`[StorageManager] Failed to disconnect from '${this.currentStorageId}':`, error);
        }
      }
    }

    // 连接新存储
    if (!storage.isConnected()) {
      try {
        await storage.connect();
        console.log(`[StorageManager] Connected to: ${storageId}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new StorageConnectionError(
          `Failed to connect to storage '${storageId}': ${errorMessage}`,
          storageId,
          error instanceof Error ? error : undefined
        );
      }
    }

    this.currentStorageId = storageId;
  }

  getCurrentStorage(): IStorage {
    if (!this.currentStorageId) {
      throw new StorageError('No storage selected', 'NO_STORAGE_SELECTED');
    }

    const storage = this.storages.get(this.currentStorageId);
    if (!storage) {
      throw new StorageError(`Current storage '${this.currentStorageId}' not found`, 'NOT_FOUND');
    }

    return storage;
  }

  getCurrentStorageId(): string | null {
    return this.currentStorageId;
  }

  listStorages(): StorageInfo[] {
    return Array.from(this.storages.entries()).map(([id, storage]) => ({
      id,
      name: storage.name,
      type: storage.type,
      connected: storage.isConnected()
    }));
  }

  getStorage(storageId: string): IStorage | undefined {
    return this.storages.get(storageId);
  }

  async testConnection(storageId: string): Promise<boolean> {
    const storage = this.storages.get(storageId);
    if (!storage) {
      return false;
    }

    try {
      return await storage.ping();
    } catch (error) {
      console.warn(`[StorageManager] Connection test failed for '${storageId}':`, error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.currentStorageId) {
      const current = this.storages.get(this.currentStorageId);
      if (current && current.isConnected()) {
        try {
          await current.disconnect();
          console.log(`[StorageManager] Disconnected from: ${this.currentStorageId}`);
        } catch (error) {
          console.warn(`[StorageManager] Failed to disconnect:`, error);
        }
      }
      this.currentStorageId = null;
    }
  }

  // 健康检查
  async healthCheck(): Promise<{ [storageId: string]: boolean }> {
    const results: { [storageId: string]: boolean } = {};

    for (const [id, storage] of this.storages) {
      try {
        results[id] = await storage.ping();
      } catch (error) {
        console.warn(`[StorageManager] Health check failed for '${id}':`, error);
        results[id] = false;
      }
    }

    return results;
  }

  // 获取配置信息（不包含敏感信息）
  getConfig(): Omit<StorageManagerConfig, 'providers'> & {
    providers: Array<Omit<StorageConfig, 'password'> & { hasPassword: boolean }>
  } {
    return {
      default: this.config.default,
      providers: this.config.providers.map(provider => {
        const { password, ...rest } = provider;
        return {
          ...rest,
          hasPassword: !!password
        };
      })
    };
  }
}

// 全局实例
let globalStorageManager: StorageManager | null = null;

export function setStorageManager(manager: StorageManager): void {
  globalStorageManager = manager;
}

export function getStorageManager(): StorageManager {
  if (!globalStorageManager) {
    throw new StorageError('StorageManager not initialized', 'NOT_INITIALIZED');
  }
  return globalStorageManager;
}

export function hasStorageManager(): boolean {
  return globalStorageManager !== null;
}

export function clearStorageManager(): void {
  globalStorageManager = null;
}