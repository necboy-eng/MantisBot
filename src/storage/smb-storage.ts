// src/storage/smb-storage.ts
// node-smb2 是可选依赖，在 connect() 时动态加载，避免包未安装时启动崩溃

import type {
  IStorage,
  StorageConfig,
  FileSystemItem,
  FileStats
} from './storage.interface.js';
import {
  StorageError,
  StorageConnectionError,
  StorageNotFoundError
} from './storage.interface.js';
import { createReadStream } from 'fs';
import path from 'path';

// 类型定义（node-smb2 无官方类型声明）
type SMBClient = any;
type SMBSession = any;
type SMBTree = any;

export class SmbStorage implements IStorage {
  name: string;
  type: 'nas' = 'nas';
  config: StorageConfig;
  private client: SMBClient | null = null;
  private session: SMBSession | null = null;
  private tree: SMBTree | null = null;
  private connected: boolean = false;
  private host: string;
  private shareName: string;

  constructor(config: StorageConfig) {
    this.config = config;
    this.name = config.name;

    if (!config.url || !config.username || !config.password) {
      throw new StorageError(
        'SMB storage requires url, username, and password',
        'INVALID_CONFIG',
        config.id
      );
    }

    // 从 URL 中提取 host 和 share
    // URL 格式: smb://host/share 或 //host/share
    let urlString = config.url;
    if (!urlString.includes('://')) {
      urlString = 'smb:' + urlString;
    }
    const url = new URL(urlString);
    const sharePath = url.pathname.split('/').filter(Boolean);

    if (sharePath.length === 0) {
      throw new StorageError(
        'SMB URL must include share name (e.g., smb://192.168.1.100/share)',
        'INVALID_CONFIG',
        config.id
      );
    }

    this.host = url.hostname;
    this.shareName = sharePath.join('/');
    this.config.share = this.shareName;

    // domain 优先使用显式配置，其次从 URL 用户名部分解析（DOMAIN\user 格式）
    if (!this.config.domain) {
      this.config.domain = url.username?.split('%5C')[0] || url.username?.split('\\')[0] || '';
    }

    console.log(`[SmbStorage] Configured for: ${config.url}`);
  }

  async connect(): Promise<void> {
    // 动态加载 node-smb2（可选依赖，缺失时给出明确错误提示）
    let SMB2Client: any;
    try {
      const mod = await import('node-smb2');
      SMB2Client = mod.Client ?? mod.default?.Client ?? mod.default ?? mod;
    } catch {
      throw new StorageError(
        'node-smb2 is not installed. Run: npm install node-smb2',
        'MISSING_DEPENDENCY',
        this.config.id
      );
    }

    try {
      this.client = new SMB2Client(this.host);
    } catch (depError) {
      // 重新抛出依赖缺失错误（StorageError），其他错误继续往下处理
      if (depError instanceof StorageError) throw depError;
      throw new StorageError(
        `Failed to create SMB client: ${depError instanceof Error ? depError.message : 'Unknown error'}`,
        'CLIENT_CREATION_FAILED',
        this.config.id
      );
    }

    try {
      // authenticate() 内部会自动完成 TCP 连接，不需要先调用 connect()
      this.session = await this.client.authenticate({
        domain: this.config.domain || '',
        username: this.config.username!,
        password: this.config.password!,
        forceNtlmVersion: 'v2'
      });

      // 连接到共享树
      this.tree = await this.session.connectTree(this.config.share || '');

      this.connected = true;
      console.log(`[SmbStorage] Connected to: ${this.config.url}`);
    } catch (error: unknown) {
      this.connected = false;
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error && typeof error === 'object') {
        // 安全地序列化对象，处理 BigInt 等不可序列化的类型
        try {
          errorMessage = JSON.stringify(error, (_, value) => {
            if (typeof value === 'bigint') {
              return value.toString();
            }
            return value;
          });
        } catch {
          errorMessage = String(error);
        }
      } else {
        errorMessage = String(error);
      }
      console.error('[SmbStorage] Connection error details:', error);
      throw new StorageConnectionError(
        `Failed to connect to SMB '${this.name}': ${errorMessage}`,
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.tree) {
        await this.tree.disconnect();
        this.tree = null;
      }
      if (this.session) {
        await this.session.logoff();
        this.session = null;
      }
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      this.connected = false;
      console.log(`[SmbStorage] Disconnected from: ${this.config.url}`);
    } catch (error) {
      console.error('[SmbStorage] Error during disconnect:', error);
      this.connected = false;
      this.client = null;
      this.session = null;
      this.tree = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async ping(): Promise<boolean> {
    // 如果未连接，尝试重新连接
    if (!this.connected) {
      try {
        await this.connect();
      } catch {
        return false;
      }
    }

    if (!this.tree) {
      return false;
    }

    try {
      await this.tree.readDirectory('');
      return true;
    } catch {
      this.connected = false;
      // 重新连接失败
      try {
        await this.connect();
        return true;
      } catch {
        return false;
      }
    }
  }

  private getFullPath(relativePath: string): string {
    const basePath = this.config.basePath || '';
    // 去掉前导斜杠（防止将 Unix 绝对路径 /uploads 误拼入 SMB 路径）和末尾斜杠
    const cleanBase = basePath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\\/g, '\\').replace(/\\+$/, '');
    const cleanPath = relativePath.replace(/^[/\\]+/, '');
    // SMB 使用 Windows 风格路径分隔符
    if (cleanBase) {
      const joined = `${cleanBase}\\${cleanPath}`;
      return joined.replace(/\\+/g, '\\').replace(/\\$/, '');
    }
    return cleanPath;
  }

