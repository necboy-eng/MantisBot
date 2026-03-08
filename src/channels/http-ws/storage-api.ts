// src/channels/http-ws/storage-api.ts

import express from 'express';
import os from 'os';
import { getStorageManager, hasStorageManager, setStorageManager, clearStorageManager, StorageManager } from '../../storage/manager.js';
import { StorageError, StorageConfig, IStorage } from '../../storage/storage.interface.js';
import { getConfig, saveConfig } from '../../config/loader.js';
import { LocalStorage } from '../../storage/local-storage.js';
import { NasStorage } from '../../storage/nas-storage.js';
import { SmbStorage } from '../../storage/smb-storage.js';
import { workDirManager } from '../../workdir/manager.js';
import { mountNas, unmountNas, getActiveMountPath } from '../../storage/mount-helper.js';
import fs from 'fs';

const router = express.Router();

// 工厂函数：根据 type 和 protocol 选择正确的存储实现
function createStorage(config: StorageConfig): IStorage {
  if (config.type === 'local') return new LocalStorage(config);
  if (config.type === 'nas') {
    if (config.protocol === 'smb') return new SmbStorage(config);
    return new NasStorage(config); // webdav（默认）
  }
  throw new StorageError(`Unsupported storage type: ${config.type}`, 'INVALID_CONFIG');
}

// 列出所有存储提供者（含完整配置，密码脱敏）
router.get('/api/storage/providers', (req, res) => {
  try {
    // 优先从 config 返回完整字段（url、protocol 等），再合并运行时连接状态
    const config = getConfig();
    const configProviders: any[] = config.storage?.providers || [];

    if (!hasStorageManager()) {
      // 未初始化时直接返回配置，connected 为 false
      return res.json(configProviders.map(({ password, ...rest }: any) => ({
        ...rest,
        connected: false,
        hasPassword: !!password
      })));
    }

    const storageManager = getStorageManager();
    const runtimeMap = new Map(
      storageManager.listStorages().map(s => [s.id, s])
    );

    const providers = configProviders.map(({ password, ...rest }: any) => ({
      ...rest,
      hasPassword: !!password,
      connected: runtimeMap.get(rest.id)?.connected ?? false
    }));

    res.json(providers);
  } catch (error) {
    console.error('[Storage API] List providers error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list storage providers'
    });
  }
});

