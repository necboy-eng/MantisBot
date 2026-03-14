// web-ui/src/components/AuthSettingsSection.tsx
// 修改密码：当前登录用户修改自己的账户密码

import { useState, useContext } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/auth';
import { AuthContext } from '../contexts/AuthContext';

export function AuthSettingsSection() {
  const { state } = useContext(AuthContext);
  const userId = state.user?.userId;
  const username = state.user?.username ?? '';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // 密码强度
  const strength =
    newPassword.length === 0 ? null :
    newPassword.length < 8   ? 'weak' :
    newPassword.length < 12  ? 'fair' :
    newPassword.length < 16  ? 'good' : 'strong';

  const strengthLabel = { weak: '太短', fair: '一般', good: '良好', strong: '强' };
  const strengthColor = { weak: 'bg-red-400', fair: 'bg-yellow-400', good: 'bg-blue-400', strong: 'bg-green-400' };
  const strengthBars  = { weak: 1, fair: 2, good: 3, strong: 4 };

  // auth 未启用时没有用户体系，显示提示
  if (!state.authEnabled) {
    return (
      <div className="p-6 max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="w-5 h-5 text-gray-400" />
          <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">修改密码</h3>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            当前未启用用户鉴权，无需密码即可访问。如需启用，请在{' '}
            <code className="font-mono text-xs bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">config.json</code>
            {' '}中设置 <code className="font-mono text-xs bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">server.auth.enabled = true</code>。
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (newPassword !== confirmPassword) {
      setErrorMsg('两次密码不一致');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('新密码至少 8 位');
      return;
    }
    if (!userId) {
      setErrorMsg('未获取到用户信息，请重新登录');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch(`/api/users/${userId}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('密码已修改成功');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setErrorMsg(data.message || data.error || '修改失败，请重试');
      }
    } catch {
      setErrorMsg('网络错误，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm';

  return (
    <div className="p-6 max-w-md">
      <div className="flex items-center gap-3 mb-2">
        <Lock className="w-5 h-5 text-primary-500" />
        <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">修改密码</h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        当前账户：<span className="font-medium text-gray-700 dark:text-gray-300">{username}</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 当前密码 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            当前密码 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码"
              required
              autoComplete="current-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowCurrent(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* 新密码 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            新密码 <span className="text-gray-400 font-normal">（至少 8 位）</span>
            <span className="text-red-500"> *</span>
          </label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="请输入新密码"
              required
              autoComplete="new-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowNew(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {/* 密码强度条 */}
          {strength && (
            <div className="mt-1.5 flex items-center gap-1">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i < strengthBars[strength] ? strengthColor[strength] : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ))}
              <span className="text-xs text-gray-400 ml-1">{strengthLabel[strength]}</span>
            </div>
          )}
        </div>

        {/* 确认新密码 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            确认新密码 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              required
              autoComplete="new-password"
              className={`w-full px-3 py-2 pr-10 rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent text-sm ${
                confirmPassword && confirmPassword !== newPassword
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* 反馈 */}
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

        <button
          type="submit"
          disabled={submitting || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
          className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {submitting ? '修改中...' : '确认修改'}
        </button>
      </form>
    </div>
  );
}
