import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { authFetch, appendTokenToUrl } from '../../utils/auth';

interface OfficePreviewProps {
  filePath: string;
  type: 'docx' | 'xlsx' | 'pptx';
  fileApiUrl?: string;  // 可选的直接访问 URL（如 /api/files/xxx.docx）
  officePreviewServer?: string;  // OnlyOffice 预览服务器地址
}

export function OfficePreview({ filePath, type, fileApiUrl, officePreviewServer }: OfficePreviewProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 计算文件 URL（用于 OnlyOffice iframe 预览）
  const fileUrl = useMemo(() => {
    const backendPort = '8118';
    const isDev = window.location.port === '3081';
    const baseUrl = isDev ? `http://localhost:${backendPort}` : window.location.origin;
    if (fileApiUrl) {
      // fileApiUrl 是相对路径 /api/files/xxx.docx，转换为完整 URL 并追加 token
      // onlyoffice 在浏览器端 fetch，/api/* 受鉴权中间件保护，必须携带 token
      return appendTokenToUrl(`${baseUrl}${fileApiUrl}`);
    }
    return appendTokenToUrl(`${baseUrl}/api/explore/binary?path=${encodeURIComponent(filePath)}`);
  }, [filePath, fileApiUrl]);

  // 计算 OnlyOffice 预览 URL
  const onlyOfficePreviewUrl = useMemo(() => {
    if (!officePreviewServer) return null;

    const isDev = window.location.port === '3081';
    if (isDev) {
      // 开发模式：直接访问 OnlyOffice 服务器
      return `${officePreviewServer}/#/?url=${encodeURIComponent(fileUrl)}`;
    }
    // 生产模式：通过 nginx 代理
    return `/office-preview/#/?url=${encodeURIComponent(fileUrl)}`;
  }, [officePreviewServer, fileUrl]);

  useEffect(() => {
    // 配置了 OnlyOffice：使用 iframe 预览，不需要加载内容
    if (onlyOfficePreviewUrl) {
      setContent(''); // 清空内容，使用 iframe
      setError(null);
      return;
    }

    const loadContent = async () => {
      try {
        setError(null);

        // 使用 fileApiUrl 或 binary 端点获取二进制数据
        const url = fileApiUrl
          ? fileApiUrl
          : `/api/explore/binary?path=${encodeURIComponent(filePath)}`;

        const res = await authFetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch file: ${res.status}`);
        }

        // 获取 ArrayBuffer（二进制数据）
        const arrayBuffer = await res.arrayBuffer();

        if (type === 'docx') {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setContent(result.value);
        } else if (type === 'xlsx') {
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const html = XLSX.utils.sheet_to_html(firstSheet);
          setContent(html);
        } else if (type === 'pptx') {
          // pptx 没有配置 OnlyOffice，显示提示
          setContent('<p class="text-gray-500 text-center p-4">PPT 文件需要配置 OnlyOffice 预览服务器</p>');
        }
      } catch (error) {
        console.error('Failed to load office file:', error);
        setError(error instanceof Error ? error.message : 'Failed to load file');
        setContent('');
      }
    };

    loadContent();
  }, [filePath, type, fileApiUrl, onlyOfficePreviewUrl]);

  // 配置了 OnlyOffice：使用 iframe 预览所有 Office 文件
  if (onlyOfficePreviewUrl) {
    return (
      <div className="relative w-full h-full">
        {/* 在新窗口打开按钮 */}
        <button
          onClick={() => window.open(onlyOfficePreviewUrl, '_blank')}
          className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 bg-white/90 dark:bg-gray-800/90 rounded-md shadow-sm text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title={t('office.openInNewWindow', '在新窗口打开')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>{t('office.openInNewWindow', '在新窗口打开')}</span>
        </button>
        <iframe
          src={onlyOfficePreviewUrl}
          className="w-full h-full border-0"
          title="Office Preview"
          allow="fullscreen"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 p-4">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-auto h-full dark:bg-gray-800 dark:text-white">
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </div>
  );
}
