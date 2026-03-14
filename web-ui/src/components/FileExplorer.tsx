import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileItem } from './PreviewPane';
import { authFetch } from '../utils/auth';
import { ChevronUp, ChevronDown, GripHorizontal, ShieldCheck } from 'lucide-react';
import { usePermission } from '../hooks/usePermission';
import { PathAclDialog } from './PathAclDialog';

interface FileExplorerProps {
  onFileSelect: (file: FileItem) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  item: FileItem;
}

const ACL_BADGE: Record<string, { icon: string; title: string }> = {
  read:  { icon: '🔏', title: '只读权限' },
  write: { icon: '🔓', title: '读写权限' },
  deny:  { icon: '🔐', title: '禁止访问' },
};

export function FileExplorer({ onFileSelect }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const canManage = usePermission('manageUsers');
  // 当前存储 id（用于 ACL 规则匹配），本地文件系统时为 'local'
  const [storageId, setStorageId] = useState('local');

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 权限错误提示
  const [accessDenied, setAccessDenied] = useState<string | null>(null);

  // 权限设置对话框
  const [aclTarget, setAclTarget] = useState<{ path: string; storageId: string } | null>(null);

  // 展开/收起状态，默认收起
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem('file-explorer-expanded');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // 高度状态，默认 200px，可拖动调整
  const [height, setHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('file-explorer-height');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 100 && parsed <= 500) return parsed;
      }
    } catch {}
    return 200;
  });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(500, startHeight + deltaY));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem('file-explorer-height', String(height));
      } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height]);

  // 切换展开/收起
  const toggleExpanded = () => {
    const newValue = !isExpanded;
    setIsExpanded(newValue);
    try {
      localStorage.setItem('file-explorer-expanded', String(newValue));
    } catch {}
  };

  const loadDirectory = async (dirPath: string) => {
    setLoading(true);
    setAccessDenied(null);
    try {
      const res = await authFetch(`/api/explore/list?path=${encodeURIComponent(dirPath)}`);
      if (res.status === 403) {
        setAccessDenied(dirPath);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      if (data.currentPath) {
        setCurrentPath(data.currentPath);
      } else {
        setCurrentPath(dirPath);
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(currentPath);
    // 获取当前存储 id
    authFetch('/api/storage/current')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.id) {
          // storage-api 本地用 '__local__'，explore-api/path-acl 用 'local'
          setStorageId(data.id === '__local__' ? 'local' : data.id);
        }
      })
      .catch(() => {});
  }, []);

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  const navigateTo = (path: string) => {
    loadDirectory(path);
  };

  const goUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parentPath);
  };

  const handleItemClick = (item: FileItem) => {
    if (item.type === 'directory') {
      navigateTo(item.path);
    } else {
      onFileSelect(item);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    // 非管理员不弹自定义菜单，让浏览器默认行为
    if (!canManage) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleSetPermission = (item: FileItem) => {
    setContextMenu(null);
    setAclTarget({ path: item.path, storageId });
  };

  return (
    <>
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
          onClick={toggleExpanded}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              文件目录
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {currentPath}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isExpanded && (
              <div
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded cursor-row-resize"
                onMouseDown={handleResizeStart}
                onClick={(e) => e.stopPropagation()}
                title="拖拽调整高度"
              >
                <GripHorizontal className="w-4 h-4 text-gray-400" />
              </div>
            )}
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            )}
          </div>
        </div>

        {/* 内容区域 */}
        {isExpanded && (
          <div
            className="flex flex-col overflow-hidden"
            style={{ height: `${height}px` }}
          >
            {/* 路径导航 */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <button
                onClick={() => navigateTo('/')}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 dark:text-white"
                title="Root"
              >
                /
              </button>
              <button
                onClick={goUp}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 dark:text-white"
                title="Go up"
              >
                ↑
              </button>
              <input
                type="text"
                value={currentPath}
                onChange={(e) => setCurrentPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigateTo(currentPath)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                placeholder="Enter path..."
              />
              <button
                onClick={() => loadDirectory(currentPath)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                title="Refresh"
              >
                <svg className="w-4 h-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* 文件列表 */}
            <div className="flex-1 overflow-auto p-2">
              {loading ? (
                <div className="text-center py-4 dark:text-white">Loading...</div>
              ) : accessDenied ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg m-1">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-5a7 7 0 110-14 7 7 0 010 14z" />
                  </svg>
                  无权限访问此目录
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-4 text-gray-400 dark:text-gray-500">Empty directory</div>
              ) : (
                <div className="space-y-1">
                  {items.map((item, index) => (
                    <div
                      key={`${item.path}-${index}`}
                      onClick={() => handleItemClick(item)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      className="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer dark:text-white"
                    >
                      {item.type === 'directory' ? (
                        <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                      <span className="text-sm truncate">{item.name}</span>
                    {item.aclPermission && (
                      <span className="ml-1 text-xs flex-shrink-0" title={ACL_BADGE[item.aclPermission]?.title}>
                        {ACL_BADGE[item.aclPermission]?.icon}
                      </span>
                    )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右键菜单 —— Portal 到 body，避免被父容器 overflow 裁剪 */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]" title={contextMenu.item.path}>
              {contextMenu.item.name}
            </p>
          </div>
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            onClick={() => {
              handleItemClick(contextMenu.item);
              setContextMenu(null);
            }}
          >
            {contextMenu.item.type === 'directory' ? '打开' : '预览'}
          </button>
          {canManage && (
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              onClick={() => handleSetPermission(contextMenu.item)}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-primary-500" />
              设置权限
            </button>
          )}
        </div>,
        document.body
      )}

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
