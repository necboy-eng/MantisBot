import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
  canvasBg?: 'white' | 'dark';
}

export function MarkdownPreview({ content, canvasBg = 'white' }: MarkdownPreviewProps) {
  // 根据 canvasBg 而非系统主题决定文字颜色
  const proseClass = canvasBg === 'dark' ? 'prose prose-invert' : 'prose';
  return (
    <div className={`${proseClass} max-w-none p-4`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
