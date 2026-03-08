import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { getConfig } from '../../config/loader.js';
import { getFileStorage } from '../../files/index.js';
import type { Tool, FileAttachment } from '../../types.js';

/**
 * 将路径展开（处理 ~ 和环境变量）
 */
function expandPath(filepath: string): string {
  if (filepath.startsWith('~')) {
    return path.join(homedir(), filepath.slice(1));
  }
  return path.resolve(filepath);
}

/**
 * 获取 MIME 类型
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.zip': 'application/zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 检查路径是否安全
 */
function isPathSafe(filepath: string): boolean {
  const config = getConfig();
  const allowedPaths = config.allowedPaths || [];
  const homeDir = homedir();

  const resolved = path.resolve(filepath);

  // 检查配置允许的路径
  for (const allowedPath of allowedPaths) {
    if (resolved.startsWith(allowedPath)) {
      return true;
    }
  }

  // 默认允许用户目录和 /tmp
  const isTmp = resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/');
  return resolved.startsWith(homeDir) || isTmp;
}

/**
 * 发送文件工具
 * 将本地文件作为附件发送给用户
 */
export const sendFileTool: Tool = {
  name: 'send_file',
  description: '将本地文件作为附件直接发送给用户。调用此工具后文件会立即发送，用户在聊天界面中可以直接看到并下载。支持发送单个文件或多个文件。调用成功后请直接告知用户文件已发送，不要再尝试生成下载链接。',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '文件的完整路径，支持 ~ 表示用户目录'
            },
            name: {
              type: 'string',
              description: '可选的显示文件名，不提供则使用原文件名'
            }
          },
          required: ['path']
        },
        description: '要发送的文件列表'
      }
    },
    required: ['files']
  },
  execute: async (params: Record<string, unknown>) => {
    const rawFiles = params.files;
    const fileStorage = getFileStorage();
    const attachments: FileAttachment[] = [];
    const errors: string[] = [];

    if (!rawFiles || !Array.isArray(rawFiles)) {
      return {
        message: '❌ 参数错误：需要提供 files 数组',
        sent: 0,
        attachments: [],
        errors: ['参数错误：需要提供 files 数组']
      };
    }

    // 规范化文件列表：支持字符串数组或对象数组两种格式
    const files: Array<{ path: string; name?: string }> = [];
    for (const item of rawFiles) {
      if (typeof item === 'string') {
        // 字符串格式：直接作为路径
        files.push({ path: item });
      } else if (item && typeof item === 'object' && 'path' in item) {
        // 对象格式：提取 path
        files.push({ path: (item as { path: string }).path, name: (item as { name?: string }).name });
      } else {
        errors.push(`无效的文件参数: ${JSON.stringify(item)}`);
      }
    }

    for (const file of files) {
      try {
        // 检查 path 是否存在
        if (!file.path || typeof file.path !== 'string') {
          errors.push(`文件路径无效或缺失: ${JSON.stringify(file)}`);
          continue;
        }

        const expandedPath = expandPath(file.path);

        // 安全检查
        if (!isPathSafe(expandedPath)) {
          errors.push(`安全限制：只能发送用户目录、/tmp 或 allowedPaths 配置中的文件，跳过: ${file.path}`);
          continue;
        }

        // 检查文件是否存在
        if (!fs.existsSync(expandedPath)) {
          errors.push(`文件不存在: ${file.path}`);
          continue;
        }

        // 读取文件
        const content = fs.readFileSync(expandedPath);
        const originalName = path.basename(expandedPath);
        const displayName = file.name || originalName;
        const mimeType = getMimeType(expandedPath);

        // 保存到文件存储
        const attachment = fileStorage.saveFile(displayName, content, mimeType);
        attachments.push(attachment);

        console.log(`[send_file] 已准备文件: ${displayName} (${attachment.size} bytes)`);
      } catch (error) {
        const filePath = file.path || '(unknown)';
        errors.push(`处理文件失败 ${filePath}: ${error}`);
      }
    }

    const result: {
      message: string;
      sent: number;
      attachments: FileAttachment[];
      errors?: string[];
    } = {
      message: attachments.length > 0
        ? `✅ 文件已发送成功（共 ${attachments.length} 个）：${attachments.map(a => a.name).join('、')}。⚠️ 请勿重复调用此工具，文件已投递给用户。${errors.length > 0 ? ` 另有 ${errors.length} 个文件失败。` : ''}`
        : `❌ 所有文件处理失败`,
      sent: attachments.length,
      attachments,
    };

    if (errors.length > 0) {
      result.errors = errors;
      result.message += `\n\n错误详情:\n${errors.map(e => `- ${e}`).join('\n')}`;
    }

    return result;
  }
};

export default sendFileTool;
