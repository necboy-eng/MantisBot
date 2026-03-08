// src/storage/storage.interface.ts

export interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  mimeType?: string;
}

export interface FileStats {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modified: Date;
  created: Date;
}

export interface StorageConfig {
  id: string;
  name: string;
  type: 'local' | 'nas';
  enabled: boolean;

  // 本地存储配置
  path?: string;

  // NAS 存储配置
  protocol?: 'webdav' | 'smb';
  url?: string;
  username?: string;
  password?: string;
  basePath?: string;
  timeout?: number;
  // 本地挂载路径（NAS 已通过操作系统挂载时有效）
  localMountPath?: string;

  // SMB 专用配置（运行时填充）
  share?: string;    // SMB 共享路径
  domain?: string;   // SMB 域名
}

export interface IStorage {
  name: string;
  type: 'local' | 'nas';
  config: StorageConfig;

  // 连接管理
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ping(): Promise<boolean>;

  // 目录操作
  listDirectory(path: string): Promise<FileSystemItem[]>;
  createDirectory(path: string): Promise<void>;

  // 文件操作
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: Buffer): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  copyFile(sourcePath: string, destPath: string): Promise<void>;

  // 元数据操作
  exists(path: string): Promise<boolean>;
  getStats(path: string): Promise<FileStats>;

  // 文件流���作 (大文件支持)
  createReadStream(path: string): Promise<NodeJS.ReadableStream>;
  createWriteStream(path: string): Promise<NodeJS.WritableStream>;
}

export interface StorageManagerConfig {
  default: string;
  providers: StorageConfig[];
}

// 错误类型
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly storage?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class StorageConnectionError extends StorageError {
  constructor(message: string, storage?: string, originalError?: Error) {
    super(message, 'CONNECTION_ERROR', storage, originalError);
    this.name = 'StorageConnectionError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(path: string, storage?: string) {
    super(`File or directory not found: ${path}`, 'NOT_FOUND', storage);
    this.name = 'StorageNotFoundError';
  }
}

export class StoragePermissionError extends StorageError {
  constructor(message: string, storage?: string, originalError?: Error) {
    super(message, 'PERMISSION_DENIED', storage, originalError);
    this.name = 'StoragePermissionError';
  }
}