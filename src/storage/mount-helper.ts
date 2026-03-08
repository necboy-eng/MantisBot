/**
 * NAS 自动挂载助手
 * 支持 macOS (mount_smbfs/osascript)、Windows (net use)、Linux (mount -t cifs)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { StorageConfig } from './storage.interface.js';

const execFileAsync = promisify(execFile);

export interface MountResult {
  success: boolean;
  mountPath: string;
  alreadyMounted: boolean;
  error?: string;
}

export interface UnmountResult {
  success: boolean;
  error?: string;
}

/**
 * 从 SMB URL 和配置生成挂载路径
 * macOS:   /tmp/mantis-nas/<providerId>
 * Windows: 不使用目录，用盘符映射
 * Linux:   /tmp/mantis-nas/<providerId>
 */
function getMountPoint(providerId: string): string {
  if (process.platform === 'win32') {
    // Windows 无法挂到任意目录，使用临时盘符占位，实际挂载逻辑另处理
    return `\\\\mantis-nas-${providerId}`;
  }
  return path.join(os.tmpdir(), 'mantis-nas', providerId);
}

/**
 * 检查路径是否已挂载（通过检测目录非空或 /proc/mounts）
 */
function isMounted(mountPoint: string): boolean {
  if (process.platform === 'win32') return false; // Windows 另行处理

  try {
    // 先检查挂载点是否存在
    if (!fs.existsSync(mountPoint)) return false;

    if (process.platform === 'linux') {
      // Linux: 读取 /proc/mounts
      try {
        const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
        return mounts.includes(mountPoint);
      } catch {
        return false;
      }
    }

    // macOS: 读取 /etc/mnttab 不可靠，改用 statfs 的 f_fstypename 字段
    // 简单方法：检查挂载点是否是独立文件系统（与父目录设备号不同）
    const { dev: mountDev } = fs.statSync(mountPoint);
    const parent = path.dirname(mountPoint);
    const { dev: parentDev } = fs.statSync(parent);
    return mountDev !== parentDev;
  } catch {
    return false;
  }
}

/**
 * 解析 SMB URL 为 mount_smbfs 可用的格式
 * smb://user:pass@host/share → //user:pass@host/share
 */