  private stripBasePath(fullPath: string): string {
    const basePath = this.config.basePath || '';
    if (!basePath) return fullPath;
    // 去掉前导斜杠，与 getFullPath 保持一致
    const cleanBase = basePath.replace(/^\/+/, '').replace(/[/\\]+$/, '');
    if (!cleanBase) return fullPath;
    return fullPath.replace(new RegExp(`^${this.escapeRegExp(cleanBase)}[/\\\\]?`), '') || '';
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private ensureConnected(): void {
    if (!this.connected || !this.tree) {
      throw new StorageConnectionError(
        'Not connected to SMB storage',
        this.config.id
      );
    }
  }

  async listDirectory(relativePath: string): Promise<FileSystemItem[]> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      // 规范化路径
      const normalizedPath = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/');

      // 阻止访问父目录 (..)
      if (normalizedPath.includes('..')) {
        console.warn(`[SmbStorage] Blocking attempt to access parent directory: ${relativePath}`);
        return [];
      }

      // 如果是空路径或根路径，使用空字符串
      const dirPath = (!normalizedPath || normalizedPath === '/') ? '' : normalizedPath;

      const fullPath = this.getFullPath(dirPath);
      console.log(`[SmbStorage] Listing: relativePath='${relativePath}', fullPath='${fullPath}'`);

      const entries = await this.tree.readDirectory(fullPath);

      // 过滤 . 和 .. 条目
      const filtered = entries.filter((e: any) => e.filename !== '.' && e.filename !== '..');
      console.log(`[SmbStorage] Entries: ${filtered.length} (raw: ${entries.length})`);

      return filtered.map((entry: any) => {
        // node-smb2 的 filename 可能带 './' 前缀，统一去掉
        const name = entry.filename.replace(/^\.\//, '');
        return {
          name,
          path: this.stripBasePath(fullPath ? `${fullPath}\\${name}` : name),
          type: entry.type === 'Directory' ? 'directory' : 'file',
          size: Number(entry.fileSize) || 0,
          modified: new Date(entry.lastWriteTime) || new Date(),
          mimeType: undefined
        };
      });
    } catch (error) {
      // 将错误对象序列化为可读字符串（node-smb2 返回自定义对象而非 Error 实例）
      const errMsg = error instanceof Error
        ? error.message
        : (() => { try { return JSON.stringify(error, (_, v) => typeof v === 'bigint' ? v.toString() : v); } catch { return String(error); } })();

      // 根目录失败时返回空数组而不是抛出（避免整个面板崩溃），但记录详细错误
      if (!relativePath || relativePath === '' || relativePath === '/') {
        console.error(`[SmbStorage] Root list failed: ${errMsg}`);
        return [];
      }
      throw new StorageError(
        `Failed to list directory '${relativePath}': ${errMsg}`,
        'LIST_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async createDirectory(relativePath: string): Promise<void> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);
      await this.tree.createDirectory(fullPath);
      console.log(`[SmbStorage] Created directory: ${fullPath}`);
    } catch (error) {
      throw new StorageError(
        `Failed to create directory '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_DIRECTORY_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async readFile(relativePath: string): Promise<Buffer> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);
      const content = await this.tree.readFile(fullPath);
      return content;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(relativePath, this.config.id);
      }
      throw new StorageError(
        `Failed to read file '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'READ_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async writeFile(relativePath: string, content: Buffer): Promise<void> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);

      // 确保父目录存在
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('\\'));
      if (parentDir && !(await this.tree.exists(parentDir))) {
        await this.tree.createDirectory(parentDir);
      }

      await this.tree.createFile(fullPath, content);
      console.log(`[SmbStorage] Wrote file: ${fullPath}`);
    } catch (error) {
      throw new StorageError(
        `Failed to write file '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WRITE_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);
      await this.tree.removeFile(fullPath);
      console.log(`[SmbStorage] Deleted file: ${fullPath}`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(relativePath, this.config.id);
      }
      throw new StorageError(
        `Failed to delete file '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    // SMB 删除目录需要递归删除所有文件
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const files = await this.listDirectory(relativePath);

      // 先删除所有文件
      for (const file of files) {
        if (file.type === 'file') {
          await this.deleteFile(file.path);
        } else {
          await this.deleteDirectory(file.path);
        }
      }

      // 然后删除目录
      const fullPath = this.getFullPath(relativePath);
      await this.tree.removeDirectory(fullPath);

      console.log(`[SmbStorage] Deleted directory: ${fullPath}`);
    } catch (error) {
      throw new StorageError(
        `Failed to delete directory '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullOldPath = this.getFullPath(oldPath);
      const fullNewPath = this.getFullPath(newPath);

      await this.tree.renameFile(fullOldPath, fullNewPath);

      console.log(`[SmbStorage] Renamed '${oldPath}' to '${newPath}'`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(oldPath, this.config.id);
      }
      throw new StorageError(
        `Failed to rename '${oldPath}' to '${newPath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RENAME_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      // SMB 复制需要先下载，然后上传
      const content = await this.readFile(sourcePath);
      await this.writeFile(destPath, content);

      console.log(`[SmbStorage] Copied '${sourcePath}' to '${destPath}'`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(sourcePath, this.config.id);
      }
      throw new StorageError(
        `Failed to copy '${sourcePath}' to '${destPath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'COPY_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    if (!this.connected || !this.tree) {
      return false;
    }

    try {
      const fullPath = this.getFullPath(relativePath);
      return await this.tree.exists(fullPath);
    } catch {
      return false;
    }
  }

  async getStats(relativePath: string): Promise<FileStats> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);

      // 尝试获取文件/目录信息
      // node-smb2 没有直接的 stat 方法，我们使用 readDirectory + 查找
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('\\')) || '';
      const itemName = fullPath.substring(fullPath.lastIndexOf('\\') + 1);

      const entries = await this.tree.readDirectory(parentPath);
      const entry = entries.find((e: any) => e.filename === itemName);

      if (entry) {
        return {
          size: Number(entry.fileSize) || 0,
          isDirectory: entry.type === 'Directory',
          isFile: entry.type === 'File',
          modified: new Date(entry.lastWriteTime) || new Date(),
          created: new Date(entry.creationTime) || new Date()
        };
      }

      // 如果找不到，可能是一个目录但为空，或者不存在
      const exists = await this.tree.exists(fullPath);
      if (exists) {
        return {
          size: 0,
          isDirectory: true,
          isFile: false,
          modified: new Date(),
          created: new Date()
        };
      }

      throw new StorageNotFoundError(relativePath, this.config.id);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(relativePath, this.config.id);
      }
      throw new StorageError(
        `Failed to get stats for '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STAT_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async createReadStream(relativePath: string): Promise<import('fs').ReadStream> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const content = await this.readFile(relativePath);
      // 将 Buffer 写入临时文件，然后创建流
      const tempDir = '/tmp/mantis-smb-temp';
      const tempFilePath = path.join(tempDir, path.basename(relativePath));

      // 确保临时目录存在
      const fs = await import('fs/promises');
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(tempFilePath, content);

      return createReadStream(tempFilePath);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(relativePath, this.config.id);
      }
      throw new StorageError(
        `Failed to create read stream for '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_READ_STREAM_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  async createWriteStream(relativePath: string): Promise<import('fs').WriteStream> {
    this.ensureConnected();
    if (!this.tree) throw new StorageError('SMB tree not available', 'TREE_NOT_AVAILABLE', this.config.id);

    try {
      const fullPath = this.getFullPath(relativePath);

      // 使用 Tree 的 createFileWriteStream 方法
      const writeStream = await this.tree.createFileWriteStream(fullPath);

      return writeStream as any;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new StorageNotFoundError(relativePath, this.config.id);
      }
      throw new StorageError(
        `Failed to create write stream for '${relativePath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_WRITE_STREAM_FAILED',
        this.config.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  private isNotFoundError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('not found') ||
             message.includes('no such file') ||
             message.includes('does not exist') ||
             message.includes('file not found') ||
             message.includes('object name not found') ||
             message.includes('status_not_found');
    }
    return false;
  }

  private getMime(filename: string): string {
    // SMB 不返回 MIME 类型，根据扩展名判断
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}
