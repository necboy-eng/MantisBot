import { useState } from 'react';
import { RotateCcw, Trash2, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { SkillChainDisplay } from './SkillChainDisplay';
import { AgentTimeline } from './AgentTimeline';

// ─── Shared types (mirrored from App.tsx) ────────────────────────────────────

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
}

export interface ToolStatus {
  tool: string;
  toolId?: string;
  status: 'start' | 'end';
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  timestamp?: number;
}

export interface AgentInvocationStatus {
  agentName: string;
  agentId: string;
  phase: 'running' | 'done';
  startTime: number;
  endTime?: number;
  task?: string;
}

export interface SkillCall {
  id: string;
  name: string;
  location: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: number;
  attachments?: FileAttachment[];
  toolStatus?: ToolStatus[];
  skillChain?: SkillCall[];
  agentInvocations?: AgentInvocationStatus[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: Message;
  expandedThinking: Set<string>;
  onToggleExpand: (key: string) => void;
  onOpenCanvas: (attachment: FileAttachment) => void;
  onResend: (msg: Message) => void;
  onDelete: (msg: Message) => void;
  getToolDisplayName: (toolName: string) => string;
  formatToolArgs: (toolName: string, args: Record<string, unknown> | undefined) => string;
  FileAttachmentCard: React.FC<{ attachment: FileAttachment; onOpenCanvas: () => void }>;
  // 信息图检测回调
  onInfographicDetected?: (syntax: string) => void;
}

// ─── 工具类型视觉映射 ──────────────────────────────────────────────────────────

interface ToolTheme {
  icon: string;
  dotColor: string;
  lineColor: string;
  badgeBg: string;
  badgeText: string;
  runningText: string;
}

function getToolTheme(toolName: string, isError: boolean): ToolTheme {
  if (isError) {
    return {
      icon: '✗',
      dotColor: 'bg-red-500',
      lineColor: 'bg-red-200 dark:bg-red-800/60',
      badgeBg: 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800',
      badgeText: 'text-red-600 dark:text-red-400',
      runningText: 'text-red-500',
    };
  }
  // 提取 action 部分：MCP 工具格式 mcp__{server}__{action}，否则直接用工具名
  const mcpMatch = toolName.match(/^mcp__?[^_]+__(.+)$/);
  const name = (mcpMatch ? mcpMatch[1] : toolName).toLowerCase();

  if (name === 'read' || name === 'glob' || name === 'grep' || name === 'read_skill' || name === 'document') {
    return {
      icon: '📂',
      dotColor: 'bg-sky-500',
      lineColor: 'bg-sky-200 dark:bg-sky-800/60',
      badgeBg: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800',
      badgeText: 'text-sky-700 dark:text-sky-300',
      runningText: 'text-sky-500',
    };
  }
  if (name === 'write' || name === 'edit') {
    return {
      icon: '✏️',
      dotColor: 'bg-emerald-500',
      lineColor: 'bg-emerald-200 dark:bg-emerald-800/60',
      badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800',
      badgeText: 'text-emerald-700 dark:text-emerald-300',
      runningText: 'text-emerald-500',
    };
  }
  if (name === 'exec' || name === 'bash') {
    return {
      icon: '⚡',
      dotColor: 'bg-amber-500',
      lineColor: 'bg-amber-200 dark:bg-amber-800/60',
      badgeBg: 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800',
      badgeText: 'text-amber-700 dark:text-amber-300',
      runningText: 'text-amber-500',
    };
  }
  if (name.startsWith('browser')) {
    return {
      icon: '🌐',
      dotColor: 'bg-primary-500',
      lineColor: 'bg-sky-200 dark:bg-sky-800/60',
      badgeBg: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800',
      badgeText: 'text-sky-700 dark:text-sky-300',
      runningText: 'text-primary-500',
    };
  }
  if (name === 'memory_search' || name === 'remember') {
    return {
      icon: '🔍',
      dotColor: 'bg-primary-500',
      lineColor: 'bg-sky-200 dark:bg-sky-800/60',
      badgeBg: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800',
      badgeText: 'text-sky-700 dark:text-sky-300',
      runningText: 'text-primary-500',
    };
  }
  return {
    icon: '⚙️',
    dotColor: 'bg-gray-400',
    lineColor: 'bg-gray-200 dark:bg-gray-700',
    badgeBg: 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700',
    badgeText: 'text-gray-600 dark:text-gray-400',
    runningText: 'text-gray-500',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessageBubble({
  msg,
  expandedThinking,
  onToggleExpand,
  onOpenCanvas,
  onResend,
  onDelete,
  getToolDisplayName,
  formatToolArgs,
  FileAttachmentCard,
  onInfographicDetected,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const isUser = msg.role === 'user';
  const isStreaming = !msg.content && msg.thinking !== undefined;

  function handleCopy() {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleDelete() {
    if (window.confirm(t('message.confirmDelete'))) {
      onDelete(msg);
    }
  }

  // ── 头像 ─────────────────────────────────────────────────────────────────────

  const UserAvatar = (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-sky-600 flex items-center justify-center text-white text-sm font-semibold ring-2 ring-white dark:ring-gray-900 shadow-sm flex-shrink-0">
      U
    </div>
  );

  const AssistantAvatar = (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-white dark:ring-gray-900 shadow-sm
      ${isStreaming
        ? 'bg-gradient-to-br from-slate-700 to-slate-900 ring-primary-400/60 dark:ring-primary-500/40 animate-pulse'
        : 'bg-gradient-to-br from-slate-700 to-slate-900'
      }`}
    >
      {/* 节点图标 SVG */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white">
        <circle cx="8" cy="3" r="2" fill="currentColor" opacity="0.9" />
        <circle cx="3" cy="11" r="2" fill="currentColor" opacity="0.7" />
        <circle cx="13" cy="11" r="2" fill="currentColor" opacity="0.7" />
        <line x1="8" y1="5" x2="3" y2="9" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
        <line x1="8" y1="5" x2="13" y2="9" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
        <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      </svg>
    </div>
  );

  // ── 操作按钮 ──────────────────────────────────────────────────────────────────

  const UserActions = (
    <div className="flex items-center gap-0.5 opacity-20 group-hover:opacity-100 transition-opacity duration-200">
      <button
        onClick={() => onResend(msg)}
        title={t('message.resend')}
        className="p-1.5 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleDelete}
        title={t('message.delete')}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const AssistantActions = (
    <div className="flex items-center gap-0.5 mt-2 opacity-20 group-hover:opacity-100 transition-opacity duration-200">
      <button
        onClick={handleCopy}
        title={copied ? t('message.copied') : t('message.copy')}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all duration-200 ${
          copied
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {copied ? (
          <><Check className="w-3 h-3" /><span>{t('message.copied')}</span></>
        ) : (
          <><Copy className="w-3 h-3" /><span>{t('message.copy')}</span></>
        )}
      </button>
      <button
        onClick={handleDelete}
        title={t('message.delete')}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
      >
        <Trash2 className="w-3 h-3" />
        <span>{t('message.delete')}</span>
      </button>
    </div>
  );

  // ── 工具调用时间轴 ────────────────────────────────────────────────────────────

  const formatResult = (result: unknown): string => {
    if (!result) return '';
    if (typeof result === 'string') return result;
    try { return JSON.stringify(result, null, 2); } catch { return String(result); }
  };

  const ToolTimeline = ({ toolStatus }: { toolStatus: ToolStatus[] }) => (
    <div className="space-y-0 my-1.5">
      {toolStatus.map((tool, idx) => {
        const isRunning = tool.status === 'start';
        const isError = !!tool.isError;
        const isLast = idx === toolStatus.length - 1;
        const toolExpKey = `${msg.id}-tool-${idx}`;
        const expanded = expandedThinking.has(toolExpKey);
        const theme = getToolTheme(tool.tool, isError);

        // remember 工具专属徽章
        if (tool.tool === 'remember' && tool.status === 'end' && !isError) {
          const remResult = tool.result as { content?: string };
          const savedContent = remResult?.content || '';
          const truncated = savedContent.length > 50
            ? savedContent.slice(0, 50) + '…'
            : savedContent;
          return (
            <div key={idx} className="flex gap-2.5">
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 18 }}>
                <div className="w-3 h-3 rounded-full bg-primary-500 flex-shrink-0 mt-0.5" />
                {!isLast && <div className="w-0.5 flex-1 mt-1 bg-sky-200 dark:bg-sky-800/60 min-h-[12px]" />}
              </div>
              <div className={`flex-1 pb-${isLast ? '0' : '2'} min-w-0 mb-1.5`}>
                <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40">
                  <span className="text-xs mt-0.5 flex-shrink-0">📌</span>
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-primary-600 dark:text-primary-400">已保存到记忆</span>
                    {truncated && (
                      <span className="text-xs text-primary-500 dark:text-primary-500 ml-1">"{truncated}"</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        const rawPreview = formatToolArgs(tool.tool, tool.args);
        const argsPreview = rawPreview.slice(0, 55) + (rawPreview.length > 55 ? '…' : '');
        const resultText = formatResult(tool.result);

        return (
          <div key={idx} className="flex gap-2.5">
            {/* 时间轴线 + 节点 */}
            <div className="flex flex-col items-center flex-shrink-0" style={{ width: 18 }}>
              <div className={`
                w-3 h-3 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center
                ${isRunning
                  ? `${theme.dotColor} animate-pulse ring-2 ring-offset-1 ring-offset-gray-100 dark:ring-offset-gray-800 ring-current/30`
                  : `${theme.dotColor} ${!isRunning ? 'tool-step-done' : ''}`
                }
              `} />
              {!isLast && (
                <div className={`w-0.5 flex-1 mt-1 ${theme.lineColor} min-h-[14px]`} />
              )}
            </div>

            {/* 步骤卡 */}
            <div className={`flex-1 pb-${isLast ? '0' : '2'} min-w-0 mb-1`}>
              <button
                onClick={() => onToggleExpand(toolExpKey)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-all duration-150 hover:brightness-95 dark:hover:brightness-110 ${theme.badgeBg}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {/* 状态图标 */}
                  {isRunning ? (
                    <svg className="w-3 h-3 animate-spin text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : isError ? (
                    <span className={`text-xs flex-shrink-0 ${theme.badgeText}`}>✗</span>
                  ) : (
                    <span className={`text-xs flex-shrink-0 ${theme.badgeText}`}>✓</span>
                  )}
                  {/* 工具 emoji */}
                  <span className="text-xs flex-shrink-0">{theme.icon}</span>
                  {/* 工具名 */}
                  <span className={`text-xs font-mono font-medium flex-shrink-0 ${theme.badgeText}`}>
                    {getToolDisplayName(tool.tool)}
                  </span>
                  {/* 参数预览 */}
                  {argsPreview && (
                    <span className="text-xs text-gray-400 dark:text-gray-600 truncate font-mono min-w-0">
                      ({argsPreview})
                    </span>
                  )}
                  {/* 展开箭头 */}
                  <svg
                    className={`w-2.5 h-2.5 flex-shrink-0 ml-auto transition-transform duration-150 text-gray-400 ${expanded ? 'rotate-90' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              </button>

              {/* 展开详情 */}
              {expanded && (
                <div className="mt-1 ml-1 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1.5">
                  {tool.args && (
                    <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words leading-relaxed">
                      {formatToolArgs(tool.tool, tool.args)}
                    </pre>
                  )}
                  {tool.status === 'end' && (
                    <pre className={`text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-relaxed ${
                      isError ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      {resultText || '(无输出)'}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── 思考过程区块 ───────────────────────────────────────────────────────────────

  const ThinkingBlock = () => {
    if (!msg.thinking) return null;
    const isOpen = expandedThinking.has(msg.id);
    const isActive = !msg.content;

    return (
      <div className="mb-2 rounded-xl border border-sky-200 dark:border-sky-800/50 bg-sky-50/60 dark:bg-sky-950/20 overflow-hidden">
        {/* 标题栏 */}
        <button
          onClick={() => onToggleExpand(msg.id)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sky-100/50 dark:hover:bg-sky-900/20 transition-colors"
        >
          <span className="text-base leading-none select-none">🧠</span>
          <span className="text-xs font-medium text-sky-700 dark:text-sky-300 flex-1 text-left">
            {isActive ? (
              <span className="flex items-center gap-1.5">
                {t('message.thinking')}
                <span className="flex gap-0.5 items-center">
                  <span className="wave-dot w-1 h-1 rounded-full bg-primary-400 inline-block" />
                  <span className="wave-dot w-1 h-1 rounded-full bg-primary-400 inline-block" />
                  <span className="wave-dot w-1 h-1 rounded-full bg-primary-400 inline-block" />
                </span>
              </span>
            ) : isOpen ? t('message.thinkingProcess') : t('message.thinkingCollapsed')}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-primary-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* 呼吸进度条（仅流式时显示） */}
        {isActive && (
          <div className="relative h-0.5 bg-sky-100 dark:bg-sky-900/40 overflow-hidden mx-3 mb-1 rounded-full">
            <div className="thinking-bar absolute inset-y-0 left-0 bg-primary-400 dark:bg-primary-500 rounded-full" />
          </div>
        )}

        {/* 展开内容 — grid-rows trick */}
        <div className={`thinking-collapsible ${isOpen ? 'open' : ''}`}>
          <div>
            <div className="px-3 pb-3 pt-1">
              <pre className="text-xs text-sky-600/80 dark:text-primary-400/70 whitespace-pre-wrap font-normal leading-relaxed italic max-h-52 overflow-y-auto">
                {msg.thinking}
                {isActive && (
                  <span className="inline-block w-1.5 h-3.5 bg-primary-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                )}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── 渲染 ───────────────────────────────────────────────────────────────────────

  return (
    <div className={`flex gap-3 group ${isUser ? 'flex-row-reverse msg-user' : 'msg-assistant'}`}>
      {/* 头像 */}
      <div className="flex-shrink-0 mt-0.5">
        {isUser ? UserAvatar : AssistantAvatar}
      </div>

      {/* 消息内容区 */}
      <div className={`flex-1 min-w-0 ${isUser ? 'max-w-[80%] md:max-w-[70%]' : ''}`}>
        {/* 消息头 */}
        <div className={`flex items-center gap-2 mb-1.5 ${isUser ? 'justify-end' : ''}`}>
          {isUser && UserActions}
          <span className="text-xs text-gray-400 dark:text-gray-500 select-none">
            {isUser ? t('message.you', '你') : t('message.assistant', '助手')}
          </span>
        </div>

        {/* ── 用户气泡 ── */}
        {isUser ? (
          <div className="relative px-4 py-3 rounded-2xl bg-gradient-to-br from-primary-500 to-sky-600 text-white shadow-sm overflow-hidden">
            {/* grain 质感叠层 */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
                opacity: 0.6,
              }}
            />
            <div className="relative break-words whitespace-pre-wrap">{msg.content}</div>
          </div>
        ) : (
          /* ── AI 气泡 ── */
          <div className="px-4 py-3 rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50 shadow-sm backdrop-blur-sm overflow-hidden">
            <div className="space-y-1.5">
              {/* 思考过程 */}
              <ThinkingBlock />

              {/* Agent Teams 时间线 */}
              {msg.agentInvocations && msg.agentInvocations.length > 0 && (
                <AgentTimeline invocations={msg.agentInvocations} />
              )}

              {/* 工具调用时间轴 */}
              {msg.toolStatus && msg.toolStatus.length > 0 && (
                <ToolTimeline toolStatus={msg.toolStatus} />
              )}

              {/* 主内容 */}
              {msg.content.trim() || msg.thinking || (msg.toolStatus && msg.toolStatus.length > 0) ? (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:bg-gray-900 [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_code]:text-sm [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';
                        const codeContent = String(children).replace(/\n$/, '');
                        const isInline = !className;

                        // 检测 infographic 代码块
                        if (language === 'infographic' && !isInline && onInfographicDetected) {
                          // 对话框只显示简短提示，点击后打开画布
                          return (
                            <div
                              className="my-3 p-4 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800 cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                              onClick={() => onInfographicDetected(codeContent)}
                            >
                              <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                                <span className="text-lg">📊</span>
                                <span className="font-medium">{t('infographic.viewInCanvas', '在画布中查看信息图')}</span>
                              </div>
                              <p className="text-xs text-primary-500 dark:text-primary-500 mt-1">
                                {t('infographic.clickToView', '点击查看完整信息图')}
                              </p>
                            </div>
                          );
                        }

                        // 其他代码块保持原样
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >{msg.content}</ReactMarkdown>
                </div>
              ) : (
                /* 波形加载态 */
                <div className="flex items-center gap-1 py-1 px-0.5">
                  <span className="wave-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 inline-block" />
                  <span className="wave-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 inline-block" />
                  <span className="wave-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 inline-block" />
                </div>
              )}

              {/* 附件 */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="space-y-2 mt-2">
                  {msg.attachments.map(attachment => (
                    <FileAttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      onOpenCanvas={() => onOpenCanvas(attachment)}
                    />
                  ))}
                </div>
              )}

              {/* 技能调用链 */}
              {msg.skillChain && msg.skillChain.length > 0 && (
                <SkillChainDisplay skills={msg.skillChain} />
              )}
            </div>
          </div>
        )}

        {/* AI 操作按钮 + token 用量 */}
        {!isUser && (
          <div className="flex items-center justify-between">
            {AssistantActions}
            {msg.usage && (
              <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-80 transition-opacity duration-200">
                <span className="text-xs text-gray-400 dark:text-gray-500 select-none">
                  ↑ {msg.usage.inputTokens.toLocaleString()} · ↓ {msg.usage.outputTokens.toLocaleString()} tokens
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
