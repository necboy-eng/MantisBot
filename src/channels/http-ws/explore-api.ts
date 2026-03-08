import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import { workDirManager } from '../../workdir/manager.js';
import { getStorageManager, hasStorageManager } from '../../storage/manager.js';
import { StorageError } from '../../storage/storage.interface.js';
import { isSensitivePath, shouldHideItem } from '../../security/path-guard.js';

// 判断是否应走 StorageManager：NAS 类型存储时，即使是绝对路径也走 StorageManager
function shouldUseStorageManager(): boolean {
  if (!hasStorageManager()) return false;
  try {
    getStorageManager().getCurrentStorage();
    return true;
  } catch {
    return false;
  }
}

const router = express.Router();

// 安全检查：防止路径遍历攻击（支持完全访问模式）
function isPathSafe(_basePath: string, userPath: string): boolean {
  // 用户选择了完全访问模式，允许访问任何路径
  // 但仍然检查路径遍历攻击 (../)
  try {
    const resolved = path.resolve(userPath);
    // 检查路径是否包含��效的遍历
    return !resolved.includes('..');
  } catch {
    return false;
  }
}

// 解析用户路径
function resolveUserPath(basePath: string, userPath: string): string {
  // 如果是绝对路径，直接使用
  if (path.isAbsolute(userPath)) {
    return path.resolve(userPath);
  }
  // 相对路径，基于 basePath 解析
  return path.resolve(basePath, userPath);
}

// 检查路径是否敏感并返回标准化结果
// 返回 null 表示路径安全，返回 string 表示错误消息
function checkSensitivePathAccess(targetPath: string, baseDir: string): string | null {
  const resolvedPath = path.isAbsolute(targetPath) ? targetPath : resolveUserPath(baseDir, targetPath);
  if (isSensitivePath(resolvedPath)) {
    return 'Access to this path is restricted';
  }
  return null;
}

// 获取用户主目录（NAS 模式下返回 '/'）
router.get('/api/explore/home', (_req, res) => {
  try {
    // NAS 模式：当前存储是 NAS 时，初始路径应为 NAS 根目录而非本地 home
    if (shouldUseStorageManager()) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({ home: '/', platform: process.platform });
    }
    const homeDir = os.homedir();
    res.json({
      home: homeDir,
      platform: process.platform
    });
  } catch (error) {
    console.error('Explore home error:', error);
    res.status(500).json({ error: 'Failed to get home directory' });
  }
});

