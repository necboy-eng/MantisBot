import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { FileAttachment } from '../types.js';

/**
 * 文件存储服务
 * 负责文件的保存、读取和管理
 */
export class FileStorage {
  private uploadDir: string;

  constructor(baseDir: string = './data/uploads') {
    this.uploadDir = path.resolve(baseDir);
    this.ensureDir(this.uploadDir);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 保存文件
   * @param filename 原始文件名
   * @param content 文件内容 (Buffer 或 base64 字符串)
   * @param mimeType MIME 类型
   * @returns 文件附件信息
   */
  saveFile(filename: string, content: Buffer | string, mimeType: string): FileAttachment {
    const id = uuidv4();
    const ext = path.extname(filename);
    const storedName = `${id}${ext}`;
    const filePath = path.join(this.uploadDir, storedName);

    // 处理 base64 编码的内容
    const buffer = typeof content === 'string'
      ? Buffer.from(content, 'base64')
      : content;

    fs.writeFileSync(filePath, buffer);

    return {
      id,
      name: filename,
      size: buffer.length,
      mimeType,
      url: `/api/files/${storedName}`
    };
  }

  /**
   * 保存文本文件
   */
  saveTextFile(filename: string, content: string): FileAttachment {
    return this.saveFile(filename, Buffer.from(content, 'utf-8'), 'text/plain');
  }

  /**
   * 保存 JSON 文件
   */
  saveJsonFile(filename: string, data: unknown): FileAttachment {
    const content = JSON.stringify(data, null, 2);
    return this.saveFile(filename, Buffer.from(content, 'utf-8'), 'application/json');
  }

  /**
   * 保存图片文件
   */
  saveImageFile(filename: string, content: Buffer | string, mimeType: string = 'image/png'): FileAttachment {
    return this.saveFile(filename, content, mimeType);
  }

  /**
   * 读取文件
   * @param storedName 存储的文件名 (带 uuid 的名称)
   * @returns 文件 Buffer 或 null
   */
  readFile(storedName: string): Buffer | null {
    const filePath = path.join(this.uploadDir, storedName);

    // 安全检查：防止路径遍历攻击
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.uploadDir)) {
      return null;
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.readFileSync(filePath);
  }

  /**
   * 获取文件信息
   */
  getFileInfo(storedName: string): { size: number; mimeType: string } | null {
    const filePath = path.join(this.uploadDir, storedName);

    // 安全检查
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.uploadDir)) {
      return null;
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(storedName).toLowerCase();

    // 简单的 MIME 类型推断
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.html': 'text/html',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.zip': 'application/zip',
    };

    return {
      size: stats.size,
      mimeType: mimeTypes[ext] || 'application/octet-stream'
    };
  }

  /**
   * 删除文件
   */
  deleteFile(storedName: string): boolean {
    const filePath = path.join(this.uploadDir, storedName);

    // 安全检查
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.uploadDir)) {
      return false;
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }

    return false;
  }

  /**
   * 获取文件的绝对路径（用于直接传给 Agent 读取）
   * @param storedName 存储的文件名（带 uuid 的名称）
   */
  getFilePath(storedName: string): string | null {
    const filePath = path.join(this.uploadDir, storedName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.uploadDir)) {
      return null;
    }
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return resolved;
  }

  /**
   * 列出所有文件
   */
  listFiles(): string[] {
    return fs.readdirSync(this.uploadDir);
  }

}

// 单例实例
let fileStorage: FileStorage | null = null;

export function getFileStorage(baseDir?: string): FileStorage {
  if (!fileStorage) {
    fileStorage = new FileStorage(baseDir);
  }
  return fileStorage;
}
