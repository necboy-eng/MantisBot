/**
 * 路径安全守护模块
 * 用于保护敏感目录不被访问
 */

import path from 'path';

// Docker 环境下需要隐藏的敏感目录（绝对路径）
// 包括应用内部目录和系统级敏感目录
const SENSITIVE_PATHS = new Set([
  // === 应用内部目录 ===
  '/app',              // 应用根目录（源代码）
  '/app/config',       // 配置目录
  '/app/data',         // 数据目录
  '/app/skills',       // 技能目录
  '/app/dist',         // 编译输出
  '/app/src',          // 源代码
  '/app/web-ui',       // 前端代码
  '/app/plugins',      // 插件目录
  '/app/.git',         // Git 仓库
  '/app/.playwright',  // Playwright 浏览器
  '/app/.playwright-python', // Python Playwright
  '/app/python-venv',  // Python 虚拟环境

  // === Linux 系统级敏感目录（Docker 容器内）===
  '/bin',              // 系统二进制文件
  '/sbin',             // 系统管理二进制文件
  '/lib',              // 系统库
  '/lib64',            // 64位系统库
  '/usr',              // 用户程序和库
  '/etc',              // 系统配置文件（可能含密码、密钥）
  '/proc',             // 进程信息（敏感）
  '/sys',              // 系统内核信息（敏感）
  '/dev',              // 设备文件（敏感）
  '/var',              // 系统可变数据（日志、缓存等）
  '/run',              // 运行时数据
  '/boot',             // 启动文件
  '/opt',              // 可选软件包
  '/srv',              // 服务数据
  '/mnt',              // 挂载点
  '/media',            // 可移动媒体
  '/lost+found',       // 文件系统恢复目录

  // === macOS 系统级敏感目录 ===
  '/System',           // macOS 系统文件
  '/Library',          // macOS 系统库和配置
  '/Applications',     // macOS 应用程序
  '/private',          // macOS 私有系统文件（含 /tmp, /var, /etc 的实际位置）
  '/Volumes',          // macOS 挂载的卷
  '/Network',          // macOS 网络目录
  '/cores',            // macOS 核心转储文件
  '/.fseventsd',       // macOS 文件系统事件
  '/.Spotlight-V100',  // macOS Spotlight 索引
  '/.Trashes',         // macOS 回收站
  '/.vol',             // macOS 卷标链接

  // === Windows 系统级敏感目录 ===
  'C:\\Windows',               // Windows 系统目录
  'C:\\Program Files',         // Windows 程序文件
  'C:\\Program Files (x86)',   // Windows 32位程序
  'C:\\ProgramData',           // Windows 程序数据
  'C:\\System Volume Information', // Windows 系统还原信息
  'C:\\$Recycle.Bin',          // Windows 回收站
  'C:\\$RECYCLE.BIN',          // Windows 回收站（大写）
  'C:\\Recovery',              // Windows 恢复分区
  'C:\\Boot',                  // Windows 启动文件
  'C:\\EFI',                   // Windows EFI 分区
  'C:\\PerfLogs',              // Windows 性能日志
  'C:\\Documents and Settings', // Windows 旧版用户目录（软链接）
  'C:\\Config.Msi',            // Windows 安装配置
  'C:\\Intel',                 // Intel 驱动和工具
  'C:\\AMD',                   // AMD 驱动和工具
  'C:\\NVIDIA',                // NVIDIA 驱动和工具
]);

// 允许访问的敏感目录的子路径（白名单）
// 这些路径虽然是敏感目录的子目录，但需要允许用户访问
const ALLOWED_SENSITIVE_SUBPATHS = new Set([
  '/app/data/uploads',       // 用户上传的附件
  '/private/tmp/mantis-nas', // NAS 自动挂载点（macOS /tmp 的真实路径）
  '/tmp/mantis-nas',         // NAS 自动挂载点
  '/Volumes',                // macOS 网络挂载卷（NAS 通过 Finder/系统挂载到此）
]);

/**
 * 检查路径是否在敏感路径列表中或其子路径
 * @param itemPath 要检查的路径
 * @returns 是否为敏感路径
 */
export function isSensitivePath(itemPath: string): boolean {
  const normalized = path.normalize(itemPath);

  // 首先检查是否在白名单中
  for (const allowed of ALLOWED_SENSITIVE_SUBPATHS) {
    if (normalized === allowed || normalized.startsWith(allowed + '/') || normalized.startsWith(allowed + '\\')) {
      return false; // 在白名单中，不视为敏感路径
    }
  }

  // 检查是否是敏感路径或敏感路径的子目录
  for (const sensitive of SENSITIVE_PATHS) {
    if (normalized === sensitive || normalized.startsWith(sensitive + '/') || normalized.startsWith(sensitive + '\\')) {
      return true;
    }
  }
  return false;
}

/**
 * 检查目录项是否应该被隐藏（用于列出目录内容时过滤子项）
 * @param parentPath 父目录路径
 * @param itemName 子项名称
 * @returns 是否应该隐藏
 */
export function shouldHideItem(parentPath: string, itemName: string): boolean {
  const itemFullPath = path.join(parentPath, itemName);
  return isSensitivePath(itemFullPath);
}

/**
 * 检查路径是否安全（同时检查路径遍历和敏感路径）
 * @param targetPath 目标路径
 * @returns 如果不安全，返回错误消息；如果安全，返回 null
 */
export function checkPathSafety(targetPath: string): string | null {
  // 检查路径遍历攻击
  const resolved = path.resolve(targetPath);
  if (resolved.includes('..')) {
    return 'Path traversal detected';
  }

  // 检查敏感路径
  if (isSensitivePath(resolved)) {
    return 'Access to this path is restricted';
  }

  return null;
}

/**
 * 过滤目录列表中的敏感项
 * @param items 文件/目录项列表
 * @param parentPath 父目录路径
 * @returns 过滤后的列表
 */
export function filterSensitiveItems<T extends { name: string }>(
  items: T[],
  parentPath: string
): T[] {
  return items.filter(item => {
    // 过滤隐藏文件
    if (item.name.startsWith('.')) {
      return false;
    }
    // 过滤敏感目录
    if (shouldHideItem(parentPath, item.name)) {
      return false;
    }
    return true;
  });
}

// 导出配置供其他模块使用（如果需要自定义）
export { SENSITIVE_PATHS, ALLOWED_SENSITIVE_SUBPATHS };
