import { useEffect, useState } from 'react';
import { HtmlPreview } from './preview/HtmlPreview';
import { ImagePreview } from './preview/ImagePreview';
import { MarkdownPreview } from './preview/MarkdownPreview';
import { TextPreview } from './preview/TextPreview';
import { OfficePreview } from './preview/OfficePreview';
import { PdfPreview } from './preview/PdfPreview';
import { InfographicPreview } from './InfographicPreview';
import { authFetch, appendTokenToUrl } from '../utils/auth';

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  ext?: string;
  fileApiUrl?: string;  // /api/files/xxx.png 格式的 URL（用于直接访问保存的附件）
}

interface PreviewPaneProps {
  file: FileItem | null;
  officePreviewServer?: string;  // OnlyOffice 预览服务器地址
  canvasBg?: 'white' | 'dark';
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
const MARKDOWN_EXTS = ['md', 'markdown'];
const PDF_EXTS = ['pdf'];
const OFFICE_EXTS: Record<string, string[]> = {
  docx: ['docx'],
  xlsx: ['xlsx', 'xls'],
  pptx: ['pptx', 'ppt']
};

/**
 * Check if content contains AntV Infographic syntax
 */
function isInfographicSyntax(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('infographic ') && (trimmed.includes('data') || trimmed.includes('theme'));
}

/**
 * Extract infographic syntax from HTML file
 */
function extractInfographicSyntax(content: string): string | null {
  // Try to find infographic syntax in script tag
  const scriptMatch = content.match(/infographic\.render\([`'"]([\s\S]*?)[`'"]\)/);
  if (scriptMatch) {
    return scriptMatch[1];
  }

  // Check if content is raw infographic syntax
  if (isInfographicSyntax(content)) {
    return content;
  }

  return null;
}

export function PreviewPane({ file, officePreviewServer, canvasBg = 'white' }: PreviewPaneProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bgStyle = canvasBg === 'dark'
    ? { backgroundColor: '#1f2937' }
    : { backgroundColor: '#ffffff' };

  useEffect(() => {
    // 如果没有文件，或者是目录，或者是 type 未定义，不加载内容
    if (!file || file.type === 'directory' || file.type === undefined) {
      setContent('');
      setError(null);
      return;
    }

    // 获取文件扩展名
    const ext = (file.ext || file.name.split('.').pop() || '').toLowerCase().replace('.', '');

    // 图片文件不需要加载文本内容，直接使用 img 标签加载
    if (IMAGE_EXTS.includes(ext)) {
      setContent('');
      setError(null);
      setLoading(false);
      return;
    }

    // PDF 也不需要加载文本内容
    if (PDF_EXTS.includes(ext)) {
      setContent('');
      setError(null);
      setLoading(false);
      return;
    }

    const loadContent = async () => {
      setLoading(true);
      setError(null);
      try {
        // 如果有 fileApiUrl（send_file 发送的附件），直接使用该 URL
        // 否则使用 /api/explore/read 端点读取文件系统中的文件
        const url = file.fileApiUrl
          ? file.fileApiUrl
          : `/api/explore/read?path=${encodeURIComponent(file.path)}`;

        const res = await authFetch(url);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        // 根据请求类型处理内容
        if (file.fileApiUrl) {
          // fileApiUrl 返回的是原始文件内容，需要作为文本读取
          const text = await res.text();
          setContent(text);
        } else {
          // /api/explore/read 返回的是 JSON 格式
          const data = await res.json();
          setContent(data.content || '');
        }
      } catch (error) {
        console.error('Failed to load file:', error);
        setError(error instanceof Error ? error.message : 'Failed to load file');
        setContent('');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [file]);

  if (!file) {
    return (
      <div className="h-full" style={bgStyle}>
        <div className="flex items-center justify-center h-full text-gray-400">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>Select a file to preview</p>
          </div>
        </div>
      </div>
    );
  }

  // 如果是目录或类型未定义，显示提示
  if (file.type === 'directory' || file.type === undefined) {
    return (
      <div className="h-full" style={bgStyle}>
        <div className="flex items-center justify-center h-full text-gray-400">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p>{file.name}</p>
            <p className="text-sm mt-2">文件夹无法预览，请双击进入</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={bgStyle}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500 p-4" style={bgStyle}>
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // 获取文件扩展名（不带点）
  const ext = (file.ext || file.name.split('.').pop() || '').toLowerCase().replace('.', '');

  function renderFileContent() {
    if (ext === 'html' || ext === 'htm') {
      const infographicSyntax = extractInfographicSyntax(content);
      if (infographicSyntax) {
        return <InfographicPreview infographicSyntax={infographicSyntax} title={file!.name} />;
      }
      return <HtmlPreview content={content} />;
    }

    if (MARKDOWN_EXTS.includes(ext)) {
      if (isInfographicSyntax(content)) {
        return <InfographicPreview infographicSyntax={content} title={file!.name} />;
      }
      return <MarkdownPreview content={content} canvasBg={canvasBg} />;
    }

    if (IMAGE_EXTS.includes(ext)) {
      const imageSrc = appendTokenToUrl(file!.fileApiUrl || `/api/explore/binary?path=${encodeURIComponent(file!.path)}`);
      return <ImagePreview src={imageSrc} />;
    }

    if (PDF_EXTS.includes(ext)) {
      const pdfSrc = appendTokenToUrl(file!.fileApiUrl || `/api/explore/binary?path=${encodeURIComponent(file!.path)}`);
      return <PdfPreview src={pdfSrc} />;
    }

    if (OFFICE_EXTS.docx.includes(ext)) {
      return <OfficePreview filePath={file!.path} type="docx" fileApiUrl={file!.fileApiUrl} officePreviewServer={officePreviewServer} />;
    }
    if (OFFICE_EXTS.xlsx.includes(ext)) {
      return <OfficePreview filePath={file!.path} type="xlsx" fileApiUrl={file!.fileApiUrl} officePreviewServer={officePreviewServer} />;
    }
    if (OFFICE_EXTS.pptx.includes(ext)) {
      return <OfficePreview filePath={file!.path} type="pptx" fileApiUrl={file!.fileApiUrl} officePreviewServer={officePreviewServer} />;
    }

    return <TextPreview content={content} language={ext} />;
  }

  return (
    <div className="h-full" style={bgStyle}>
      {renderFileContent()}
    </div>
  );
}
