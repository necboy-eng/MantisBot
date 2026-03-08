import { useEffect, useRef, useState } from 'react';
import { Download, Maximize2, Minimize2, FileImage } from 'lucide-react';

export interface InfographicData {
  template: string;
  data: {
    title?: string;
    desc?: string;
    lists?: Array<Record<string, any>>;
    sequences?: Array<Record<string, any>>;
    compares?: Array<Record<string, any>>;
    items?: Array<Record<string, any>>;
    values?: Array<{ label: string; value: number }>;
    nodes?: Array<{ id: string; label: string }>;
    relations?: string[];
    root?: Record<string, any>;
  };
  theme?: {
    palette?: string[];
    stylize?: string;
    base?: {
      text?: {
        'font-family'?: string;
      };
    };
  };
}

export interface InfographicViewerProps {
  infographicSyntax: string;
  width?: string;
  height?: string;
  editable?: boolean;
  onExport?: (svgDataUrl: string) => void;
  canvasBg?: 'white' | 'dark';
}

/**
 * Infographic Viewer Component
 *
 * Renders AntV Infographic syntax using CDN
 */
export function InfographicViewer({
  infographicSyntax,
  width = '100%',
  height = '100%',
  editable = false,
  onExport,
  canvasBg = 'white',
}: InfographicViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const infographicRef = useRef<any>(null);
  const fullscreenInfographicRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 创建 Infographic 实例的通用函数
  function createInstance(container: HTMLDivElement, w: string, h: string, ref: { current: any }) {
    if (ref.current) {
      ref.current.destroy();
    }
    const instance = new (window as any).AntVInfographic.Infographic({
      container,
      width: w,
      height: h,
      editable,
    });
    ref.current = instance;
    const doRender = () => instance.render(infographicSyntax);
    if (document.fonts) {
      document.fonts.ready.then(doRender).catch(doRender);
    } else {
      doRender();
    }
    return instance;
  }

  // Load AntV Infographic script
  useEffect(() => {
    if ((window as any).AntVInfographic) {
      setIsLoading(false);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@antv/infographic@latest/dist/infographic.min.js';
    script.async = true;
    script.onload = () => {
      console.log('[InfographicViewer] AntV Infographic loaded');
      setIsLoading(false);
    };
    script.onerror = () => {
      setError('Failed to load AntV Infographic library');
      setIsLoading(false);
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // 渲染普通模式实例
  useEffect(() => {
    if (!containerRef.current || isLoading || error || !(window as any).AntVInfographic) return;
    try {
      const instance = createInstance(containerRef.current, width, height, infographicRef);
      if (onExport) {
        setTimeout(async () => {
          try {
            const svgDataUrl = await instance.toDataURL({ type: 'svg' });
            onExport(svgDataUrl);
          } catch (err) {
            console.warn('[InfographicViewer] Export failed:', err);
          }
        }, 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render infographic');
    }
  }, [infographicSyntax, width, height, editable, isLoading, error, onExport]);

  // 全屏模式：挂载时初始化实例
  useEffect(() => {
    if (!isFullscreen || !fullscreenContainerRef.current || isLoading || error || !(window as any).AntVInfographic) return;
    try {
      createInstance(fullscreenContainerRef.current, '100%', '100%', fullscreenInfographicRef);
    } catch (err) {
      console.error('[InfographicViewer] Fullscreen render error:', err);
    }
    return () => {
      if (fullscreenInfographicRef.current) {
        fullscreenInfographicRef.current.destroy();
        fullscreenInfographicRef.current = null;
      }
    };
  }, [isFullscreen, infographicSyntax, isLoading, error]);

  // 下载函数
  async function handleDownload(type: 'png' | 'svg') {
    const instance = isFullscreen ? fullscreenInfographicRef.current : infographicRef.current;
    if (!instance) return;
    setIsExporting(true);
    try {
      const dataUrl: string = await instance.toDataURL({ type });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `infographic.${type}`;
      a.click();
    } catch (err) {
      console.error('[InfographicViewer] Download failed:', err);
    } finally {
      setIsExporting(false);
    }
  }

  const outerBg = canvasBg === 'dark' ? '#1f2937' : '#f9fafb';

  // 工具栏（下载 + 全屏切换）
  function Toolbar({ fullscreen }: { fullscreen: boolean }) {
    return (
      <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
        <button
          onClick={() => handleDownload('png')}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-white/90 hover:bg-white text-gray-700 rounded shadow-sm border border-gray-200 transition-colors disabled:opacity-50"
          title="下载 PNG"
        >
          <FileImage className="w-3.5 h-3.5" />
          <span>PNG</span>
        </button>
        <button
          onClick={() => handleDownload('svg')}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-white/90 hover:bg-white text-gray-700 rounded shadow-sm border border-gray-200 transition-colors disabled:opacity-50"
          title="下载 SVG"
        >
          <Download className="w-3.5 h-3.5" />
          <span>SVG</span>
        </button>
        <button
          onClick={() => setIsFullscreen(!fullscreen)}
          className="flex items-center p-1.5 bg-white/90 hover:bg-white text-gray-700 rounded shadow-sm border border-gray-200 transition-colors"
          title={fullscreen ? '退出全屏' : '全屏预览'}
        >
          {fullscreen
            ? <Minimize2 className="w-3.5 h-3.5" />
            : <Maximize2 className="w-3.5 h-3.5" />
          }
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading Infographic...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <div className="text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 普通模式 */}
      <div
        className="infographic-viewer-container relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 h-full"
        style={{ backgroundColor: outerBg }}
      >
        <Toolbar fullscreen={false} />
        <div ref={containerRef} className="infographic-container" style={{ backgroundColor: '#ffffff' }} />
      </div>

      {/* 全屏模式：fixed 覆盖层 */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[70] flex flex-col"
          style={{ backgroundColor: outerBg }}
        >
          <Toolbar fullscreen={true} />
          <div
            ref={fullscreenContainerRef}
            className="flex-1"
            style={{ backgroundColor: '#ffffff' }}
          />
        </div>
      )}
    </>
  );
}

/**
 * Parse infographic syntax to object
 */
export function parseInfographicSyntax(syntax: string): InfographicData | null {
  try {
    const lines = syntax.trim().split('\n');
    const result: any = { data: {}, theme: {} };
    let currentSection: 'data' | 'theme' | null = null;
    let currentArray: string | null = null;
    let currentObject: any = null;

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('#')) continue;

      // Check for section headers
      if (line.startsWith('infographic ')) {
        result.template = line.replace('infographic ', '').trim();
        continue;
      }

      if (line.trim() === 'data') {
        currentSection = 'data';
        continue;
      }

      if (line.trim() === 'theme') {
        currentSection = 'theme';
        continue;
      }

      // Parse content based on current section
      if (currentSection) {
        const trimmed = line.trim();

        // Handle array items
        if (trimmed.startsWith('- ')) {
          const itemContent = trimmed.slice(2);
          const [key, ...valueParts] = itemContent.split(' ');
          const value = valueParts.join(' ');

          if (currentArray && result[currentSection][currentArray]) {
            if (!currentObject) {
              currentObject = {};
              result[currentSection][currentArray].push(currentObject);
            }
            currentObject[key] = value || true;
          }
          continue;
        }

        // Handle key-value pairs
        const [key, ...valueParts] = trimmed.split(' ');
        const value = valueParts.join(' ');

        if (key === 'palette' && currentSection === 'theme') {
          if (value) {
            result.theme.palette = value.split(' ');
          }
          continue;
        }

        // Handle nested objects
        if (['lists', 'sequences', 'compares', 'items', 'values', 'nodes', 'relations', 'root', 'children'].includes(key)) {
          currentArray = key;
          result[currentSection][key] = [];
          currentObject = null;
          continue;
        }

        // Simple key-value
        if (value && currentSection) {
          result[currentSection][key] = value;
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[parseInfographicSyntax] Error:', err);
    return null;
  }
}

export default InfographicViewer;
