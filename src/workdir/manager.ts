/**
 * 工作目录管理器
 * 用于全局管理和切换当前工作目录
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getConfig } from '../config/loader.js';

// 常见办公文件类型
const OFFICE_FILE_EXTENSIONS = new Set([
  // 文档
  '.doc', '.docx', '.pdf', '.md', '.txt', '.rtf', '.odt',
  // 表格
  '.xls', '.xlsx', '.csv', '.ods',
  // 演示
  '.ppt', '.pptx', '.odp',
  // 邮件
  '.eml', '.msg',
  // 笔记/任务
  '.one', '.onenote', '.note',
  // 压缩包（可能包含重要文档）
  '.zip', '.rar', '.7z',
  // 图片（截图、扫描件）
  '.png', '.jpg', '.jpeg', '.pdf',
  // 代码/配置（技术文档）
  '.json', '.yaml', '.yml', '.xml',
]);

// 忽略的目录名
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__',
  '.DS_Store', 'Thumbs.db', '$RECYCLE.BIN',
  '.Trash', '.trash', 'System Volume Information',
]);

// 扫描配置
const MAX_DEPTH = 2;  // 最大扫描深度
const MAX_FILES_PER_DIR = 30;  // 每个目录最多显示的文件数
const MAX_TOTAL_ITEMS = 100;  // 总共最多显示的项目数

/**
 * 检测是否在 Docker 容器中运行
 */
function isRunningInDocker(): boolean {
  // 检查 /.dockerenv 文件是否存在
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }
  // 检查 cgroup 是否包含 docker 关键字
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('kubepods');
  } catch {
    return false;
  }
}

/**
 * 获取 Docker 环境下的默认工作目录
 * 宿主机主目录通常挂载到 /app/host-home
 */
function getDockerDefaultWorkDir(): string | null {
  const hostHomeMount = '/app/host-home';
  if (fs.existsSync(hostHomeMount)) {
    try {
      const stats = fs.statSync(hostHomeMount);
      if (stats.isDirectory()) {
        return hostHomeMount;
      }
    } catch {
      // 忽略错误
    }
  }
  return null;
}

class WorkDirManager {
  private currentWorkDir: string;

  constructor() {
    // 在 Docker 环境中，优先使用挂载的宿主机主目录
    if (isRunningInDocker()) {
      const dockerDefault = getDockerDefaultWorkDir();
      if (dockerDefault) {
        this.currentWorkDir = dockerDefault;
        console.log(`[WorkDirManager] Running in Docker, using mounted host home: ${dockerDefault}`);
        return;
      }
    }
    // 默认使用用户主目录
    this.currentWorkDir = os.homedir();
  }

  /**
   * 获取当前工作目录
   */
  getCurrentWorkDir(): string {
    return this.currentWorkDir;
  }

  /**
   * 设置当前工作目录
   * @param newDir 新的工作目录路径
   * @returns 是否设置成功
   * 注：路径权限检查已由 ACL 系统接管
   */
  setCurrentWorkDir(newDir: string): { success: boolean; error?: string } {
    try {
      // 解析绝对路径
      const resolvedPath = path.resolve(newDir);

      // 检查目录是否存在
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `目录不存在: ${resolvedPath}` };
      }

      // 检查是否是目录
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { success: false, error: `路径不是目录: ${resolvedPath}` };
      }

      // 检查读取权限
      try {
        fs.accessSync(resolvedPath, fs.constants.R_OK);
      } catch {
        return { success: false, error: `没有读取权限: ${resolvedPath}` };
      }

      // 设置新的工作目录
      this.currentWorkDir = resolvedPath;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `设置工作目录失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 获取用户主目录
   * 在 Docker 环境中返回挂载的宿主机主目录
   */
  getHomeDir(): string {
    if (isRunningInDocker()) {
      const dockerDefault = getDockerDefaultWorkDir();
      if (dockerDefault) {
        return dockerDefault;
      }
    }
    return os.homedir();
  }

  /**
   * 获取工作目录信息
   */
  getWorkDirInfo() {
    const inDocker = isRunningInDocker();
    const dockerHostHome = inDocker ? getDockerDefaultWorkDir() : null;

    return {
      current: this.currentWorkDir,
      home: this.getHomeDir(),
      platform: process.platform,
      isDocker: inDocker,
      // Docker 环境下的挂载信息
      dockerMount: dockerHostHome ? {
        containerPath: dockerHostHome,
        hostPathHint: '~ (宿主机主目录)'
      } : null
    };
  }

  /**
   * 获取工作目录的上下文摘要（用于注入到系统提示词）
   * 扫描目录结构，生成轻量级的概览，适合办公场景
   */
  getWorkDirContext(): string {
    try {
      const lines: string[] = [];
      let totalItems = 0;

      // 递归扫描目录
      const scanDir = (dirPath: string, depth: number, prefix: string): void => {
        if (depth > MAX_DEPTH || totalItems >= MAX_TOTAL_ITEMS) return;

        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return; // 无权限访问，跳过
        }

        // 过滤并排序：目录在前，然后按名称排序
        const filtered = entries
          .filter(e => !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

        let fileCount = 0;
        for (const entry of filtered) {
          if (totalItems >= MAX_TOTAL_ITEMS) break;
          if (fileCount >= MAX_FILES_PER_DIR && !entry.isDirectory()) continue;

          const isDir = entry.isDirectory();
          const ext = path.extname(entry.name).toLowerCase();
          const isOfficeFile = OFFICE_FILE_EXTENSIONS.has(ext) || isDir;

          // 只显示办公相关文件和目录
          if (!isOfficeFile && !isDir) continue;

          const icon = isDir ? '📁' : this.getFileIcon(ext);
          lines.push(`${prefix}${icon} ${entry.name}`);
          totalItems++;
          fileCount++;

          // 递归扫描子目录
          if (isDir && depth < MAX_DEPTH) {
            scanDir(path.join(dirPath, entry.name), depth + 1, prefix + '  ');
          }
        }
      };

      scanDir(this.currentWorkDir, 0, '');

      if (lines.length === 0) {
        return '';
      }

      return `### 目录结构概览
${lines.join('\n')}
> 💡 提示：使用 \`glob\` 或 \`read\` 工具查看更多文件内容`;
    } catch (error) {
      console.error('[WorkDirManager] Error getting work dir context:', error);
      return '';
    }
  }

  /**
   * 根据文件扩展名获取图标
   */
  private getFileIcon(ext: string): string {
    const iconMap: Record<string, string> = {
      // 文档
      '.doc': '📘', '.docx': '📘',
      '.pdf': '📕',
      '.md': '📝', '.txt': '📄',
      '.rtf': '📄', '.odt': '📘',
      // 表格
      '.xls': '📊', '.xlsx': '📊',
      '.csv': '📊', '.ods': '📊',
      // 演示
      '.ppt': '📽️', '.pptx': '📽️',
      '.odp': '📽️',
      // 邮件
      '.eml': '📧', '.msg': '📧',
      // 压缩包
      '.zip': '📦', '.rar': '📦', '.7z': '📦',
      // 图片
      '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
      // 配置
      '.json': '⚙️', '.yaml': '⚙️', '.yml': '⚙️', '.xml': '⚙️',
    };
    return iconMap[ext] || '📄';
  }
}

// 单例实例
export const workDirManager = new WorkDirManager();