// 获取当前存储提供者
router.get('/api/storage/current', (req, res) => {
  try {
    if (!hasStorageManager()) {
      // 本地文件系统模式（无 NAS 存储管理器）
      return res.json({
        id: '__local__',
        name: 'Local Filesystem',
        type: 'local',
        connected: true
      });
    }

    const storageManager = getStorageManager();

    try {
      const current = storageManager.getCurrentStorage();
      const workDir = workDirManager.getCurrentWorkDir();
      // 如果是 NAS 且工作目录不是用户主目录，则工作目录就是挂载路径
      const mountPath = current.type === 'nas' && workDir !== os.homedir() ? workDir : undefined;
      res.json({
        id: current.config.id,
        name: current.name,
        type: current.type,
        connected: current.isConnected(),
        localMountPath: mountPath
      });
    } catch (error) {
      if (error instanceof StorageError && error.code === 'NO_STORAGE_SELECTED') {
        return res.status(404).json({
          error: 'No storage provider selected'
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Storage API] Get current storage error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get current storage'
    });
  }
});

// 切换存储提供者
router.post('/api/storage/switch', async (req, res) => {
  const { providerId } = req.body;

  if (!providerId || typeof providerId !== 'string') {
    return res.status(400).json({
      error: 'providerId is required and must be a string'
    });
  }

  try {
    // 特殊情况：切换回本地文件系统
    if (providerId === '__local__') {
      if (hasStorageManager()) {
        const sm = getStorageManager();
        // 卸载当前 NAS（如果是自动挂载的）
        try {
          const current = sm.getCurrentStorage();
          if (current.type === 'nas') {
            await unmountNas(current.config);
          }
        } catch { /* 获取当前存储失败时忽略 */ }
        await sm.disconnect().catch(() => {});
        clearStorageManager();
      }
      return res.json({ success: true, currentProvider: '__local__', connected: true });
    }

    if (!hasStorageManager()) {
      return res.status(503).json({
        error: 'Storage system not initialized'
      });
    }

    const storageManager = getStorageManager();

    // 检查提供者是否存在
    const storage = storageManager.getStorage(providerId);
    if (!storage) {
      return res.status(404).json({
        error: `Storage provider '${providerId}' not found`
      });
    }

    // 尝试切换（建立 SMB/WebDAV 连接）
    await storageManager.switchTo(providerId);

    const providerConfig = storage.config;
    let localMountActive = false;
    let localMountPath: string | undefined;
    let autoMounted = false;

    // ── 优先级：手动配置的 localMountPath → 自动挂载 ──

    // 1. 检查用户手动配置的挂载路径（已通过操作系统挂载）
    if (providerConfig.localMountPath) {
      if (fs.existsSync(providerConfig.localMountPath)) {
        const result = workDirManager.setCurrentWorkDir(providerConfig.localMountPath);
        if (result.success) {
          localMountActive = true;
          localMountPath = providerConfig.localMountPath;
          console.log(`[Storage API] WorkDir → manual mount: ${localMountPath}`);
        }
      } else {
        console.warn(`[Storage API] localMountPath does not exist: ${providerConfig.localMountPath}`);
      }
    }

    // 2. 如果没有手动挂载路径，且是 NAS 类型，尝试自动挂载
    if (!localMountActive && providerConfig.type === 'nas') {
      // 先检查是否已有活跃挂载（之前已挂载过）
      const existingMount = getActiveMountPath(providerConfig);
      if (existingMount) {
        const result = workDirManager.setCurrentWorkDir(existingMount);
        if (result.success) {
          localMountActive = true;
          localMountPath = existingMount;
          console.log(`[Storage API] WorkDir → existing mount: ${existingMount}`);
        }
      } else {
        // 执行自动挂载
        console.log(`[Storage API] Auto-mounting ${providerConfig.url}...`);
        const mountResult = await mountNas(providerConfig);
        if (mountResult.success) {
          const result = workDirManager.setCurrentWorkDir(mountResult.mountPath);
          if (result.success) {
            localMountActive = true;
            localMountPath = mountResult.mountPath;
            autoMounted = !mountResult.alreadyMounted;
            console.log(`[Storage API] WorkDir → auto mount: ${localMountPath}`);
          }
        } else {
          console.warn(`[Storage API] Auto-mount failed: ${mountResult.error}`);
        }
      }
    }

    res.json({
      success: true,
      currentProvider: providerId,
      connected: storage.isConnected(),
      localMountActive,
      localMountPath,
      autoMounted
    });
  } catch (error) {
    console.error('[Storage API] Switch storage error:', error);

    if (error instanceof StorageError) {
      const statusCode = error.code === 'CONNECTION_ERROR' ? 503 : 500;
      return res.status(statusCode).json({
        error: `Failed to switch to storage '${providerId}': ${error.message}`,
        code: error.code
      });
    }

    res.status(500).json({
      error: `Failed to switch storage: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

// 测试存储连接（带超时保护）
router.post('/api/storage/test/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const timeoutMs = parseInt(req.query.timeout as string) || 10000;

  if (!providerId) {
    return res.status(400).json({
      error: 'providerId is required'
    });
  }

  try {
    // 从 config 或 StorageManager 获取提供者配置
    let storage: IStorage | undefined;
    let isTemporaryInstance = false;

    if (!hasStorageManager()) {
      // StorageManager 未初始化时，从 config 直接创建实例
      const config = getConfig();
      const providerConfig = config.storage?.providers.find((p: any) => p.id === providerId);
      if (!providerConfig) {
        return res.status(404).json({
          error: `Storage provider '${providerId}' not found`
        });
      }
      try {
        storage = createStorage(providerConfig as StorageConfig);
        isTemporaryInstance = true;
      } catch (createErr) {
        return res.status(400).json({
          success: false,
          connected: false,
          message: createErr instanceof Error ? createErr.message : `Unsupported storage type`
        });
      }
    } else {
      const storageManager = getStorageManager();
      storage = storageManager.getStorage(providerId);
      if (!storage) {
        return res.status(404).json({
          error: `Storage provider '${providerId}' not found`
        });
      }
    }

    // 测试连接（带超时保护）
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    let connected: boolean;
    try {
      connected = await Promise.race([
        storage.ping(),
        timeoutPromise
      ]);
    } catch (timeoutError) {
      return res.status(504).json({
        success: false,
        providerId,
        connected: false,
        message: timeoutError instanceof Error ? timeoutError.message : 'Connection timed out',
        hint: 'Check that the NAS host is reachable and the port is open'
      });
    }

    // 测试成功后，将 storage 实例注册到 StorageManager，使 connected 状态持久化
    if (connected && isTemporaryInstance) {
      try {
        const freshConfig = getConfig();
        const manager = new StorageManager(freshConfig.storage as any);
        setStorageManager(manager);
        manager.registerStorage(providerId, storage);
        // 将所有其他 enabled provider 也注册进去（不连接）
        for (const p of freshConfig.storage?.providers || []) {
          if (p.id !== providerId && (p as any).enabled) {
            try {
              manager.registerStorage(p.id, createStorage(p as StorageConfig));
            } catch (_) { /* 忽略不支持的类型 */ }
          }
        }
      } catch (regError) {
        console.warn('[Storage API] Failed to persist storage after test:', regError);
      }
    } else if (connected && hasStorageManager()) {
      // 已有 StorageManager，确保 storage 是已注册状态（无需额外操作）
    }

    res.json({
      success: true,
      providerId,
      connected,
      message: connected ? 'Connection successful' : 'Connection failed — host reachable but authentication or path may be incorrect'
    });
  } catch (error) {
    console.error('[Storage API] Test connection error:', error);

    let hint = '';
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('ECONNREFUSED')) hint = 'Connection refused — check host and port';
    else if (msg.includes('ENOTFOUND')) hint = 'Host not found — check the URL or hostname';
    else if (msg.includes('401') || msg.includes('Unauthorized')) hint = 'Authentication failed — check username and password';
    else if (msg.includes('403') || msg.includes('Forbidden')) hint = 'Access denied — check user permissions';

    res.status(500).json({
      success: false,
      connected: false,
      message: `Connection test failed: ${msg}`,
      ...(hint && { hint })
    });
  }
});

// 获取存储健康状态
router.get('/api/storage/health', async (req, res) => {
  try {
    if (!hasStorageManager()) {
      return res.status(503).json({
        error: 'Storage system not initialized'
      });
    }

    const storageManager = getStorageManager();
    const healthStatus = await storageManager.healthCheck();

    const currentStorageId = storageManager.getCurrentStorageId();

    res.json({
      current: currentStorageId,
      providers: healthStatus,
      overall: Object.values(healthStatus).some(status => status) ? 'healthy' : 'unhealthy'
    });
  } catch (error) {
    console.error('[Storage API] Health check error:', error);
    res.status(500).json({
      error: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

// 获取存储配置（不包含敏感信息）
router.get('/api/storage/config', (req, res) => {
  try {
    if (!hasStorageManager()) {
      return res.status(503).json({
        error: 'Storage system not initialized'
      });
    }

    const storageManager = getStorageManager();
    const config = storageManager.getConfig();

    res.json(config);
  } catch (error) {
    console.error('[Storage API] Get config error:', error);
    res.status(500).json({
      error: `Failed to get config: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

// ─── 存储提供者 CRUD ───────────────────────────────────────────────────────────

// 获取单个提供者配置（密码脱敏）
router.get('/api/storage/providers/:providerId', (req, res) => {
  const { providerId } = req.params;
  try {
    const config = getConfig();
    const provider = config.storage?.providers.find(p => p.id === providerId);
    if (!provider) {
      return res.status(404).json({ error: `Storage provider '${providerId}' not found` });
    }
    const { password, ...rest } = provider as any;
    res.json({ ...rest, hasPassword: !!password });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get provider' });
  }
});

// 添加新存储提供者
router.post('/api/storage/providers', async (req, res) => {
  const providerData = req.body;

  if (!providerData.id || !providerData.name || !providerData.type) {
    return res.status(400).json({ error: 'id, name, and type are required' });
  }

  try {
    const config = getConfig();

    if (config.storage?.providers.some((p: any) => p.id === providerData.id)) {
      return res.status(409).json({ error: `Storage provider '${providerData.id}' already exists` });
    }

    const updatedStorage = {
      default: config.storage?.default || providerData.id,
      providers: [...(config.storage?.providers || []), providerData]
    };

    await saveConfig({ ...config, storage: updatedStorage } as any);

    // 热注册到 StorageManager（无需重启）
    if (hasStorageManager()) {
      try {
        const storageManager = getStorageManager();
        const storage = createStorage(providerData as StorageConfig);
        storageManager.registerStorage(providerData.id, storage);
      } catch (regError) {
        console.warn(`[Storage API] Hot-register failed, restart required:`, regError);
      }
    } else {
      // StorageManager 尚未初始化（首次添加提供者），自动创建并初始化
      try {
        const freshConfig = getConfig();
        const manager = new StorageManager(freshConfig.storage as any);
        // 先注册，再初始化——这样即使连接失败 API 也能正常工作
        setStorageManager(manager);
        manager.initialize().then(() => {
          console.log('[Storage API] StorageManager initialized after first provider added');
        }).catch((initError: unknown) => {
          console.warn('[Storage API] Auto-init StorageManager connection failed:', initError);
        });
      } catch (initError) {
        console.warn('[Storage API] Auto-init StorageManager failed:', initError);
      }
    }

    res.status(201).json({ success: true, id: providerData.id });
  } catch (error) {
    console.error('[Storage API] Add provider error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add provider' });
  }
});

// 更新存储提供者
router.put('/api/storage/providers/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const updates = req.body;

  try {
    const config = getConfig();
    const providers: any[] = config.storage?.providers || [];
    const index = providers.findIndex((p: any) => p.id === providerId);

    if (index === -1) {
      return res.status(404).json({ error: `Storage provider '${providerId}' not found` });
    }

    const existing = providers[index];
    const merged = {
      ...existing,
      ...updates,
      id: providerId,
      // 若密码为空则保留原密码（编辑时不强制重输）
      password: updates.password?.trim() ? updates.password : existing.password
    };

    const newProviders = [...providers];
    newProviders[index] = merged;

    await saveConfig({ ...config, storage: { ...config.storage!, providers: newProviders } } as any);

    // 热更新 storage 实例
    if (hasStorageManager()) {
      try {
        const storageManager = getStorageManager();
        const storage = createStorage(merged as StorageConfig);
        storageManager.registerStorage(providerId, storage);
      } catch (regError) {
        console.warn(`[Storage API] Hot-update failed:`, regError);
      }
    }

    res.json({ success: true, id: providerId });
  } catch (error) {
    console.error('[Storage API] Update provider error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update provider' });
  }
});

// 删除存储提供者
router.delete('/api/storage/providers/:providerId', async (req, res) => {
  const { providerId } = req.params;

  try {
    const config = getConfig();
    const providers: any[] = config.storage?.providers || [];

    if (!providers.some((p: any) => p.id === providerId)) {
      return res.status(404).json({ error: `Storage provider '${providerId}' not found` });
    }

    // 不能删除唯一的活跃提供者
    if (hasStorageManager()) {
      const storageManager = getStorageManager();
      const currentId = storageManager.getCurrentStorageId();
      const remaining = providers.filter((p: any) => p.id !== providerId);
      if (currentId === providerId && remaining.length === 0) {
        return res.status(400).json({ error: 'Cannot delete the only active storage provider' });
      }
    }

    const newProviders = providers.filter((p: any) => p.id !== providerId);
    const newDefault = config.storage!.default === providerId
      ? (newProviders[0]?.id || '')
      : config.storage!.default;

    await saveConfig({ ...config, storage: { default: newDefault, providers: newProviders } } as any);

    res.json({ success: true });
  } catch (error) {
    console.error('[Storage API] Delete provider error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete provider' });
  }
});

// 测试未保存的提供者配置（表单中的"测试连接"按钮）
// 注意：此路由须在 /providers/:providerId 前注册，避免被拦截
router.post('/api/storage/providers/test', async (req, res) => {
  const providerData = req.body;
  const timeoutMs = 10000;

  if (!providerData.type) {
    return res.status(400).json({ error: 'type is required' });
  }

  try {
    let storage: IStorage;
    try {
      storage = createStorage({ ...providerData, id: '__test__', enabled: true } as StorageConfig);
    } catch (createErr) {
      const msg = createErr instanceof Error ? createErr.message : `Unsupported storage type: ${providerData.type}`;
      console.error('[Storage API] createStorage failed:', createErr);
      return res.status(400).json({ error: msg });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    try {
      await Promise.race([storage.connect(), timeoutPromise]);
      const connected = storage.isConnected();
      await storage.disconnect().catch(() => {});
      res.json({ success: true, connected, message: connected ? 'Connection successful' : 'Connection failed' });
    } catch (connectError) {
      const msg = connectError instanceof Error ? connectError.message : 'Unknown error';
      let hint = '';
      if (msg.includes('ECONNREFUSED')) hint = 'Connection refused — check host and port';
      else if (msg.includes('ENOTFOUND')) hint = 'Host not found — check the URL';
      else if (msg.includes('401') || msg.includes('Unauthorized')) hint = 'Authentication failed';
      else if (msg.includes('timed out')) hint = 'Check that the NAS is reachable on the network';

      res.json({ success: false, connected: false, message: msg, ...(hint && { hint }) });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      message: error instanceof Error ? error.message : 'Failed to create storage client'
    });
  }
});

export default router;