import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileItem, PreviewPane } from './PreviewPane';
import { FileExplorer } from './FileExplorer';
import { FileManager } from './FileManager';
import { Monitor, Globe, FileText, HardDrive, Image, ExternalLink, Mail, List, Sun, Moon } from 'lucide-react';
import { InfographicViewer } from './InfographicViewer';
import { EmailPanel } from './EmailPanel';
import type { EmailReference } from '../types/context-reference';

export type { FileItem };

// 浏览器截图
export interface BrowserSnapshot {
  id: string;
  url: string;
  timestamp: number;
  screenshot: string;  // base64 或 URL
  title?: string;
}

// 搜索 URL 列表
export interface SearchUrlList {
  id: string;
  query: string;
  urls: Array<{ title: string; url: string }>;
  timestamp: number;
}

// 终端输出
export interface TerminalOutput {
  id: string;
  command: string;
  output: string;
  error?: string;
  timestamp: number;
}

type CanvasMode = 'preview' | 'files' | 'browser' | 'terminal' | 'email';
type BrowserViewMode = 'screenshots' | 'live' | 'search-urls';

interface CanvasPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentFile: FileItem | null;
  onFileSelect: (file: FileItem) => void;
  browserSnapshots?: BrowserSnapshot[];
  terminalOutputs?: TerminalOutput[];
  searchUrlLists?: SearchUrlList[];
  forceMode?: CanvasMode;
  forceBrowserViewMode?: BrowserViewMode;
  onClearForceMode?: () => void;
  homeDirectory?: string;
  officePreviewServer?: string;
  serverUrl?: string;
  // 新增：添加文件引用回调
  onAddReference?: (item: { path: string; name: string; type: 'file' | 'directory'; size?: number; ext?: string }) => void;
  // 新增：添加邮件引用回调
  onAddEmailReference?: (ref: EmailReference) => void;
  // 新增：程序化发送消息回调
  onSendProgrammatic?: (message: string) => void;
  // 新增：工作目录变更回调
  onWorkDirChange?: (path: string) => void;
  // 新增：权限错误回调
  onPermissionError?: (path: string, onSuccess: () => void) => void;
  // 多标签预览：打开的文件列表
  openFiles?: FileItem[];
  onOpenFilesChange?: (files: FileItem[]) => void;
  onCurrentFileChange?: (file: FileItem | null) => void;
  // 邮件未读数（用于 Tab badge）
  emailUnreadCount?: number;
  onEmailTabOpen?: () => void;
  // 后端推送的新邮件摘要（轮询发现新邮件时传入）
  incomingEmails?: any[];
  onIncomingEmailsConsumed?: () => void;
  // 信息图渲染
  infographicSyntax?: string;
}

