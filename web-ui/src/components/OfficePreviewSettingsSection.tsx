// web-ui/src/components/OfficePreviewSettingsSection.tsx
// Office 文件预览服务器地址配置

import { useState, useEffect } from 'react';
import { FileText, CheckCircle, AlertCircle, ExternalLink, RotateCcw } from 'lucide-react';
import { authFetch } from '../utils/auth';
import { cachedFetch, invalidateCache } from '../utils/configCache';

const DEFAULT_URL = 'https://officepreview.dsai.vip';
const CACHE_KEY = '/api/config/office-preview';

export function OfficePreviewSettingsSection() {
  const [currentUrl, setCurrentUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const data = await cachedFetch(CACHE_KEY, async () => {
        const res = await authFetch(CACHE_KEY);
        return res.json();
      }) as { url: string };
      setCurrentUrl(data.url || DEFAULT_URL);
      setInputUrl(data.url || DEFAULT_URL);
    } catch {
      setCurrentUrl(DEFAULT_URL);
      setInputUrl(DEFAULT_URL);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setErrorMsg('服务器地址不能为空');
      return;
    }
    if (!/^https?:\/\/.+/.test(trimmed)) {
      setErrorMsg('请输入有效的 URL（以 http:// 或 https:// 开头）');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch(CACHE_KEY, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentUrl(data.url);
        invalidateCache(CACHE_KEY);
        setSuccessMsg('保存成功');
      } else {
        setErrorMsg(data.error || '保存失败，请重试');
      }
    } catch {
      setErrorMsg('网络错误，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setInputUrl(DEFAULT_URL);
    setErrorMsg('');
    setSuccessMsg('');
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">加载中...</p>
      </div>
    );
  }

  const isModified = inputUrl.trim() !== currentUrl;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex divide-x divide-gray-200 dark:divide-gray-700 h-full">
        {/* 左侧：配置区 */}
        <div className="flex-1 p-6">
          <div className="max-w-md">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-primary-500" />
              <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">Office 预览服务器</h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              配置用于在线预览 Word、Excel、PowerPoint 文件的服务器地址。
            </p>

            {/* 当前地址 */}
            <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">当前：</span>
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 hover:underline truncate font-mono text-xs flex items-center gap-1"
              >
                {currentUrl}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>

            {/* 输入表单 */}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  服务器地址
                </label>
                <input
                  type="url"
                  value={inputUrl}
                  onChange={e => { setInputUrl(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                  placeholder="https://officepreview.dsai.vip"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>

              {/* 反馈信息 */}
              {errorMsg && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
              {successMsg && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={submitting || !isModified}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors text-sm"
                >
                  {submitting ? '保存中...' : '保存'}
                </button>
                {inputUrl !== DEFAULT_URL && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={submitting}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    title="恢复默认地址"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    恢复默认
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* 右侧：说明 */}
        <div className="w-72 flex-shrink-0 p-6 bg-gray-50 dark:bg-gray-800/50 overflow-y-auto">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">说明</h4>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>Office 预览服务器用于在浏览器中直接预览以下格式文件：</p>
            <ul className="space-y-1 ml-3">
              {['.docx / .doc', '.xlsx / .xls', '.pptx / .ppt'].map(ext => (
                <li key={ext} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                  <code className="text-xs font-mono">{ext}</code>
                </li>
              ))}
            </ul>
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 mt-4">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                默认使用公共预览服务 <code className="font-mono">officepreview.dsai.vip</code>。
                如需私有部署，可替换为自托管实例地址。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