function buildSmbMountUrl(config: StorageConfig): string {
  const urlStr = config.url || '';
  let base = urlStr.startsWith('smb:') ? urlStr.slice(4) : urlStr;
  // base 现在是 //host/share
  // 插入 user:pass@
  const user = encodeURIComponent(config.username || '');
  const pass = encodeURIComponent(config.password || '');
  // //host/share → //user:pass@host/share
  base = base.replace(/^\/\//, `//${user}:${pass}@`);
  if (config.domain) {
    base = base.replace(/^\/\//, `//${encodeURIComponent(config.domain)};${user}:${pass}@`);
    // macOS domain format: //DOMAIN;user:pass@host/share
    base = `//${encodeURIComponent(config.domain)};${user}:${pass}@` + base.replace(/^\/\/[^@]+@/, '');
  }
  return base;
}

/**
 * macOS: 使用 mount_smbfs 挂载
 */
async function mountMacos(config: StorageConfig, mountPoint: string): Promise<void> {
  const smbUrl = buildSmbMountUrl(config);
  // mount_smbfs [-N] <//[domain;][user[:password]@]server/share> <mountpoint>
  await execFileAsync('/sbin/mount_smbfs', ['-N', smbUrl, mountPoint], {
    timeout: 30000
  });
}

/**
 * Linux: 使用 mount -t cifs 挂载（需要 cifs-utils）
 */
async function mountLinux(config: StorageConfig, mountPoint: string): Promise<void> {
  const urlStr = config.url || '';
  // smb://host/share → //host/share（CIFS 格式）
  const cifsPath = urlStr.replace(/^smb:/, '').replace(/^\/\//, '//');
  const opts: string[] = [
    `username=${config.username || ''}`,
    `password=${config.password || ''}`,
  ];
  if (config.domain) opts.push(`domain=${config.domain}`);
  opts.push('uid=' + process.getuid!(), 'gid=' + process.getgid!());

  await execFileAsync('mount', ['-t', 'cifs', cifsPath, mountPoint, '-o', opts.join(',')], {
    timeout: 30000
  });
}

/**
 * Windows: 使用 net use 映射网络驱动器
 * 返回映射的盘符路径（如 Z:\）
 */
async function mountWindows(config: StorageConfig): Promise<string> {
  const urlStr = config.url || '';
  // smb://host/share → \\host\share
  const uncPath = urlStr.replace(/^smb:\/\//, '\\\\').replace(/\//g, '\\');

  // 找一个未使用的盘符（从 Z: 往前找）
  const driveLetter = await findAvailableDriveLetter();
  if (!driveLetter) throw new Error('No available drive letters');

  const args = ['use', driveLetter, uncPath];
  if (config.username) {
    args.push(`/user:${config.domain ? config.domain + '\\' : ''}${config.username}`);
    if (config.password) args.push(config.password);
  }
  args.push('/persistent:no');

  await execFileAsync('net', args, { timeout: 30000 });
  return driveLetter + '\\';
}

async function findAvailableDriveLetter(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('wmic', ['logicaldisk', 'get', 'DeviceID'], { timeout: 5000 });
    const used = new Set(stdout.match(/[A-Z]:/g) || []);
    for (let code = 'Z'.charCodeAt(0); code >= 'D'.charCodeAt(0); code--) {
      const letter = String.fromCharCode(code) + ':';
      if (!used.has(letter)) return letter;
    }
  } catch {
    // fallback
  }
  return null;
}

/**
 * macOS: 查找 SMB 共享是否已通过系统（如 Finder）挂载，返回其挂载路径
 * 解析 `mount` 命令输出，匹配 share 名称（忽略 host 差异，如 IP vs mDNS）
 */
async function findExistingSystemMount(config: StorageConfig): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('mount', [], { timeout: 5000 });
    const urlStr = config.url || '';
    // 从 URL 提取 share 名称: smb://host/ShareName → ShareName
    const shareMatch = urlStr.match(/\/\/[^/]+\/([^/]+)/);
    if (!shareMatch) return null;
    const share = shareMatch[1].toLowerCase().replace(/\/$/, '');

    for (const line of stdout.split('\n')) {
      // 格式: //user@host/ShareName on /Volumes/xxx (smbfs, ...)
      if (!line.includes('(smbfs')) continue;
      const mountMatch = line.match(/^(.+?) on (.+?) \(/);
      if (!mountMatch) continue;
      const mountedUrl = mountMatch[1].toLowerCase();
      const mountedPath = mountMatch[2];
      // 只匹配 share 名称（host 可能是 IP 或 mDNS 名称，不做强匹配）
      if (mountedUrl.endsWith('/' + share)) {
        console.log(`[MountHelper] Found existing system mount for share '${share}': ${mountedPath}`);
        return mountedPath;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 挂载 NAS 存储到本地路径
 * 如果已挂载则直接返回挂载路径
 */
export async function mountNas(config: StorageConfig): Promise<MountResult> {
  const providerId = config.id;

  try {
    if (process.platform === 'win32') {
      // Windows: net use
      try {
        const drivePath = await mountWindows(config);
        return { success: true, mountPath: drivePath, alreadyMounted: false };
      } catch (err) {
        return {
          success: false,
          mountPath: '',
          alreadyMounted: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    // macOS / Linux
    const mountPoint = getMountPoint(providerId);

    // 检查是否已挂载（我们自己的挂载点）
    if (isMounted(mountPoint)) {
      console.log(`[MountHelper] Already mounted: ${mountPoint}`);
      return { success: true, mountPath: mountPoint, alreadyMounted: true };
    }

    // macOS: 优先检查系统已有挂载（如通过 Finder 挂载的同一共享）
    if (process.platform === 'darwin') {
      const systemMount = await findExistingSystemMount(config);
      if (systemMount) {
        console.log(`[MountHelper] Found existing system mount: ${systemMount}`);
        return { success: true, mountPath: systemMount, alreadyMounted: true };
      }
    }

    // 如果目录存在但未挂载（可能是上次挂载失败的残留），先清理
    if (fs.existsSync(mountPoint)) {
      try {
        const entries = fs.readdirSync(mountPoint);
        if (entries.length === 0) {
          fs.rmdirSync(mountPoint);
          console.log(`[MountHelper] Cleaned up stale empty mount point: ${mountPoint}`);
        }
      } catch { /* ignore */ }
    }

    // 创建挂载点目录
    fs.mkdirSync(mountPoint, { recursive: true });

    if (process.platform === 'darwin') {
      await mountMacos(config, mountPoint);
    } else {
      await mountLinux(config, mountPoint);
    }

    console.log(`[MountHelper] Mounted ${config.url} → ${mountPoint}`);
    return { success: true, mountPath: mountPoint, alreadyMounted: false };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[MountHelper] Mount failed for '${providerId}': ${msg}`);

    // 挂载失败时清理空目录
    const mountPoint = getMountPoint(providerId);
    try {
      if (fs.existsSync(mountPoint)) {
        const entries = fs.readdirSync(mountPoint);
        if (entries.length === 0) fs.rmdirSync(mountPoint);
      }
    } catch { /* ignore */ }

    return { success: false, mountPath: '', alreadyMounted: false, error: msg };
  }
}

/**
 * 卸载 NAS 存储
 */
export async function unmountNas(config: StorageConfig): Promise<UnmountResult> {
  const providerId = config.id;

  try {
    if (process.platform === 'win32') {
      // Windows: net use /delete（根据 UNC 路径）
      const urlStr = config.url || '';
      const uncPath = urlStr.replace(/^smb:\/\//, '\\\\').replace(/\//g, '\\');
      try {
        await execFileAsync('net', ['use', uncPath, '/delete', '/yes'], { timeout: 10000 });
      } catch { /* 可能已经断开 */ }
      return { success: true };
    }

    const mountPoint = getMountPoint(providerId);
    if (!isMounted(mountPoint)) {
      return { success: true }; // 没挂载，当作成功
    }

    if (process.platform === 'darwin') {
      await execFileAsync('umount', [mountPoint], { timeout: 10000 });
    } else {
      await execFileAsync('umount', [mountPoint], { timeout: 10000 });
    }

    // 清理挂载点目录
    try { fs.rmdirSync(mountPoint); } catch { /* ignore */ }

    console.log(`[MountHelper] Unmounted: ${mountPoint}`);
    return { success: true };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[MountHelper] Unmount failed for '${providerId}': ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * 检查 NAS 是否已挂载，返回挂载路径（未挂载返回 null）
 */
export function getActiveMountPath(config: StorageConfig): string | null {
  if (process.platform === 'win32') return null; // Windows 暂不检测

  // 优先检查用户手动配置的 localMountPath
  if (config.localMountPath && isMounted(config.localMountPath)) {
    return config.localMountPath;
  }

  const mountPoint = getMountPoint(config.id);
  if (isMounted(mountPoint)) return mountPoint;

  return null;
}