export function CanvasPanel({
  isOpen,
  onClose,
  currentFile,
  onFileSelect,
  browserSnapshots = [],
  terminalOutputs = [],
  searchUrlLists = [],
  forceMode,
  forceBrowserViewMode,
  onClearForceMode,
  homeDirectory = '/',
  officePreviewServer,
  serverUrl,
  onAddReference,
  onAddEmailReference,
  onSendProgrammatic,
  onWorkDirChange,
  onPermissionError,
  openFiles = [],
  onOpenFilesChange,
  onCurrentFileChange,
  emailUnreadCount = 0,
  onEmailTabOpen,
  incomingEmails,
  onIncomingEmailsConsumed,
  infographicSyntax,
}: CanvasPanelProps) {
  const { t } = useTranslation();

  // 移动端检测（< 768px 即 Tailwind md 断点）
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  // 默认宽度为屏幕宽度的 40%（仅桌面端侧边栏使用），优先从 localStorage 读取
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('canvas-panel-width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        const maxWidth = Math.floor(window.innerWidth * 0.8);
        if (parsed >= 300 && parsed <= maxWidth) return parsed;
      }
    } catch {}
    return Math.floor(window.innerWidth * 0.4);
  });

  // 响应窗口大小变化，同步移动端判断和侧边栏宽度
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setWidth(prevWidth => {
        const newWidth = Math.floor(window.innerWidth * 0.4);
        const maxWidth = Math.floor(window.innerWidth * 0.8);
        if (prevWidth > maxWidth || prevWidth < 300) {
          return Math.max(300, Math.min(maxWidth, newWidth));
        }
        return prevWidth;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // 画布背景色：white（白色）或 dark（深色），独立于系统主题，从 localStorage 读取
  const [canvasBg, setCanvasBg] = useState<'white' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('canvas-bg-mode');
      if (saved === 'dark') return 'dark';
    } catch {}
    return 'white';
  });

  const toggleCanvasBg = () => {
    setCanvasBg(prev => {
      const next = prev === 'white' ? 'dark' : 'white';
      try { localStorage.setItem('canvas-bg-mode', next); } catch {}
      return next;
    });
  };

  // preview 模式当前激活的 tab：'__infographic__' 或文件 path
  const [activeTabId, setActiveTabId] = useState<string>('');

  // 当新的信息图语法传入时，自动激活信息图 tab
  const prevInfographicSyntaxRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (infographicSyntax && infographicSyntax !== prevInfographicSyntaxRef.current) {
      setActiveTabId('__infographic__');
    }
    prevInfographicSyntaxRef.current = infographicSyntax;
  }, [infographicSyntax]);

  // 当 currentFile ���化时同步激活对应 tab（外部切换文件时）
  useEffect(() => {
    if (currentFile) {
      setActiveTabId(currentFile.path);
    }
  }, [currentFile]);

  const [internalMode, setMode] = useState<CanvasMode>('files');
  // 保存文件管理器的当前路径（使用 homeDirectory 作为初始值）
  const [fileManagerPath, setFileManagerPath] = useState(homeDirectory);
  // 浏览器视图模式：截图 or 实时预览
  const [browserViewMode, setBrowserViewMode] = useState<BrowserViewMode>('screenshots');

  // 当有强制浏览器视图模式时，切换到该模式
  useEffect(() => {
    if (forceBrowserViewMode) {
      setBrowserViewMode(forceBrowserViewMode);
    }
  }, [forceBrowserViewMode]);
  // 实时预览的 URL
  const [livePreviewUrl, setLivePreviewUrl] = useState<string>('');
  // iframe 加载错误
  const [iframeError, setIframeError] = useState(false);
  // 放大的截图
  const [enlargedSnapshot, setEnlargedSnapshot] = useState<BrowserSnapshot | null>(null);

  // 终端输出自动滚动相关
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const [terminalAutoScroll, setTerminalAutoScroll] = useState(true);

  // 浏览器截图自动滚动相关
  const browserContainerRef = useRef<HTMLDivElement>(null);
  const [browserAutoScroll, setBrowserAutoScroll] = useState(true);

  // 标记下一次 onPathChange 是否来自 homeDirectory 自动同步（不应触发 workdir 更新）
  const skipNextWorkDirUpdateRef = useRef(false);

  // 当 homeDirectory 从 API 获取后更新时，同步到 fileManagerPath
  useEffect(() => {
    if (homeDirectory && homeDirectory !== '/') {
      skipNextWorkDirUpdateRef.current = true; // 本次路径变化由系统同步，非用户导航
      setFileManagerPath(homeDirectory);
    }
  }, [homeDirectory]);

  // 处理文件管理器路径变化，同时更新工作目录（仅用户主动导航时才触发）
  const handleFileManagerPathChange = (newPath: string) => {
    setFileManagerPath(newPath);
    // 若本次变化来自 homeDirectory 自动同步，跳过 workdir 更新，避免触发 400 错误
    if (skipNextWorkDirUpdateRef.current) {
      skipNextWorkDirUpdateRef.current = false;
      return;
    }
    if (onWorkDirChange) {
      onWorkDirChange(newPath);
    }
  };

  // 当有新的浏览器截图时，更新实时预览的 URL
  useEffect(() => {
    if (browserSnapshots.length > 0) {
      const latestSnapshot = browserSnapshots[browserSnapshots.length - 1];
      setLivePreviewUrl(latestSnapshot.url);
      setIframeError(false);  // 重置错误状态
    }
  }, [browserSnapshots]);

  // 如果有强制模式，使用它
  const mode = forceMode || internalMode;

  // 处理标签切换（清除强制模式）
  const handleModeChange = (newMode: CanvasMode) => {
    setMode(newMode);
    if (onClearForceMode) {
      onClearForceMode();
    }
  };

  // 移动端底部抽屉下拉关闭手势
  const touchStartYRef = useRef<number>(0);
  const handleDragHandleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleDragHandleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (deltaY > 80) onClose();
  };

  // 终端输出滚动处理：检测用户是否滚动到底部
  const handleTerminalScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setTerminalAutoScroll(isAtBottom);
  };

  // 浏览器截图滚动处理：检测用户是否滚动到底部
  const handleBrowserScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setBrowserAutoScroll(isAtBottom);
  };

  // 终端输出自动滚动
  useEffect(() => {
    if (terminalAutoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalOutputs, terminalAutoScroll]);

  // 浏览器截图自动滚动 - 当切换到截图模式时自动滚动到顶部（最新截图）
  useEffect(() => {
    if (mode === 'browser' && browserViewMode === 'screenshots' && browserAutoScroll) {
      setTimeout(() => {
        if (browserContainerRef.current) {
          // 最新的截图在顶部显示，所以滚动到顶部
          browserContainerRef.current.scrollTop = 0;
        }
      }, 100);
    }
  }, [browserSnapshots, mode, browserViewMode, browserAutoScroll]);

  if (!isOpen) return null;

  return (
    <div
      className={isMobile
        ? 'fixed bottom-0 inset-x-0 z-40 h-[65vh] bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300'
        : 'relative h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col shadow-xl flex-shrink-0'
      }
      style={!isMobile ? { width: `${width}px`, minWidth: '300px' } : undefined}
    >
      {/* 移动端拖拽把手（下滑 > 80px 关闭） */}
      {isMobile && (
        <div
          className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={handleDragHandleTouchStart}
          onTouchEnd={handleDragHandleTouchEnd}
        >
          <div className="w-10 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>
      )}

      {/* 桌面端拖拽调整宽度 */}
      {!isMobile && (
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary-500/50 active:bg-primary-500 transition-colors z-10"
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startWidth = width;
          let lastWidth = startWidth;
          const onMouseMove = (e: MouseEvent) => {
            // 最小 300px，最大屏幕宽度的 80%
            const maxWidth = Math.floor(window.innerWidth * 0.8);
            const newWidth = Math.max(300, Math.min(maxWidth, startWidth - (e.clientX - startX)));
            lastWidth = newWidth;
            setWidth(newWidth);
          };
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // 拖拽结束时持久化宽度
            try { localStorage.setItem('canvas-panel-width', String(lastWidth)); } catch {}
          };
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      />
      )}

      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold dark:text-white">{t('canvas.title')}</h2>

          {/* 标签切换 */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 ml-4 gap-1">
            <button
              onClick={() => handleModeChange('preview')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                mode === 'preview'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={t('canvas.preview')}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('canvas.preview')}</span>
            </button>
            <button
              onClick={() => handleModeChange('browser')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors relative ${
                mode === 'browser'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={t('canvas.browser')}
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('canvas.browser')}</span>
              {browserSnapshots.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 text-white text-xs rounded-full flex items-center justify-center">
                  {browserSnapshots.length}
                </span>
              )}
            </button>
            <button
              onClick={() => handleModeChange('terminal')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors relative ${
                mode === 'terminal'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={t('canvas.terminal')}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('canvas.terminal')}</span>
              {terminalOutputs.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 text-white text-xs rounded-full flex items-center justify-center">
                  {terminalOutputs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => handleModeChange('files')}
              className={`flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                mode === 'files'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={t('canvas.nas')}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('canvas.nas')}</span>
            </button>
            <button
              onClick={() => { handleModeChange('email'); onEmailTabOpen?.(); }}
              className={`relative flex items-center gap-1 px-3 py-1 text-sm rounded-md transition-colors ${
                mode === 'email'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={t('canvas.email')}
            >
              <Mail className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('canvas.email')}</span>
              {emailUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {emailUnreadCount > 99 ? '99+' : emailUnreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 画布背景色切换按钮 - preview 模式始终显示 */}
          {mode === 'preview' && (
            <button
              onClick={toggleCanvasBg}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              title={canvasBg === 'white' ? '切换为深色背景' : '切换为白色背景'}
            >
              {canvasBg === 'white'
                ? <Moon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                : <Sun className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              }
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <svg className="w-5 h-5 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'preview' ? (
          <>
            {/* tab 栏：信息图 tab + 文件 tabs，有任意内容时均显示 */}
            {(infographicSyntax || openFiles.length >= 1) && (
              <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto flex-shrink-0">
                {/* 信息图 tab */}
                {infographicSyntax && (
                  <div
                    className={`group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
                      activeTabId === '__infographic__'
                        ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => setActiveTabId('__infographic__')}
                  >
                    <Image className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">信息图</span>
                  </div>
                )}
                {/* 文件 tabs */}
                {openFiles.map((file) => (
                  <div
                    key={file.path}
                    className={`group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
                      activeTabId === file.path
                        ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => {
                      setActiveTabId(file.path);
                      onCurrentFileChange?.(file);
                    }}
                  >
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">{file.name}</span>
                    <button
                      className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 rounded p-0.5 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        const newFiles = openFiles.filter(f => f.path !== file.path);
                        onOpenFilesChange?.(newFiles);
                        if (activeTabId === file.path) {
                          // 关闭当前激活的文件 tab：优先切换到信息图，否则切到剩余第一个文件
                          if (infographicSyntax) {
                            setActiveTabId('__infographic__');
                          } else if (newFiles.length > 0) {
                            setActiveTabId(newFiles[0].path);
                            onCurrentFileChange?.(newFiles[0]);
                          } else {
                            setActiveTabId('');
                            onCurrentFileChange?.(null);
                          }
                        }
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 内容：信息图 or 文件预览 */}
            {activeTabId === '__infographic__' && infographicSyntax ? (
              <div className="flex-1 overflow-hidden flex flex-col h-full">
                <InfographicViewer
                  infographicSyntax={infographicSyntax}
                  width="100%"
                  height="100%"
                  canvasBg={canvasBg}
                />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-auto h-full" style={canvasBg === 'dark' ? { backgroundColor: '#1f2937' } : { backgroundColor: '#ffffff' }}>
                  <PreviewPane file={currentFile} officePreviewServer={officePreviewServer} canvasBg={canvasBg} />
                </div>
                <FileExplorer onFileSelect={onFileSelect} />
              </>
            )}
          </>
        ) : mode === 'files' ? (
          /* 文件管理器 */
          <FileManager
            initialPath={fileManagerPath}
            onPathChange={handleFileManagerPathChange}
            onFileSelect={onFileSelect}
            onSwitchToPreview={() => handleModeChange('preview')}
            officePreviewServer={officePreviewServer}
            serverUrl={serverUrl}
            onAddReference={onAddReference}
            onPermissionError={onPermissionError}
          />
        ) : mode === 'browser' ? (
          /* 浏览器标签页 */
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* 视图切换按钮 */}
            <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center bg-white dark:bg-gray-900 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => setBrowserViewMode('screenshots')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                    browserViewMode === 'screenshots'
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  <Image className="w-3.5 h-3.5" />
                  <span>{t('canvas.screenshot')}</span>
                </button>
                <button
                  onClick={() => setBrowserViewMode('search-urls')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors relative ${
                    browserViewMode === 'search-urls'
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>{t('canvas.searchResults')}</span>
                  {searchUrlLists.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 text-white text-xs rounded-full flex items-center justify-center">
                      {searchUrlLists.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setBrowserViewMode('live')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                    browserViewMode === 'live'
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                  disabled={!livePreviewUrl}
                  title={!livePreviewUrl ? t('canvas.noUrlAvailable') : t('canvas.livePreview')}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t('canvas.livePreview')}</span>
                </button>
              </div>
              {browserViewMode === 'live' && livePreviewUrl && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
                  {livePreviewUrl}
                </span>
              )}
            </div>

            {/* 内容区域 */}
            <div
              ref={browserContainerRef}
              className="flex-1 overflow-auto"
              onScroll={handleBrowserScroll}
            >
              {browserViewMode === 'screenshots' ? (
                /* 截图模式 - 时间轴展示（最新在前） */
                <div className="p-4">
                  {browserSnapshots.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                      <div className="text-center">
                        <Globe className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p>{t('canvas.noScreenshots')}</p>
                        <p className="text-sm mt-2">{t('canvas.screenshotHint')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* 反转数组，最新的截图在最前面 */}
                      {[...browserSnapshots].reverse().map((snapshot, index) => (
                        <div key={snapshot.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          {/* 截图标题 */}
                          <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4 text-gray-500" />
                              <span className="text-sm font-medium truncate dark:text-white">
                                {snapshot.title || snapshot.url}
                              </span>
                              {index === 0 && (
                                <span className="px-2 py-0.5 text-xs bg-primary-500 text-white rounded-full">
                                  {t('canvas.latest')}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(snapshot.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          {/* 截图内容 - 点击放大 */}
                          <img
                            src={snapshot.screenshot.startsWith('data:') ? snapshot.screenshot : `data:image/png;base64,${snapshot.screenshot}`}
                            alt={snapshot.title || snapshot.url}
                            className="w-full cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setEnlargedSnapshot(snapshot)}
                            title={t('canvas.clickToEnlarge')}
                          />
                          {/* URL - 点击跳转到实时预览 */}
                          <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5">
                            <button
                              onClick={() => {
                                setLivePreviewUrl(snapshot.url);
                                setBrowserViewMode('live');
                                setIframeError(false);
                              }}
                              className="text-xs text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 truncate w-full text-left transition-colors"
                              title={t('canvas.clickToOpen')}
                            >
                              {snapshot.url}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : browserViewMode === 'search-urls' ? (
                /* 搜索 URL 列表模式 */
                <div className="p-4">
                  {searchUrlLists.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                      <div className="text-center">
                        <List className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p>{t('canvas.noSearchResults')}</p>
                        <p className="text-sm mt-2">{t('canvas.searchResultsHint')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* 反转数组，最新的搜索结果在最前面 */}
                      {[...searchUrlLists].reverse().map((searchList, index) => (
                        <div key={searchList.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          {/* 搜索标题 */}
                          <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4 text-gray-500" />
                              <span className="text-sm font-medium dark:text-white">
                                {t('canvas.searchQuery')}: {searchList.query}
                              </span>
                              {index === 0 && (
                                <span className="px-2 py-0.5 text-xs bg-primary-500 text-white rounded-full">
                                  {t('canvas.latest')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {searchList.urls.length} {t('canvas.results')}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(searchList.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                          {/* URL 列表 */}
                          <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {searchList.urls.map((item, urlIndex) => (
                              <div
                                key={urlIndex}
                                className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                              >
                                <div className="flex items-start gap-2">
                                  <span className="text-xs text-gray-400 mt-0.5 flex-shrink-0">
                                    {urlIndex + 1}.
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium line-clamp-2"
                                    >
                                      {item.title || item.url}
                                    </a>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                      {item.url}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setLivePreviewUrl(item.url);
                                      setBrowserViewMode('live');
                                      setIframeError(false);
                                    }}
                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                                    title={t('canvas.previewInPanel')}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* 实时预览模式 */
                <div className="h-full">
                  {iframeError ? (
                    /* iframe 失败，回退到最新截图 */
                    <div className="h-full flex flex-col">
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          {t('canvas.iframeBlocked')}
                        </p>
                      </div>
                      <div className="flex-1 overflow-auto p-4">
                        {browserSnapshots.length > 0 && (
                          <img
                            src={
                              browserSnapshots[browserSnapshots.length - 1].screenshot.startsWith('data:')
                                ? browserSnapshots[browserSnapshots.length - 1].screenshot
                                : `data:image/png;base64,${browserSnapshots[browserSnapshots.length - 1].screenshot}`
                            }
                            alt="Latest screenshot"
                            className="w-full"
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    /* 尝试 iframe 嵌入 */
                    <iframe
                      src={livePreviewUrl}
                      className="w-full h-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      onError={() => {
                        console.log('[Canvas] iframe load error');
                        setIframeError(true);
                      }}
                      onLoad={() => {
                        console.log('[Canvas] iframe loaded successfully');
                      }}
                      title="Live Preview"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ) : mode === 'terminal' ? (
          /* 终端标签页 - macOS zsh 风格 */
          <div
            ref={terminalContainerRef}
            className="flex-1 overflow-auto bg-[#1e1e1e] p-0 font-mono text-sm"
            onScroll={handleTerminalScroll}
          >
            {terminalOutputs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Monitor className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>{t('canvas.noOutput')}</p>
                  <p className="text-sm mt-2">{t('canvas.outputHint')}</p>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-6">
                {terminalOutputs.map((output) => (
                  <div key={output.id} className="space-y-1">
                    {/* 命令提示符和命令 - zsh 风格 */}
                    <div className="flex items-start gap-2">
                      {/* 用户名@主机名 */}
                      <span className="text-green-400 font-semibold">user@mantis</span>
                      {/* 当前目录（简化显示） */}
                      <span className="text-blue-400">~</span>
                      {/* 提示符 */}
                      <span className="text-white">%</span>
                      {/* 命令 */}
                      <span className="text-white flex-1">{output.command}</span>
                    </div>

                    {/* 正常输出 */}
                    {output.output && (
                      <div className="pl-4">
                        <pre className="text-gray-300 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                          {output.output}
                        </pre>
                      </div>
                    )}

                    {/* 错误输出 */}
                    {output.error && (
                      <div className="pl-4">
                        <pre className="text-red-400 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                          {output.error}
                        </pre>
                      </div>
                    )}

                    {/* 命令执行时间 */}
                    <div className="pl-4 text-xs text-gray-600 mt-1">
                      {new Date(output.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* 滚动锚点 - 用于自动滚动到底部 */}
            <div ref={terminalEndRef} />
          </div>
        ) : mode === 'email' ? (
          /* 邮箱标签页 */
          <EmailPanel
            onAddEmailReference={onAddEmailReference}
            onSendProgrammatic={onSendProgrammatic}
            incomingEmails={incomingEmails}
            onIncomingEmailsConsumed={onIncomingEmailsConsumed}
          />
        ) : null}
      </div>

      {/* 放大截图模态框 */}
      {enlargedSnapshot && (
        <div
          className="fixed inset-0 z-[60] bg-black bg-opacity-75 flex items-center justify-center p-4"
          onClick={() => setEnlargedSnapshot(null)}
        >
          <div className="relative max-w-full max-h-full overflow-auto">
            {/* 关闭按钮 */}
            <button
              onClick={() => setEnlargedSnapshot(null)}
              className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* 图片信息 */}
            <div className="absolute top-4 left-4 z-10 bg-white dark:bg-gray-800 rounded-lg px-4 py-2 shadow-lg">
              <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                {enlargedSnapshot.title || t('canvas.browserScreenshot')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(enlargedSnapshot.timestamp).toLocaleString()}
              </p>
            </div>
            {/* 大图 */}
            <img
              src={enlargedSnapshot.screenshot.startsWith('data:') ? enlargedSnapshot.screenshot : `data:image/png;base64,${enlargedSnapshot.screenshot}`}
              alt={enlargedSnapshot.title || enlargedSnapshot.url}
              className="max-w-full max-h-[calc(100vh-8rem)] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            {/* URL */}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 px-4 py-2">
              <p className="text-xs text-white truncate">{enlargedSnapshot.url}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
