import { useState, useEffect, useRef, useCallback } from 'react';
import { FileItem } from './PreviewPane';
import { StorageSelector } from './StorageSelector';
import { authFetch, appendTokenToUrl, getAuthToken } from '../utils/auth';
import { usePermission } from '../hooks/usePermission';
import { PathAclDialog } from './PathAclDialog';
import { createPortal } from 'react-dom';

type ViewMode = 'icons' | 'list' | 'columns';
type SortField = 'name' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';
type UploadTaskStatus = 'pending' | 'uploading' | 'done' | 'error';

interface UploadTask {
  id: string;
  fileName: string;
  progress: number;
  status: UploadTaskStatus;
  error?: string;
}

interface FileManagerProps {
  onFileSelect: (file: FileItem) => void;
  onSwitchToPreview?: () => void;
  initialPath?: string;
  onPathChange?: (path: string) => void;
  officePreviewServer?: string;  // Office 预览服务器地址
  serverUrl?: string;            // 当前服务器地址
  // 新增：添加文件引用回调
  onAddReference?: (item: FileSystemItem) => void;
  // 新增：权限错误回调
  onPermissionError?: (path: string, onSuccess: () => void) => void;
  // 新增：存储模式切换回调（true = NAS 模式，false = 本地模式）
  onStorageModeChange?: (isNas: boolean) => void;
}

interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  ext?: string;
  storageId?: string;  // 当前存储提供者 ID（NAS 时有值，本地时为 undefined）
  aclPermission?: 'read' | 'write' | 'deny' | null;  // 该路径的 ACL 权限类型（null = 无规则）
}

// 格式化文件大小
function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

// 格式化日期
function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 获取文件图标
function getFileIcon(item: FileSystemItem): string {
  if (item.type === 'directory') return '📁';

  const ext = item.ext?.toLowerCase().replace('.', '') || '';
  const iconMap: Record<string, string> = {
    // 图片
    'png': '🖼', 'jpg': '🖼️', 'jpeg': '🖼', 'gif': '🖼', 'svg': '🖼', 'webp': '🖼',
    // 文档
    'pdf': '📄', 'doc': '📝', 'docx': '📝', 'txt': '📃', 'md': '📝',
    'xls': '📊', 'xlsx': '📊', 'csv': '📊',
    'ppt': '📽', 'pptx': '📽',
    // 代码
    'js': '📜', 'ts': '📜', 'jsx': '⚛', 'tsx': '⚛',
    'html': '🌐', 'css': '🎨', 'json': '📋',
    'py': '🐍', 'go': '🐹', 'rs': '🦀',
    // 压缩包
    'zip': '📦', 'tar': '📦', 'gz': '📦',
    // 音视频
    'mp3': '🎵', 'mp4': '🎬', 'mov': '🎬',
  };

  return iconMap[ext] || '📄';
}

// 根据 ACL 权限类型返回对应徽标
function AclBadge({ permission, overlay = false }: { permission?: 'read' | 'write' | 'deny' | null; overlay?: boolean }) {
  if (!permission) return null;
  const cfg = {
    read:  { icon: '🔏', title: '只读权限' },
    write: { icon: '🔓', title: '读写权限' },
    deny:  { icon: '🔐', title: '禁止访问' },
  }[permission];
  if (overlay) {
    return (
      <span className="absolute -bottom-1 -right-1 text-xs leading-none" title={cfg.title}>
        {cfg.icon}
      </span>
    );
  }
  return (
    <span className="ml-1.5 text-xs flex-shrink-0" title={cfg.title}>
      {cfg.icon}
    </span>
  );
}

