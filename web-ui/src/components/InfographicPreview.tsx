import { useState } from 'react';
import { Download, Maximize, Copy } from 'lucide-react';
import { InfographicViewer } from './InfographicViewer';

export interface InfographicPreviewProps {
  infographicSyntax: string;
  title?: string;
}

/**
 * Infographic Preview Component
 *
 * Full preview panel for infographics with export controls
 */
export function InfographicPreview({ infographicSyntax, title }: InfographicPreviewProps) {
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);

  const handleExport = (dataUrl: string) => {
    setSvgDataUrl(dataUrl);
  };

  const handleDownload = () => {
    if (!svgDataUrl) return;

    const link = document.createElement('a');
    link.download = `${title || 'infographic'}.svg`;
    link.href = svgDataUrl;
    link.click();
  };

  const handleCopySyntax = () => {
    navigator.clipboard.writeText(infographicSyntax);
  };

  const handleOpenInNewWindow = () => {
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Infographic'}</title>
  <style>
    body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #f5f5f5; }
    #container { width: 100%; height: 100%; }
    .controls {
      position: absolute;
      top: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 1000;
    }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: white;
      color: #333;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .btn:hover { background: #f0f0f0; }
  </style>
</head>
<body>
  <div class="controls">
    <button class="btn" onclick="exportSVG()">Download SVG</button>
  </div>
  <div id="container"></div>
  <script src="https://unpkg.com/@antv/infographic@latest/dist/infographic.min.js"></script>
  <script>
    const infographic = new AntVInfographic.Infographic({
      container: '#container',
      width: '100%',
      height: '100%',
    });
    infographic.render(\`${infographicSyntax.replace(/`/g, '\\`')}\`);
    document.fonts?.ready.then(() => {
      infographic.render(\`${infographicSyntax.replace(/`/g, '\\`')}\`);
    });

    function exportSVG() {
      infographic.toDataURL({ type: 'svg' }).then(dataUrl => {
        const link = document.createElement('a');
        link.download = '${title || 'infographic'}.svg';
        link.href = dataUrl;
        link.click();
      });
    }
  </script>
</body>
</html>
    `.trim();

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="infographic-preview-panel space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {title || '信息图预览'}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySyntax}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            title="Copy Syntax"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制语法</span>
          </button>
          <button
            onClick={handleOpenInNewWindow}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            title="Open in New Window"
          >
            <Maximize className="w-3.5 h-3.5" />
            <span>新窗口打开</span>
          </button>
          <button
            onClick={handleDownload}
            disabled={!svgDataUrl}
            className="flex items-center gap-1 px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Download SVG"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 SVG</span>
          </button>
        </div>
      </div>

      {/* Infographic viewer */}
      <div className="h-[600px] bg-white dark:bg-gray-900">
        <InfographicViewer
          infographicSyntax={infographicSyntax}
          width="100%"
          height="100%"
          onExport={handleExport}
        />
      </div>

      {/* Syntax display */}
      <details className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <summary className="px-4 py-2 bg-gray-50 dark:bg-gray-800 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          查看 Infographic 语法
        </summary>
        <pre className="p-4 bg-gray-900 text-gray-100 text-xs overflow-x-auto max-h-64 overflow-y-auto">
          <code>{infographicSyntax}</code>
        </pre>
      </details>
    </div>
  );
}

export default InfographicPreview;