// 列出目录内容
router.get('/api/explore/list', async (req, res) => {
  const { path: targetPath } = req.query;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查是否尝试访问敏感目录
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    const useStorageManager = shouldUseStorageManager();

    if (useStorageManager) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      // NAS 使用相对路径（去掉前导斜杠），本地存储使用绝对路径
      let storagePath: string;
      if (storage.type === 'nas') {
        // 将前端传来的任意路径规范为 NAS 相对路径
        // '/' 或 '' → '' (根目录)；'/foo/bar' → 'foo/bar'
        storagePath = targetPath.replace(/^\/+/, '');
      } else {
        storagePath = path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath);
      }

      const items = await storage.listDirectory(storagePath);
      console.log(`[explore/list] storage.type=${storage.type} storagePath="${storagePath}" raw items(${items.length}):`, items.map(i => i.name));
      // NAS 返回带 / 前缀的路径供前端显示；本地返回绝对路径
      const currentDisplayPath = storage.type === 'nas'
        ? '/' + storagePath
        : (path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath));
      const result = items
        .filter(item => {
          if (item.name.startsWith('.')) {
            console.log(`[explore/list] filtered (hidden): "${item.name}"`);
            return false;
          }
          return true;
        })
        // NAS 存储时不做本地敏感路径过滤（NAS 路径与本地系统路径无关）
        .filter(item => {
          if (storage.type !== 'nas' && shouldHideItem(currentDisplayPath, item.name)) {
            console.log(`[explore/list] filtered (sensitive): "${item.name}" at "${currentDisplayPath}"`);
            return false;
          }
          return true;
        })
        .map(item => ({
          name: item.name,
          type: item.type,
          // NAS：路径使用 /相对路径 格式；本地：绝对路径
          path: storage.type === 'nas' ? '/' + item.path.replace(/^\/+/, '') : path.join(baseDir, item.path),
          size: item.size,
          modified: item.modified.toISOString(),
          ext: item.type === 'file' ? path.extname(item.name).toLowerCase() : undefined,
          mimeType: item.mimeType
        }));

      console.log(`[explore/list] returning ${result.length} items:`, result.map(i => i.name));
      // NAS 内容是远程动态数据，禁用缓存
      if (storage.type === 'nas') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
      return res.json({ items: result, currentPath: currentDisplayPath });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    const result = items
      .filter(item => !item.name.startsWith('.')) // 过滤隐藏文件
      .filter(item => !shouldHideItem(fullPath, item.name)) // 过滤敏感目录
      .map(item => {
      const itemPath = path.join(fullPath, item.name);
      let size: number | undefined;
      let modified: string | undefined;
      let ext: string | undefined;

      try {
        const stats = fs.statSync(itemPath);
        size = stats.size;
        modified = stats.mtime.toISOString();
        if (!item.isDirectory()) {
          ext = path.extname(item.name).toLowerCase();
        }
      } catch {
        // 忽略无法访问的文件
      }

      return {
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: itemPath,
        size,
        modified,
        ext
      };
    });

    res.json({ items: result, currentPath: fullPath });
  } catch (error) {
    console.error('Explore list error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// 读取文件内容（文本）
router.get('/api/explore/read', async (req, res) => {
  const { path: targetPath } = req.query;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    const useStorageManager = shouldUseStorageManager();

    if (useStorageManager) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const storagePath = (storage.type === 'nas' && path.isAbsolute(targetPath))
        ? path.relative(baseDir, targetPath)
        : targetPath;

      const stats = await storage.getStats(storagePath);

      // 如果是目录，返回错误
      if (stats.isDirectory) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }

      // 限制文件大小 10MB
      if (stats.size > 10 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large' });
      }

      const contentBuffer = await storage.readFile(storagePath);
      const content = contentBuffer.toString('utf-8');
      const ext = path.extname(storagePath).toLowerCase();

      return res.json({
        content,
        size: stats.size,
        ext,
        path: path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath)
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);

    // 如果是目录，返回错误
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory' });
    }

    // 限制文件大小 10MB
    if (stats.size > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large' });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();

    res.json({
      content,
      size: stats.size,
      ext,
      path: fullPath
    });
  } catch (error) {
    console.error('Explore read error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 读取二进制文件（用于图片等）
router.get('/api/explore/binary', async (req, res) => {
  const { path: targetPath } = req.query;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径（data/uploads/ 已在白名单中，允许访问）
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  // 对于 data/uploads/ 路径，直接使用项目目录下的 data 文件夹
  // 这是因为附件存储在项目的 data/uploads/ 目录中
  let resolvedFilePath: string | null = null;
  if (targetPath.startsWith('data/uploads/') || targetPath.startsWith('data\\uploads\\')) {
    // 直接解析为项目目录下的绝对路径
    const projectRoot = path.resolve('.');
    resolvedFilePath = path.join(projectRoot, targetPath);
  }

  try {
    // 对于 data/uploads/ 路径，直接使用文件系统读取
    // 因为这是项目的附件目录，不需要经过存储管理器
    if (resolvedFilePath) {
      if (!fs.existsSync(resolvedFilePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stats = fs.statSync(resolvedFilePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }

      if (stats.size > 50 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large' });
      }

      const content = fs.readFileSync(resolvedFilePath);
      const ext = path.extname(resolvedFilePath).toLowerCase();

      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      return res.send(content);
    }

    // 对于绝对路径，直接使用本地文件系统
    const useStorageManager = shouldUseStorageManager();

    if (useStorageManager) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const storagePath = (storage.type === 'nas' && path.isAbsolute(targetPath))
        ? path.relative(baseDir, targetPath)
        : targetPath;

      const stats = await storage.getStats(storagePath);

      // 如果是目录，返回错误
      if (stats.isDirectory) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }

      // 限制文件大小 50MB
      if (stats.size > 50 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large' });
      }

      const content = await storage.readFile(storagePath);
      const ext = path.extname(storagePath).toLowerCase();

      // MIME 类型映射
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        // Office 文件类型
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      return res.send(content);
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);

    // 如果是目录，返回错误
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory' });
    }

    // 限制文件大小 50MB
    if (stats.size > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large' });
    }

    const content = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    // MIME 类型映射
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      // Office 文件类型
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.send(content);
  } catch (error) {
    console.error('Explore binary error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 获取文件信息
router.get('/api/explore/stat', async (req, res) => {
  const { path: targetPath } = req.query;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    // 对于绝对路径，直接使用本地文件系统
    const useStorageManager = shouldUseStorageManager();

    if (useStorageManager) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const storagePath = (storage.type === 'nas' && path.isAbsolute(targetPath))
        ? path.relative(baseDir, targetPath)
        : targetPath;

      const exists = await storage.exists(storagePath);
      if (!exists) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stats = await storage.getStats(storagePath);
      const ext = path.extname(storagePath).toLowerCase();

      return res.json({
        path: path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath),
        name: path.basename(storagePath),
        size: stats.size,
        isDirectory: stats.isDirectory,
        modified: stats.modified,
        created: stats.created,
        ext
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    res.json({
      path: fullPath,
      name: path.basename(fullPath),
      size: stats.size,
      isDirectory: stats.isDirectory(),
      modified: stats.mtime,
      ext
    });
  } catch (error) {
    console.error('Explore stat error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// 文件上传到指定目录
router.post('/api/explore/upload', async (req, res) => {
  const { path: targetDir, filename, content } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetDir || !filename || !content) {
    return res.status(400).json({ error: 'path, filename and content are required' });
  }

  if (!isPathSafe(baseDir, targetDir)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetDir, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    // 如果有存储管理器，使用存储管理器
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const relativePath = path.isAbsolute(targetDir)
        ? path.relative(baseDir, targetDir)
        : targetDir;

      // 检查目标是否存在且是目录
      const dirExists = await storage.exists(relativePath);
      if (!dirExists) {
        return res.status(404).json({ error: 'Directory not found' });
      }

      const dirStats = await storage.getStats(relativePath);
      if (!dirStats.isDirectory) {
        return res.status(400).json({ error: 'Target path is not a directory' });
      }

      // 写入文件
      const filePath = path.join(relativePath, filename).replace(/\\/g, '/');
      const buffer = Buffer.from(content, 'base64');
      await storage.writeFile(filePath, buffer);

      return res.status(201).json({
        success: true,
        path: path.join(baseDir, filePath),
        name: filename,
        size: buffer.length
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetDir);

    // 检查目标是否是目录
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Target path is not a directory' });
    }

    // 写入文件
    const filePath = path.join(fullPath, filename);
    const buffer = Buffer.from(content, 'base64');
    fs.writeFileSync(filePath, buffer);

    res.status(201).json({
      success: true,
      path: filePath,
      name: filename,
      size: buffer.length
    });
  } catch (error) {
    console.error('Explore upload error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// 创建新文件夹
router.post('/api/explore/mkdir', async (req, res) => {
  const { path: targetDir, name } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetDir || !name) {
    return res.status(400).json({ error: 'path and name are required' });
  }

  if (!isPathSafe(baseDir, targetDir)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetDir, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    // 如果有存储管理器，使用存储管理器
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const relativePath = path.isAbsolute(targetDir)
        ? path.relative(baseDir, targetDir)
        : targetDir;

      const exists = await storage.exists(relativePath);
      if (!exists) {
        return res.status(404).json({ error: 'Directory not found' });
      }

      const newDirPath = path.join(relativePath, name).replace(/\\/g, '/');
      const newDirExists = await storage.exists(newDirPath);
      if (newDirExists) {
        return res.status(409).json({ error: 'Directory already exists' });
      }

      await storage.createDirectory(newDirPath);

      return res.status(201).json({
        success: true,
        path: path.join(baseDir, newDirPath),
        name
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetDir);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const newDirPath = path.join(fullPath, name);
    if (fs.existsSync(newDirPath)) {
      return res.status(409).json({ error: 'Directory already exists' });
    }

    fs.mkdirSync(newDirPath, { recursive: true });

    res.status(201).json({
      success: true,
      path: newDirPath,
      name
    });
  } catch (error) {
    console.error('Explore mkdir error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// 删除文件或文件夹
router.post('/api/explore/delete', async (req, res) => {
  const { path: targetPath } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    // 如果有存储管理器，使用存储管理器
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const relativePath = path.isAbsolute(targetPath)
        ? path.relative(baseDir, targetPath)
        : targetPath;

      const exists = await storage.exists(relativePath);
      if (!exists) {
        return res.status(404).json({ error: 'File or directory not found' });
      }

      const stats = await storage.getStats(relativePath);
      if (stats.isDirectory) {
        await storage.deleteDirectory(relativePath);
      } else {
        await storage.deleteFile(relativePath);
      }

      return res.json({
        success: true,
        path: path.join(baseDir, relativePath)
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File or directory not found' });
    }

    // 使用 fs.rmSync 支持递归删除文件夹
    fs.rmSync(fullPath, { recursive: true, force: true });

    res.json({
      success: true,
      path: fullPath
    });
  } catch (error) {
    console.error('Explore delete error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({
      error: 'Failed to delete: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
});

// 复制到剪贴板（仅验证和返回信息）
router.post('/api/explore/copy', async (req, res) => {
  const { source } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'source is required' });
  }

  if (!isPathSafe(baseDir, source)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(source, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  try {
    // NAS 存储时也走 StorageManager 验证文件存在
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const storagePath = (storage.type === 'nas' && path.isAbsolute(source))
        ? path.relative(baseDir, source)
        : source;

      const exists = await storage.exists(storagePath);
      if (!exists) {
        return res.status(404).json({ error: 'File or directory not found' });
      }

      const stats = await storage.getStats(storagePath);
      return res.json({
        success: true,
        source,
        type: stats.isDirectory ? 'directory' : 'file'
      });
    }

    const fullPath = resolveUserPath(baseDir, source);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File or directory not found' });
    }

    const stats = fs.statSync(fullPath);

    res.json({
      success: true,
      source: fullPath,
      type: stats.isDirectory() ? 'directory' : 'file'
    });
  } catch (error) {
    console.error('Explore copy error:', error);
    res.status(500).json({
      error: 'Failed to copy: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
});

// 执行文件复制（实际复制文件）
router.post('/api/explore/paste', async (req, res) => {
  const { source, targetDir } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!source || !targetDir || typeof source !== 'string' || typeof targetDir !== 'string') {
    return res.status(400).json({ error: 'source and targetDir are required' });
  }

  if (!isPathSafe(baseDir, source) || !isPathSafe(baseDir, targetDir)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sourceError = checkSensitivePathAccess(source, baseDir);
  if (sourceError) {
    return res.status(403).json({ error: sourceError });
  }
  const targetError = checkSensitivePathAccess(targetDir, baseDir);
  if (targetError) {
    return res.status(403).json({ error: targetError });
  }

  try {
    // 如果有存储管理器，使用存储管理器
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const sourceRelative = path.isAbsolute(source)
        ? path.relative(baseDir, source)
        : source;
      const targetRelative = path.isAbsolute(targetDir)
        ? path.relative(baseDir, targetDir)
        : targetDir;

      // 检查源文件/文件夹是否存在
      const sourceExists = await storage.exists(sourceRelative);
      if (!sourceExists) {
        return res.status(404).json({ error: 'Source file or directory not found' });
      }

      // 检查目标目录是否存在
      const targetExists = await storage.exists(targetRelative);
      if (!targetExists) {
        return res.status(404).json({ error: 'Target directory not found' });
      }

      const targetStats = await storage.getStats(targetRelative);
      if (!targetStats.isDirectory) {
        return res.status(400).json({ error: 'Target path is not a directory' });
      }

      // 获取源文件/文件夹名称
      const sourceName = path.basename(sourceRelative);
      const destinationPath = path.join(targetRelative, sourceName).replace(/\\/g, '/');

      // 检查目标路径是否已存在
      const destExists = await storage.exists(destinationPath);
      if (destExists) {
        return res.status(409).json({ error: 'File or directory already exists in target location' });
      }

      // 执行复制
      await storage.copyFile(sourceRelative, destinationPath);

      return res.json({
        success: true,
        source: path.join(baseDir, sourceRelative),
        destination: path.join(baseDir, destinationPath)
      });
    }

    // 回退到原有的本地文件系统操作
    const sourcePath = resolveUserPath(baseDir, source);
    const targetPath = resolveUserPath(baseDir, targetDir);

    // 检查源文件/文件夹是否存在
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source file or directory not found' });
    }

    // ���查目标目录是否存在
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Target directory not found' });
    }

    const targetStats = fs.statSync(targetPath);
    if (!targetStats.isDirectory()) {
      return res.status(400).json({ error: 'Target path is not a directory' });
    }

    // 获取源文件/文件夹名称
    const sourceName = path.basename(sourcePath);
    const destinationPath = path.join(targetPath, sourceName);

    // 检查目标路径是否已存在
    if (fs.existsSync(destinationPath)) {
      return res.status(409).json({ error: 'File or directory already exists in target location' });
    }

    // 执行复制
    const copyRecursive = (src: string, dest: string) => {
      const stats = fs.statSync(src);
      if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          copyRecursive(
            path.join(src, entry.name),
            path.join(dest, entry.name)
          );
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    };

    copyRecursive(sourcePath, destinationPath);

    res.json({
      success: true,
      source: sourcePath,
      destination: destinationPath
    });
  } catch (error) {
    console.error('Explore paste error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({
      error: 'Failed to paste: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
});

// 重命名文件或文件夹
router.post('/api/explore/rename', async (req, res) => {
  const { path: targetPath, newName } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!targetPath || !newName || typeof targetPath !== 'string' || typeof newName !== 'string') {
    return res.status(400).json({ error: 'path and newName are required' });
  }

  if (!isPathSafe(baseDir, targetPath)) {
    return res.status(403).json({ error: 'Path traversal detected' });
  }

  // 检查敏感路径
  const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
  if (sensitiveError) {
    return res.status(403).json({ error: sensitiveError });
  }

  // 检查新名称是否包含非法字符
  if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  try {
    // 如果有存储管理器，使用存储管理器
    if (shouldUseStorageManager()) {
      const storageManager = getStorageManager();
      const storage = storageManager.getCurrentStorage();

      const relativePath = path.isAbsolute(targetPath)
        ? path.relative(baseDir, targetPath)
        : targetPath;

      const exists = await storage.exists(relativePath);
      if (!exists) {
        return res.status(404).json({ error: 'File or directory not found' });
      }

      // 构建新路径
      const parentDir = path.dirname(relativePath);
      const newPath = path.join(parentDir, newName).replace(/\\/g, '/');

      // 检查新名称是否已存在
      const newExists = await storage.exists(newPath);
      if (newExists) {
        return res.status(409).json({ error: 'File or directory already exists' });
      }

      // 执行重命名
      await storage.renameFile(relativePath, newPath);

      return res.json({
        success: true,
        oldPath: path.join(baseDir, relativePath),
        newPath: path.join(baseDir, newPath)
      });
    }

    // 回退到原有的本地文件系统操作
    const fullPath = resolveUserPath(baseDir, targetPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File or directory not found' });
    }

    // 构建新路径
    const parentDir = path.dirname(fullPath);
    const newPath = path.join(parentDir, newName);

    // 检查新名称是否已存在
    if (fs.existsSync(newPath)) {
      return res.status(409).json({ error: 'File or directory already exists' });
    }

    // 执行重命名
    fs.renameSync(fullPath, newPath);

    res.json({
      success: true,
      oldPath: fullPath,
      newPath: newPath
    });
  } catch (error) {
    console.error('Explore rename error:', error);
    if (error instanceof StorageError) {
      return res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({
        error: error.message
      });
    }
    res.status(500).json({
      error: 'Failed to rename: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
});

// 批量下载文件（打包成 zip）
router.post('/api/explore/download-zip', async (req, res) => {
  const { paths } = req.body;
  const baseDir = workDirManager.getCurrentWorkDir();

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths array is required' });
  }

  // 验证所有路径
  for (const targetPath of paths) {
    if (!isPathSafe(baseDir, targetPath)) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }
    const sensitiveError = checkSensitivePathAccess(targetPath, baseDir);
    if (sensitiveError) {
      return res.status(403).json({ error: sensitiveError });
    }
  }

  try {
    // 设置响应头
    const zipFilename = `files_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);

    // 创建 archiver 实例
    const archive = archiver('zip', {
      zlib: { level: 6 } // 压缩级别
    });

    // 监听错误
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip file' });
      }
    });

    // 监听警告
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning:', err);
      } else {
        throw err;
      }
    });

    // 将 archive 输出到响应
    archive.pipe(res);

    // 添加文件到 archive
    let totalSize = 0;
    const fileInfos: { path: string; name: string; size: number }[] = [];

    for (const targetPath of paths) {
      // NAS 存储时也走 StorageManager
      const useStorageManager = shouldUseStorageManager();

      if (useStorageManager) {
        const storageManager = getStorageManager();
        const storage = storageManager.getCurrentStorage();

        const relativePath = (storage.type === 'nas' && path.isAbsolute(targetPath))
          ? path.relative(baseDir, targetPath)
          : (path.isAbsolute(targetPath) ? path.relative(baseDir, targetPath) : targetPath);

        const exists = await storage.exists(relativePath);
        if (!exists) {
          continue; // 跳过不存在的文件
        }

        const stats = await storage.getStats(relativePath);
        if (stats.isDirectory) {
          continue; // 跳过目录
        }

        const content = await storage.readFile(relativePath);
        const name = path.basename(targetPath);
        archive.append(content, { name });
        totalSize += content.length;
        fileInfos.push({ path: targetPath, name, size: content.length });
      } else {
        const fullPath = resolveUserPath(baseDir, targetPath);

        if (!fs.existsSync(fullPath)) {
          continue; // 跳过不存在的文件
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          continue; // 跳过目录
        }

        const name = path.basename(fullPath);
        archive.file(fullPath, { name });
        totalSize += stats.size;
        fileInfos.push({ path: targetPath, name, size: stats.size });
      }
    }

    // 如果没有有效文件，返回错误
    if (fileInfos.length === 0) {
      archive.finalize();
      return res.status(400).json({ error: 'No valid files to download' });
    }

    // 返回原始文件总大小，供前端计算进度参考
    // 注意：zip 大小难以精确预估，不设置 Content-Length，使用 chunked encoding
    res.setHeader('X-Total-Size', totalSize.toString());
    res.removeHeader('Content-Length');

    // 完成打包
    await archive.finalize();

  } catch (error) {
    console.error('Download zip error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to download: ' + (error instanceof Error ? error.message : 'Unknown error')
      });
    }
  }
});

export default router;