export function FileManager({
  onFileSelect,
  onSwitchToPreview,
  initialPath = '/',
  onPathChange,
  officePreviewServer,
  serverUrl,
  onAddReference,
  onStorageModeChange,
}: FileManagerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');  // 默认使用列表视图
  const [currentPath, setCurrentPath] = useState(initialPath);  // 使用 initialPath 初始化
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FileSystemItem | null>(null);
  const [columns, setColumns] = useState<string[]>(['/']);
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showStorageSelector, setShowStorageSelector] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  // 当前活跃的存储提供者 ID（null = 本地文件系统，有值 = NAS）
  const [currentStorageId, setCurrentStorageId] = useState<string | null>(null);
  // 当前 NAS 的本地挂载路径（自动挂载或手动配置的 localMountPath）
  const [currentMountPath, setCurrentMountPath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  // 权限：是否有用户管理权限（用于显示「设置权限」菜单项）
  const canManage = usePermission('manageUsers');
  // 路径 ACL 对话框目标
  const [aclTarget, setAclTarget] = useState<{ path: string; storageId: string } | null>(null);
  // 请求版本号：切换存储时递增，让旧的 in-flight 请求响应被丢弃
  const loadGenerationRef = useRef(0);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: FileSystemItem | null;
  }>({ visible: false, x: 0, y: 0, item: null });

  // 剪贴板状态
  const [clipboard, setClipboard] = useState<{
    path: string;
    type: 'file' | 'directory';
    operation: 'copy';
  } | null>(null);

  // 删除对话框状态
  const [deleteDialog, setDeleteDialog] = useState<{
    visible: boolean;
    item: FileSystemItem | null;
    step: 'confirm' | 'input';
    inputValue: string;
  }>({ visible: false, item: null, step: 'confirm', inputValue: '' });

  // 重命名对话框状态
  const [renameDialog, setRenameDialog] = useState<{
    visible: boolean;
    item: FileSystemItem | null;
    newName: string;
  }>({ visible: false, item: null, newName: '' });

  // Toast 提示状态
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error';
  }>({ visible: false, message: '', type: 'success' });

  // 多选状态
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // 下载状态
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);

  // 加载目录
  const loadDirectory = useCallback(async (dirPath: string) => {
    const generation = loadGenerationRef.current;
    setLoading(true);
    try {
      const res = await authFetch(`/api/explore/list?path=${encodeURIComponent(dirPath)}`);

      // 如果在请求飞行期间存储已切换，丢弃此响应
      if (loadGenerationRef.current !== generation) return;

      // 检查是否有权限错误
      if (res.status === 403) {
        // 不更新路径、不触发 onPathChange，直接提示无权限
        setToast({ visible: true, message: `无权限访问：${dirPath}`, type: 'error' });
        setTimeout(() => setToast({ visible: false, message: '', type: 'success' }), 3000);
        return;
      }

      const data = await res.json();

      // 再次检查（res.json() 也是异步的，期间 generation 可能已改变）
      if (loadGenerationRef.current !== generation) return;

      setItems(data.items || []);
      const newPath = data.currentPath || dirPath;
      setCurrentPath(newPath);

      // 通知父组件路径变化
      onPathChange?.(newPath);

      if (dirPath !== history[historyIndex]) {
        const newHistory = [...history.slice(0, historyIndex + 1), dirPath];
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      // 只有当前 generation 的请求才清除 loading 状态
      if (loadGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [history, historyIndex, onPathChange]);

  // 初始加载 - 当 initialPath 变化时重新加载
  useEffect(() => {
    if (initialPath && initialPath !== '/') {
      loadDirectory(initialPath);
      setCurrentPath(initialPath);
    }
    // 初始化时从后端恢复当前存储状态（包括挂载路径）
    authFetch('/api/storage/current').then(async res => {
      if (!res.ok) return;
      const data = await res.json();
      if (data.id !== '__local__' && data.localMountPath) {
        setCurrentStorageId(data.id);
        setCurrentMountPath(data.localMountPath);
        onStorageModeChange?.(true);
      }
    }).catch(() => { /* ignore */ });
  }, [initialPath]);

  // 导航到目录
  const navigateTo = (path: string) => {
    loadDirectory(path);
    setSelectedItem(null);
  };

  // 返回上一级
  const goUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parentPath);
  };

  // 后退
  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      loadDirectory(history[historyIndex - 1]);
    }
  };

  // 前进
  const goForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      loadDirectory(history[historyIndex + 1]);
    }
  };

  // 双击打开
  const handleDoubleClick = async (item: FileSystemItem) => {
    if (item.type === 'directory') {
      navigateTo(item.path);
    } else {
      // 先检查文件读权限（stat 请求）
      const statRes = await authFetch(`/api/explore/stat?path=${encodeURIComponent(item.path)}`);
      if (statRes.status === 403) {
        setToast({ visible: true, message: `无权限访问：${item.name}`, type: 'error' });
        setTimeout(() => setToast({ visible: false, message: '', type: 'success' }), 3000);
        return;
      }

      // 判断是否为 Office 文件
      const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
      const ext = item.ext?.toLowerCase().replace('.', '') || '';

      if (officeExtensions.includes(ext) && officePreviewServer) {
        // Office 文件：使用预览服务器
        // 构建文件 URL
        const fileUrl = appendTokenToUrl(`${serverUrl}/api/explore/binary?path=${item.path}`);

        // 配置了 officePreviewServer 时直连，无需经过 /office-preview 代理
        const previewUrl = `${officePreviewServer}/#/?url=${encodeURIComponent(fileUrl)}`;

        window.open(previewUrl, '_blank');
      } else {
        // 其他文件：使用默认预览
        onFileSelect({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
          ext: item.ext
        });
        onSwitchToPreview?.();
      }
    }
  };

  // 单击选择
  const handleClick = (item: FileSystemItem) => {
    setSelectedItem(item);
  };

  // 单文件 multipart 上传（带进度）
  const uploadSingleFile = (file: File, taskId: string, path: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', path);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadTasks(prev =>
            prev.map(t => t.id === taskId ? { ...t, progress: percent } : t)
          );
        }
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          setUploadTasks(prev =>
            prev.map(t => t.id === taskId ? { ...t, status: 'done', progress: 100 } : t)
          );
          resolve();
        } else {
          let errMsg = '上传失败';
          try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch { /* ignore */ }
          setUploadTasks(prev =>
            prev.map(t => t.id === taskId ? { ...t, status: 'error', error: errMsg } : t)
          );
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => {
        const errMsg = '网络错误';
        setUploadTasks(prev =>
          prev.map(t => t.id === taskId ? { ...t, status: 'error', error: errMsg } : t)
        );
        reject(new Error(errMsg));
      };

      xhr.open('POST', '/api/explore/upload-multipart');
      const token = getAuthToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  };

  // 批量上传（并发 3）
  const uploadFiles = async (files: FileList) => {
    const fileArray = Array.from(files);
    const uploadPath = currentPath;
    const tasks: UploadTask[] = fileArray.map((f, i) => ({
      id: `${f.name}-${Date.now()}-${i}`,
      fileName: f.name,
      progress: 0,
      status: 'pending' as UploadTaskStatus,
    }));
    setUploadTasks(tasks);

    const CONCURRENCY = 3;
    let index = 0;

    const runNext = async (): Promise<void> => {
      if (index >= fileArray.length) return;
      const i = index++;
      const task = tasks[i];
      setUploadTasks(prev =>
        prev.map(t => t.id === task.id ? { ...t, status: 'uploading' } : t)
      );
      try {
        await uploadSingleFile(fileArray[i], task.id, uploadPath);
      } catch (_) {
        // 错误已在 uploadSingleFile 中记录到 task state
      }
      await runNext();
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, fileArray.length) }, runNext)
    );

    // 刷新目录
    loadDirectory(uploadPath);
    // 3 秒后自动清空进度面板
    setTimeout(() => setUploadTasks([]), 3000);
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = ''; // 重置
    }
  };

  // 将 NAS 相对路径转换为本地挂载路径
  // 例：/upload/file.pdf + /Volumes/Download → /Volumes/Download/upload/file.pdf
  const toLocalPath = (nasPath: string): string => {
    console.log('[FileManager] toLocalPath', { nasPath, currentMountPath });
    if (!currentMountPath) return nasPath;
    const base = currentMountPath.replace(/\/$/, '');
    const rel = nasPath.startsWith('/') ? nasPath : '/' + nasPath;
    return base + rel;
  };

  // 处理存储切换
  const handleStorageChanged = (providerId: string, mountPath?: string) => {    // 使所有 in-flight 的旧请求失效，避免切换后被旧响应覆盖路径
    loadGenerationRef.current++;
    // 记录当前存储（__local__ 视为本地，NAS 保存 providerId）
    setCurrentStorageId(providerId === '__local__' ? null : providerId);
    // 保存本地挂载路径（切换到本地时清空）
    const newMountPath = providerId === '__local__' ? null : (mountPath ?? null);
    console.log('[FileManager] handleStorageChanged', { providerId, mountPath, newMountPath });
    setCurrentMountPath(newMountPath);
    // 立即重置 UI，不等待异步加载（先更新内部状态，再通知父组件，避免重渲染影响 loadDirectory 闭包）
    setCurrentPath('/');
    setItems([]);
    loadDirectory('/');
    onPathChange?.('/');
    // 通知父组件当前是否进入 NAS 模式（避免父组件把 NAS 相对路径当本地 workdir 同步）
    onStorageModeChange?.(providerId !== '__local__');
    showToast(`已切换到存储: ${providerId}`, 'success');
  };

  // 拖拽处理 - 使用计数器避免子元素触发 dragLeave
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current = 0;
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, item: FileSystemItem | null) => {
    e.preventDefault();
    e.stopPropagation();

    // 计算菜单位置，防止超出视口边界
    const menuWidth = 160; // 菜单最小宽度
    // 文件菜单约180px，空白菜单（无粘贴）约50px，（有粘贴）约100px
    const menuHeight = item ? 180 : (clipboard ? 100 : 50);
    const padding = 8; // 距离边缘的间距

    let x = e.clientX;
    let y = e.clientY;

    // 检查右侧边界
    if (x + menuWidth + padding > window.innerWidth) {
      x = window.innerWidth - menuWidth - padding;
    }

    // 检查底部边界
    if (y + menuHeight + padding > window.innerHeight) {
      y = window.innerHeight - menuHeight - padding;
    }

    // 确保不超出左侧和顶部
    x = Math.max(padding, x);
    y = Math.max(padding, y);

    setContextMenu({
      visible: true,
      x,
      y,
      item
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, item: null });
  };

  // 显示 Toast 提示
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ visible: true, message, type });
    setTimeout(() => {
      setToast({ visible: false, message: '', type: 'success' });
    }, 2000);
  };

  // 菜单��作处理
  const handleMenuAction = async (action: string) => {
    if (!contextMenu.item) {
      closeContextMenu();
      return;
    }

    const item = contextMenu.item;
    closeContextMenu();

    switch (action) {
      case 'open':
        handleDoubleClick(item);
        break;
      case 'copy':
        await handleCopy(item);
        break;
      case 'download':
        await handleDownload(item);
        break;
      case 'addToChat':
        onAddReference?.({ ...item, path: toLocalPath(item.path), storageId: currentStorageId ?? undefined });
        break;
      case 'delete':
        setDeleteDialog({ visible: true, item, step: 'confirm', inputValue: '' });
        break;
      case 'rename':
        setRenameDialog({ visible: true, item, newName: item.name });
        break;
    }
  };

  // 复制操作
  const handleCopy = async (item: FileSystemItem) => {
    try {
      const res = await authFetch('/api/explore/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.path })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '复制失败');
      }

      const data = await res.json();
      setClipboard({
        path: data.source,
        type: data.type,
        operation: 'copy'
      });

      showToast('已复制到剪贴板', 'success');
    } catch (error) {
      showToast('复制失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    }
  };

  // 删除操作
  const handleDelete = async () => {
    if (!deleteDialog.item) return;

    try {
      const res = await authFetch('/api/explore/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: deleteDialog.item.path })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }

      setDeleteDialog({ visible: false, item: null, step: 'confirm', inputValue: '' });
      loadDirectory(currentPath);
      showToast('删除成功', 'success');
    } catch (error) {
      showToast('删除失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    }
  };

  // 重命名操作
  const handleRename = async () => {
    if (!renameDialog.item || !renameDialog.newName.trim()) return;

    try {
      const res = await authFetch('/api/explore/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: renameDialog.item.path,
          newName: renameDialog.newName.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '重命名失败');
      }

      setRenameDialog({ visible: false, item: null, newName: '' });
      loadDirectory(currentPath);
      showToast('重命名成功', 'success');
    } catch (error) {
      showToast('重命名失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    }
  };

  // 切换单个文件选择
  const toggleItemSelection = (itemPath: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemPath)) {
        newSet.delete(itemPath);
      } else {
        newSet.add(itemPath);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    const sortedItems = sortItems(items);
    const filesOnly = sortedItems.filter(item => item.type === 'file');

    if (selectedItems.size === filesOnly.length) {
      // 已全选，取消全选
      setSelectedItems(new Set());
    } else {
      // 未全选，全选所有文件
      setSelectedItems(new Set(filesOnly.map(item => item.path)));
    }
  };

  // 清空选择
  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  // 下载文件（单文件或批量）
  const handleDownload = async (item?: FileSystemItem) => {
    const pathsToDownload = item
      ? [item.path]
      : Array.from(selectedItems);

    if (pathsToDownload.length === 0) {
      showToast('请先选择要下载的文件', 'error');
      return;
    }

    try {
      setDownloading(true);
      setDownloadProgress(0);
      setDownloadTotal(0);

      if (pathsToDownload.length === 1) {
        // 单文件直接下载
        const filePath = pathsToDownload[0];
        const res = await authFetch(`/api/explore/binary?path=${encodeURIComponent(filePath)}`);

        if (!res.ok) {
          throw new Error('下载失败');
        }

        const contentLength = res.headers.get('Content-Length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        setDownloadTotal(total);

        const reader = res.body?.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            setDownloadProgress(received);
          }
        }

        const blob = new Blob(chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'download';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // 多文件打包下载
        const res = await authFetch('/api/explore/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: pathsToDownload })
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '下载失败');
        }

        // 使用 X-Total-Size 获取原始文件总大小（zip 大小无法精确预估）
        const totalSizeHeader = res.headers.get('X-Total-Size');
        const total = totalSizeHeader ? parseInt(totalSizeHeader, 10) : 0;
        setDownloadTotal(total);

        const reader = res.body?.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            setDownloadProgress(received);
          }
        }

        const blob = new Blob(chunks, { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `files_${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        // 下载完成后清空选择
        clearSelection();
      }

      showToast('下载完成', 'success');
    } catch (error) {
      showToast('下载失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
      setDownloadTotal(0);
    }
  };

  // 粘贴操作
  const handlePaste = async () => {
    if (!clipboard) {
      showToast('剪贴板为空', 'error');
      return;
    }

    try {
      const res = await authFetch('/api/explore/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: clipboard.path,
          targetDir: currentPath
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '粘贴失败');
      }

      loadDirectory(currentPath);
      showToast('粘贴成功', 'success');
    } catch (error) {
      showToast('粘贴失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    }
  };

  // 创建新文件夹
  const createFolder = async () => {
    const name = prompt('请输入文件夹名称:');
    if (!name) return;

    try {
      const res = await authFetch('/api/explore/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, name })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '创建失败');
      }

      loadDirectory(currentPath);
    } catch (error) {
      alert('创建文件夹失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  // 排序函数
  const sortItems = (itemsToSort: FileSystemItem[]): FileSystemItem[] => {
    const sorted = [...itemsToSort].sort((a, b) => {
      // 文件夹始终排在前面
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name, 'zh-CN');
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'modified':
          comparison = new Date(a.modified || 0).getTime() - new Date(b.modified || 0).getTime();
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  };

  // 切换排序
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 渲染排序指示器
  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-3 h-3 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  // 渲染图标视图
  const renderIconsView = () => (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 p-4">
      {items.map((item, index) => (
        <div
          key={`${item.path}-${index}`}
          className={`flex flex-col items-center p-3 rounded-lg cursor-pointer transition-colors ${
            selectedItem?.path === item.path
              ? 'bg-primary-100 dark:bg-primary-900'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          onClick={() => handleClick(item)}
          onDoubleClick={() => handleDoubleClick(item)}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          <span className="text-3xl mb-1 relative">
            {getFileIcon(item)}
            <AclBadge permission={item.aclPermission} overlay />
          </span>
          <span className="text-xs text-center dark:text-white truncate w-full">{item.name}</span>
        </div>
      ))}
    </div>
  );

  // 渲染列表视图
  const renderListView = () => {
    const sortedItems = sortItems(items);
    const filesOnly = sortedItems.filter(item => item.type === 'file');
    const isAllSelected = filesOnly.length > 0 && selectedItems.size === filesOnly.length;
    const isPartialSelected = selectedItems.size > 0 && selectedItems.size < filesOnly.length;

    return (
      <div className="p-2">
        <div className="flex items-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
          {/* 全选复选框 */}
          <div className="w-8 flex items-center justify-center">
            <input
              type="checkbox"
              checked={isAllSelected}
              ref={el => {
                if (el) el.indeterminate = isPartialSelected;
              }}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div
            className="flex-1 flex items-center gap-1 cursor-pointer hover:text-primary-500 dark:hover:text-primary-400 select-none"
            onClick={() => toggleSort('name')}
          >
            名称
            {renderSortIndicator('name')}
          </div>
          <div
            className="w-24 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-primary-500 dark:hover:text-primary-400 select-none"
            onClick={() => toggleSort('size')}
          >
            大小
            {renderSortIndicator('size')}
          </div>
          <div
            className="w-40 text-right ml-4 flex items-center justify-end gap-1 cursor-pointer hover:text-primary-500 dark:hover:text-primary-400 select-none"
            onClick={() => toggleSort('modified')}
          >
            修改日期
            {renderSortIndicator('modified')}
          </div>
        </div>

        <div className="divide-y dark:divide-gray-700">
          {sortedItems.map((item, index) => (
            <div
              key={`${item.path}-${index}`}
              className={`flex items-center px-3 py-2 cursor-pointer transition-colors ${
                selectedItem?.path === item.path
                  ? 'bg-primary-100 dark:bg-primary-900'
                  : selectedItems.has(item.path)
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
              onClick={() => handleClick(item)}
              onDoubleClick={() => handleDoubleClick(item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
            >
              {/* 单个文件复选框 */}
              <div className="w-8 flex items-center justify-center">
                {item.type === 'file' && (
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.path)}
                    onChange={() => toggleItemSelection(item.path)}
                    className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
              <div className="flex items-center flex-1 min-w-0">
                <span className="text-xl mr-3">{getFileIcon(item)}</span>
                <span className="truncate dark:text-white">{item.name}</span>
                <AclBadge permission={item.aclPermission} />
              </div>
              <div className="w-24 text-right text-sm text-gray-500 dark:text-gray-400">
                {item.type === 'directory' ? '--' : formatSize(item.size)}
              </div>
              <div className="w-40 text-right text-sm text-gray-500 dark:text-gray-400 ml-4">
                {formatDate(item.modified)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 渲染分栏视图
  const renderColumnsView = () => (
    <div className="flex h-full overflow-x-auto">
      {columns.map((columnPath, columnIndex) => (
        <div
          key={columnPath}
          className="min-w-[200px] max-w-[300px] border-r dark:border-gray-700 overflow-y-auto"
        >
          <ColumnView
            path={columnPath}
            selectedPath={columns[columnIndex + 1]}
            onSelect={(item) => {
              const newColumns = columns.slice(0, columnIndex + 1);
              if (item.type === 'directory') {
                newColumns.push(item.path);
                setColumns(newColumns);
              } else {
                onFileSelect({
                  name: item.name,
                  path: item.path,
                  type: item.type,
                  size: item.size,
                  ext: item.ext
                });
              }
            }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <>
    <div className="flex flex-col h-full bg-white dark:bg-gray-800">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        {/* 后退/前进按钮 */}
        <button
          onClick={goBack}
          disabled={historyIndex === 0}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="后退"
        >
          <svg className="w-4 h-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="前进"
        >
          <svg className="w-4 h-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 上一级按钮 */}
        <button
          onClick={goUp}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="上一级"
        >
          <svg className="w-4 h-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {/* 路径栏 */}
        <div className="flex-1 flex items-center bg-white dark:bg-gray-800 border dark:border-gray-600 rounded px-2 py-1">
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigateTo(currentPath)}
            className="flex-1 text-sm bg-transparent dark:text-white outline-none"
          />
        </div>

        {/* 刷新按钮 */}
        <button
          onClick={() => loadDirectory(currentPath)}
          disabled={loading}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="刷新"
        >
          <svg className={`w-4 h-4 dark:text-white ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* 存储选择器按钮 */}
        <div className="relative">
          <button
            onClick={() => setShowStorageSelector(!showStorageSelector)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="存储选择器"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
            </svg>
            存储
            <svg className={`w-3 h-3 transition-transform ${showStorageSelector ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* 存储选择器下拉面板 */}
          {showStorageSelector && (
            <>
              {/* 遮罩层 - 点击关闭 */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowStorageSelector(false)}
              />
              {/* 下拉面板 */}
              <div className="absolute top-full left-0 mt-1 w-80 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-lg z-20 p-4">
                <StorageSelector
                  onStorageChanged={(providerId, mountPath) => {
                    handleStorageChanged(providerId, mountPath);
                    setShowStorageSelector(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* 上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadTasks.some(t => t.status === 'uploading')}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="上传文件"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          上传
        </button>

        {/* 新建文件夹 */}
        <button
          onClick={createFolder}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="新建文件夹"
        >
          <svg className="w-4 h-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </button>

        {/* 视图切换 */}
        <div className="flex items-center gap-1 border-l dark:border-gray-600 pl-2">
          <button
            onClick={() => setViewMode('icons')}
            className={`p-1.5 rounded ${viewMode === 'icons' ? 'bg-primary-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            title="图标视图"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            title="列表视图"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('columns')}
            className={`p-1.5 rounded ${viewMode === 'columns' ? 'bg-primary-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            title="分栏视图"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div
        ref={dropZoneRef}
        className={`flex-1 overflow-auto relative ${isDragging ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          // 只在空白区域（非文件项）触发
          if (e.target === e.currentTarget) {
            handleContextMenu(e, null);
          }
        }}
      >
        {/* 拖拽提示层 */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary-50/80 dark:bg-primary-900/40 z-10 pointer-events-none">
            <div className="flex flex-col items-center text-primary-600 dark:text-primary-400">
              <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-lg font-medium">拖放文件到此处上传</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full text-gray-400"
            onContextMenu={(e) => handleContextMenu(e, null)}
          >
            <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span>空文件夹</span>
            <span className="text-sm mt-1">拖放文件到此处上传</span>
          </div>
        ) : (
          <>
            {viewMode === 'icons' && renderIconsView()}
            {viewMode === 'list' && renderListView()}
            {viewMode === 'columns' && renderColumnsView()}
          </>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <span>{items.length} 个项目</span>
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-2">
            <span>已选择 {selectedItems.size} 个文件</span>
            <button
              onClick={() => handleDownload()}
              className="px-2 py-0.5 bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors"
            >
              批量下载
            </button>
            <button
              onClick={clearSelection}
              className="px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              取消选择
            </button>
          </div>
        )}
        {selectedItem && selectedItems.size === 0 && <span>已选择: {selectedItem.name}</span>}
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <>
          {/* 透明遮罩层,点击关闭菜单 */}
          <div
            className="fixed inset-0 z-20"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />

          {/* 菜单内容 */}
          <div
            className="fixed z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`
            }}
          >
            {contextMenu.item ? (
              <>
                {/* 文件/文件��菜单 */}
                <button
                  onClick={() => handleMenuAction('open')}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>📂</span>
                  <span>打开</span>
                </button>
                <button
                  onClick={() => handleMenuAction('copy')}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>📋</span>
                  <span>复制</span>
                </button>
                <button
                  onClick={() => handleMenuAction('addToChat')}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>💬</span>
                  <span>添加到对话</span>
                </button>
                {contextMenu.item?.type === 'file' && (
                  <button
                    onClick={() => handleMenuAction('download')}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                  >
                    <span>⬇️</span>
                    <span>下载</span>
                  </button>
                )}
                <button
                  onClick={() => handleMenuAction('rename')}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>✏️</span>
                  <span>重命名</span>
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                <button
                  onClick={() => handleMenuAction('delete')}
                  className="w-full px-4 py-2 text-left hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 text-red-600 dark:text-red-400"
                >
                  <span>🗑️</span>
                  <span>删除</span>
                </button>
                {canManage && contextMenu.item && (
                  <>
                    <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                    <button
                      onClick={() => {
                        const item = contextMenu.item!;
                        closeContextMenu();
                        setAclTarget({
                          path: item.path,
                          storageId: currentStorageId ? currentStorageId : 'local',
                        });
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                    >
                      <span>🛡️</span>
                      <span>设置权限</span>
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                {/* 空白区域菜单 */}
                <button
                  onClick={() => {
                    closeContextMenu();
                    createFolder();
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>📁</span>
                  <span>新建文件夹</span>
                </button>
                {/* 新增：添加当前目录到对话 */}
                <button
                  onClick={() => {
                    closeContextMenu();
                    onAddReference?.({
                      name: currentPath.split('/').pop() || '/',
                      path: toLocalPath(currentPath),
                      type: 'directory',
                      storageId: currentStorageId ?? undefined
                    });
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                >
                  <span>💬</span>
                  <span>添加当前目录到对话</span>
                </button>
                {clipboard && (
                  <>
                    <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                    <button
                      onClick={() => {
                        closeContextMenu();
                        handlePaste();
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
                    >
                      <span>📄</span>
                      <span>粘贴</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* 删除确认对话框 */}
      {deleteDialog.visible && deleteDialog.item && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            {deleteDialog.step === 'confirm' ? (
              <>
                <h3 className="text-lg font-semibold mb-4 dark:text-white">
                  确定要删除 "{deleteDialog.item.name}" 吗？
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  {deleteDialog.item.type === 'directory'
                    ? '此文件夹及其所有内容将被永久删除。'
                    : '此文件将被永久删除。'}
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteDialog({ visible: false, item: null, step: 'confirm', inputValue: '' })}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => setDeleteDialog({ ...deleteDialog, step: 'input' })}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                  >
                    继续
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4 dark:text-white">
                  请输入 "{deleteDialog.item.name}" 以确认删除
                </h3>
                <input
                  type="text"
                  value={deleteDialog.inputValue}
                  onChange={(e) => setDeleteDialog({ ...deleteDialog, inputValue: e.target.value })}
                  placeholder="输入文件名"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteDialog({ visible: false, item: null, step: 'confirm', inputValue: '' })}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteDialog.inputValue !== deleteDialog.item?.name}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 重命名对话框 */}
      {renameDialog.visible && renameDialog.item && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">
              重命名 "{renameDialog.item.name}"
            </h3>
            <input
              type="text"
              value={renameDialog.newName}
              onChange={(e) => setRenameDialog({ ...renameDialog, newName: e.target.value })}
              placeholder="输入新名称"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRenameDialog({ visible: false, item: null, newName: '' })}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleRename}
                disabled={!renameDialog.newName.trim() || renameDialog.newName === renameDialog.item?.name}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 提示 */}
      {toast.visible && (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={`px-6 py-3 rounded-lg shadow-lg ${
              toast.type === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* 下载进度条模态框 */}
      {downloading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">
              正在下载...
            </h3>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
              <div
                className="bg-primary-500 h-full rounded-full transition-all duration-300"
                style={{
                  width: downloadTotal > 0
                    ? `${Math.min(100, (downloadProgress / downloadTotal) * 100)}%`
                    : '0%'
                }}
              />
            </div>
            <div className="flex justify-between mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{formatSize(downloadProgress)}</span>
              <span>{downloadTotal > 0 ? formatSize(downloadTotal) : '计算中...'}</span>
            </div>
            {downloadTotal > 0 && (
              <div className="text-center mt-2 text-sm text-gray-500 dark:text-gray-400">
                {Math.round((downloadProgress / downloadTotal) * 100)}%
              </div>
            )}
          </div>
        </div>
      )}

      {/* 上传进度浮动面板 */}
      {uploadTasks.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              上传进度 ({uploadTasks.filter(t => t.status === 'done').length}/{uploadTasks.length})
            </span>
            <button
              onClick={() => setUploadTasks([])}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {uploadTasks.map(task => (
              <div key={task.id} className="px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[180px]" title={task.fileName}>
                    {task.fileName}
                  </span>
                  <span className="text-xs ml-1 flex-shrink-0">
                    {task.status === 'done' && <span className="text-green-500">✓</span>}
                    {task.status === 'error' && <span className="text-red-500" title={task.error}>✗</span>}
                    {(task.status === 'uploading' || task.status === 'pending') && (
                      <span className="text-gray-500">{task.progress}%</span>
                    )}
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      task.status === 'done' ? 'bg-green-500' :
                      task.status === 'error' ? 'bg-red-500' :
                      'bg-primary-500'
                    }`}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                {task.status === 'error' && task.error && (
                  <p className="text-xs text-red-500 mt-0.5 truncate">{task.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* 路径 ACL 对话框 —— Portal 到 body */}
    {aclTarget && createPortal(
      <PathAclDialog
        targetPath={aclTarget.path}
        storageId={aclTarget.storageId}
        onClose={() => setAclTarget(null)}
      />,
      document.body
    )}
    </>
  );
}

// 分栏视图组件
function ColumnView({
  path,
  selectedPath,
  onSelect
}: {
  path: string;
  selectedPath?: string;
  onSelect: (item: FileSystemItem) => void;
}) {
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadItems = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/explore/list?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        setItems(data.items || []);
      } catch (error) {
        console.error('Failed to load column:', error);
      } finally {
        setLoading(false);
      }
    };
    loadItems();
  }, [path]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-20">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="divide-y dark:divide-gray-700">
      {items.map((item, index) => (
        <div
          key={`${item.path}-${index}`}
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
            selectedPath === item.path
              ? 'bg-primary-100 dark:bg-primary-900'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          onClick={() => onSelect(item)}
        >
          <span>{getFileIcon(item)}</span>
          <span className="text-sm dark:text-white truncate">{item.name}</span>
          {item.type === 'directory' && (
            <svg className="w-4 h-4 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}
