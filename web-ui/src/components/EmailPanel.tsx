import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Folder, Paperclip, Download, ChevronDown, ChevronRight, RefreshCw, User, ArrowLeft, Circle, MessageSquarePlus } from 'lucide-react';
import { authFetch } from '../utils/auth';
import type { EmailReference } from '../types/context-reference';

interface EmailAccount {
  id: string;
  name: string;
  email: string;
  provider: string;
  isDefault: boolean;
}

interface Mailbox {
  name: string;
  delimiter: string;
  attributes: string[];
}

interface Attachment {
  filename: string;
  contentType: string;
  size: number;
}

interface EmailMessage {
  uid: number;
  from: string;
  to?: string;
  subject: string;
  date: string;
  text?: string;
  html?: string;
  snippet: string;
  flags?: string[];
  attachments?: Attachment[];
}

export function EmailPanel({ onAddEmailReference, onSendProgrammatic: _onSendProgrammatic }: {
  onAddEmailReference?: (ref: EmailReference) => void;
  onSendProgrammatic?: (message: string) => void;
}) {
  const { t } = useTranslation();

  // 账户列表
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>(undefined);

  // 文件夹列表
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [currentMailbox, setCurrentMailbox] = useState('INBOX');

  // 邮件列表
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // 选中的邮件
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailMessage | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; email: EmailMessage } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 30;

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, email: EmailMessage) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, email });
  }, []);

  const handleAddToChat = useCallback((email: EmailMessage) => {
    setContextMenu(null);
    onAddEmailReference?.({
      source: 'email',
      id: `email-${email.uid}-${Date.now()}`,
      name: email.subject || t('email.noSubject', '(无主题)'),
      addedAt: Date.now(),
      uid: email.uid,
      mailbox: currentMailbox,
      accountId: currentAccountId,
      subject: email.subject,
      from: email.from,
      date: email.date,
      hasAttachments: !!(email.attachments && email.attachments.length > 0),
    });
  }, [onAddEmailReference, currentMailbox, currentAccountId, t]);

  // 加载账户列表
  useEffect(() => {
    fetchAccounts();
  }, []);

  // 加载文件夹列表
  useEffect(() => {
    if (currentAccountId) {
      fetchMailboxes();
    }
  }, [currentAccountId]);

  // 加载邮件列表
  useEffect(() => {
    if (currentAccountId && currentMailbox) {
      fetchEmails(true);
    }
  }, [currentAccountId, currentMailbox]);

  async function fetchAccounts() {
    try {
      const res = await authFetch('/api/emails/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      const data = await res.json();
      setAccounts(data);

      // 设置默认账户
      const defaultAccount = data.find((a: EmailAccount) => a.isDefault);
      if (defaultAccount) {
        setCurrentAccountId(defaultAccount.id);
      } else if (data.length > 0) {
        setCurrentAccountId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }

  async function fetchMailboxes() {
    try {
      const url = currentAccountId
        ? `/api/emails/mailboxes?accountId=${encodeURIComponent(currentAccountId)}`
        : '/api/emails/mailboxes';
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Failed to fetch mailboxes');
      const data = await res.json();
      setMailboxes(data);
    } catch (err) {
      console.error('Failed to fetch mailboxes:', err);
    }
  }

  async function fetchEmails(reset = false) {
    try {
      if (reset) {
        setLoading(true);
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      const offset = reset ? 0 : emails.length;
      const res = await authFetch('/api/emails/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: currentAccountId,
          mailbox: currentMailbox,
          limit: PAGE_SIZE,
          offset,
        }),
      });

      if (!res.ok) throw new Error('Failed to fetch emails');
      const data = await res.json();

      if (reset) {
        setEmails(data);
      } else {
        setEmails(prev => [...prev, ...data]);
      }

      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function fetchEmailDetail(uid: number) {
    try {
      setLoadingDetail(true);
      const url = `/api/emails/${uid}?accountId=${encodeURIComponent(currentAccountId || '')}&mailbox=${encodeURIComponent(currentMailbox)}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Failed to fetch email');
      const data = await res.json();
      setEmailDetail(data);

      // 标记为已读
      if (selectedEmail && selectedEmail.flags && !selectedEmail.flags.includes('\\Seen')) {
        markAsRead(uid);
      }
    } catch (err) {
      console.error('Failed to fetch email detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function markAsRead(uid: number) {
    try {
      await authFetch(`/api/emails/${uid}/read`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: currentAccountId,
          mailbox: currentMailbox,
        }),
      });

      // 更新本地状态
      setEmails(prev => prev.map(e =>
        e.uid === uid
          ? { ...e, flags: [...(e.flags || []), '\\Seen'] }
          : e
      ));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  }

  async function downloadAttachment(filename: string) {
    if (!selectedEmail) return;
    const url = `/api/emails/${selectedEmail.uid}/attachments/${encodeURIComponent(filename)}?accountId=${encodeURIComponent(currentAccountId || '')}&mailbox=${encodeURIComponent(currentMailbox)}`;
    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Failed to download attachment:', err);
    }
  }

  function handleEmailClick(email: EmailMessage) {
    setSelectedEmail(email);
    fetchEmailDetail(email.uid);
  }

  function handleBack() {
    setSelectedEmail(null);
    setEmailDetail(null);
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getMailboxIcon(name: string) {
    const lower = name.toLowerCase();
    if (lower === 'inbox') return <Folder className="w-4 h-4" />;
    if (lower.includes('sent')) return <Folder className="w-4 h-4" />;
    if (lower.includes('trash') || lower.includes('垃圾')) return <Folder className="w-4 h-4" />;
    if (lower.includes('draft') || lower.includes('草稿')) return <Folder className="w-4 h-4" />;
    return <Folder className="w-4 h-4" />;
  }

  function extractDomain(from: string) {
    const match = from.match(/@([^>]+)/);
    return match ? match[1] : from;
  }

  // 没有账户
  if (accounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{t('email.noAccount', '暂无邮箱账户')}</p>
          <p className="text-sm mt-1">{t('email.configureHint', '请在设置中配置邮箱账户')}</p>
        </div>
      </div>
    );
  }

  // 邮件详情视图
  if (selectedEmail && emailDetail) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* 顶部导航 */}
        <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={handleBack}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4 dark:text-white" />
          </button>
          <span className="text-sm font-medium truncate flex-1 dark:text-white">
            {emailDetail.subject}
          </span>
        </div>

        {loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        ) : (
          <>
            {/* 邮件头信息 */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 overflow-auto">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {extractDomain(emailDetail.from)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {formatDate(emailDetail.date)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {emailDetail.from}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {t('email.to', '收件人')}: {emailDetail.to || '-'}
                  </div>
                </div>
              </div>
            </div>

            {/* 邮件正文 */}
            <div className="flex-1 overflow-auto">
              {emailDetail.html ? (
                <iframe
                  srcDoc={emailDetail.html}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts"
                  title="Email HTML"
                />
              ) : (
                <pre className="p-4 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono">
                  {emailDetail.text || '(无内容)'}
                </pre>
              )}
            </div>

            {/* 附件区域 */}
            {emailDetail.attachments && emailDetail.attachments.length > 0 && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <div className="flex items-center gap-1 mb-2">
                  <Paperclip className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('email.attachments', '附件')} ({emailDetail.attachments.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {emailDetail.attachments.map((att, idx) => (
                    <button
                      key={idx}
                      onClick={() => downloadAttachment(att.filename)}
                      className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      <Paperclip className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[150px]">
                        {att.filename}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatFileSize(att.size)}
                      </span>
                      <Download className="w-4 h-4 text-primary-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // 邮件列表视图
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* 账户切换 */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <select
            value={currentAccountId || ''}
            onChange={(e) => setCurrentAccountId(e.target.value || undefined)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg appearance-none text-sm dark:text-white pr-8"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.email})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 文件夹列表 */}
        <div className="w-36 border-r border-gray-200 dark:border-gray-700 overflow-auto flex-shrink-0">
          {mailboxes.map((box, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentMailbox(box.name)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                currentMailbox === box.name
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {currentMailbox === box.name ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <Circle className="w-3.5 h-3.5 opacity-0" />
              )}
              {getMailboxIcon(box.name)}
              <span className="truncate">{box.name}</span>
            </button>
          ))}
        </div>

        {/* 邮件列表 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 刷新按钮 */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              onClick={() => fetchEmails(true)}
              disabled={loading}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 dark:text-white ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading && emails.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Mail className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('email.empty', '邮件夹为空')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-auto">
                {emails.map((email) => (
                  <button
                    key={email.uid}
                    onClick={() => handleEmailClick(email)}
                    onContextMenu={(e) => handleContextMenu(e, email)}
                    className={`w-full text-left p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                      selectedEmail?.uid === email.uid ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate flex-1 ${
                        email.flags?.includes('\\Seen') ? 'text-gray-600 dark:text-gray-400' : 'font-medium text-gray-900 dark:text-gray-100'
                      }`}>
                        {extractDomain(email.from)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {formatDate(email.date)}
                      </span>
                    </div>
                    <div className={`text-sm truncate mt-0.5 ${
                      email.flags?.includes('\\Seen') ? 'text-gray-500 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'
                    }`}>
                      {email.subject}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {email.snippet}
                      </span>
                      {email.attachments && email.attachments.length > 0 && (
                        <Paperclip className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* 加载更多 */}
              {hasMore && (
                <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => fetchEmails(false)}
                    disabled={loadingMore}
                    className="w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    {loadingMore ? t('email.loading', '加载中...') : t('email.loadMore', '加载更多')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[150px]"
        >
          <button
            onClick={() => handleAddToChat(contextMenu.email)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 dark:text-white"
          >
            <MessageSquarePlus className="w-4 h-4" />
            {t('email.addToChat', '添加到对话')}
          </button>
        </div>
      )}
    </div>
  );
}
