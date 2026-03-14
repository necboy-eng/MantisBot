// web-ui/src/components/SetupPage.tsx
// 首次初始化引导页：系统中无用户时显示，引导创建最高权限的 admin 账户
import { useState, useRef, useEffect, FormEvent } from 'react';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { setAuthToken } from '../utils/auth';
import { decodeAccessToken, AuthUser } from '../stores/auth-store.js';

interface SetupPageProps {
  onSetupComplete: (accessToken: string, user: AuthUser) => void;
}

export function SetupPage({ onSetupComplete }: SetupPageProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次密码不一致');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? '初始化失败，请重试');
        return;
      }
      const accessToken = data.accessToken ?? data.token ?? '';
      if (accessToken) setAuthToken(accessToken);
      const user = decodeAccessToken(accessToken) ?? {
        userId: '', username, roleId: 'role_admin', roleName: '管理员',
        permissions: ['*'], forcePasswordChange: false,
      };
      onSetupComplete(accessToken, user);
    } catch {
      setError('无法连接到服务器，请检查网络');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-green-100 dark:bg-green-900/30 rounded-2xl mb-4">
            <ShieldCheck className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">初始化 MantisBot</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 text-center">
            首次启动，请创建管理员账户
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 space-y-4">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">管理员账户拥有全部权限</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              包括管理用户、配置系统、访问所有功能。请妥善保管密码。
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              管理员用户名
            </label>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="例如：admin"
              required
              autoComplete="username"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              密码 <span className="text-gray-400 font-normal">（至少 8 位）</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* 密码强度指示 */}
            {password.length > 0 && (
              <div className="mt-1.5 flex gap-1">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      password.length < 8 ? (i === 0 ? 'bg-red-400' : 'bg-gray-200 dark:bg-gray-700') :
                      password.length < 12 ? (i < 2 ? 'bg-yellow-400' : 'bg-gray-200 dark:bg-gray-700') :
                      password.length < 16 ? (i < 3 ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700') :
                      'bg-green-400'
                    }`}
                  />
                ))}
                <span className="text-xs text-gray-400 ml-1">
                  {password.length < 8 ? '太短' : password.length < 12 ? '一般' : password.length < 16 ? '良好' : '强'}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              确认密码
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              required
              autoComplete="new-password"
              className={`w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent ${
                confirmPassword && confirmPassword !== password
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
              }`}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || password.length < 8 || password !== confirmPassword}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            {loading ? '创建中...' : '创建管理员账户'}
          </button>
        </form>
      </div>
    </div>
  );
}
