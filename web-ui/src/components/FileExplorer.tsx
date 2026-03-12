import { useState, useEffect, useCallback } from 'react';
import { FileItem } from './PreviewPane';
import { authFetch } from '../utils/auth';
import { ChevronUp, ChevronDown, GripHorizontal } from 'lucide-react';

interface FileExplorerProps {
  onFileSelect: (file: FileItem) => void;
}

export function FileExplorer({ onFileSelect }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

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
      // 保存高度
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
    try {
      const res = await authFetch(`/api/explore/list?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      setItems(data.items || []);
      // 使用服务器返回的当前路径
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
  }, []);

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

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col">
      {/* 标题栏 - 可点击展开/收起，同时也是拖拽把手 */}
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
          {/* 拖拽调整高度把手 - 仅在展开时显示 */}
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
          {/* 展开/收起箭头 */}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 内容区域 - 仅在展开时显示 */}
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
            ) : items.length === 0 ? (
              <div className="text-center py-4 text-gray-400 dark:text-gray-500">Empty directory</div>
            ) : (
              <div className="space-y-1">
                {items.map((item, index) => (
                  <div
                    key={`${item.path}-${index}`}
                    onClick={() => handleItemClick(item)}
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
