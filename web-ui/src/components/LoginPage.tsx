import { useState, useRef, useEffect, FormEvent } from 'react';
import { Bot, Lock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Terminal, KeyRound } from 'lucide-react';
import { setAuthToken } from '../utils/auth';
import { decodeAccessToken, AuthUser } from '../stores/auth-store.js';

type HealthStatus = 'checking' | 'online' | 'offline';

interface LoginPageProps {
  onLoginSuccess: (accessToken: string, user: AuthUser, forcePasswordChange: boolean) => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('checking');
  const [healthError, setHealthError] = useState('');
  const [showHealthDetail, setShowHealthDetail] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  // 强制改密状态
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const newPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (showChangePassword) {
      newPasswordRef.current?.focus();
    }
  }, [showChangePassword]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const checkHealth = async () => {
      try {
        const res = await fetch('/health', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          setHealthStatus('online');
          setHealthError('');
        } else {
          setHealthStatus('offline');
          setHealthError(`HTTP ${res.status} ${res.statusText}`);
        }
      } catch (err: unknown) {
        setHealthStatus('offline');
        const msg = err instanceof Error ? err.message : String(err);
        setHealthError(msg.includes('AbortError') || msg.includes('abort') ? '连接超时' : msg);
      }
      timer = setTimeout(checkHealth, 5000);
    };

    checkHealth();
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // authEnabled: false 表示后端未开启鉴权
        if (!data.authEnabled) {
          onLoginSuccess('', { userId: '', username: '', roleId: 'role_admin', roleName: '管理员', permissions: ['*'], forcePasswordChange: false }, false);
          return;
        }

        const accessToken = data.accessToken ?? data.token ?? '';

        // 需要强制修改密码
        if (data.forcePasswordChange) {
          setPendingToken(accessToken);
          setShowChangePassword(true);
          return;
        }

        if (accessToken) setAuthToken(accessToken);
        const user = decodeAccessToken(accessToken);
        onLoginSuccess(accessToken, user ?? { userId: '', username, roleId: 'role_member', roleName: '成员', permissions: [], forcePasswordChange: false }, false);
      } else {
        const errorMessages: Record<string, string> = {
          invalid_credentials: '账户或密码错误，请重试',
          account_locked: '账户已锁定，请 15 分钟后重试',
          account_disabled: '账户已被禁用，请联系管理员',
          temp_password_expired: '临时密码已过期，请联系管理员重置',
        };
        setError(errorMessages[data.error] ?? data.message ?? '登录失败，请稍后重试');
      }
    } catch {
      setError('无法连接到服务器，请检查网络');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码至少 8 位');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const user = pendingToken ? decodeAccessToken(pendingToken) : null;
      if (!user) {
        setError('会话已失效，请重新登录');
        setShowChangePassword(false);
        return;
      }

      const res = await fetch(`/api/users/${user.userId}/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });

      if (!res.ok) {
        setError('修改密码失败，请重试');
        return;
      }

      // 改完密码后重新登录
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password: newPassword }),
      });

      if (!loginRes.ok) {
        setError('密码已修改，请用新密码重新登录');
        setShowChangePassword(false);
        setPendingToken(null);
        return;
      }

      const loginData = await loginRes.json();
      const accessToken = loginData.accessToken ?? loginData.token ?? '';
      if (accessToken) setAuthToken(accessToken);
      const newUser = decodeAccessToken(accessToken);
      setPendingToken(null);
      onLoginSuccess(accessToken, newUser ?? { userId: user.userId, username, roleId: user.roleId, roleName: user.roleName, permissions: user.permissions, forcePasswordChange: false }, false);
    } catch {
      setError('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const healthIndicator = {
    checking: {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />,
      label: '检查中...',
      labelClass: 'text-gray-500 dark:text-gray-400',
    },
    online: {
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
      label: '后端在线',
      labelClass: 'text-green-600 dark:text-green-400',
    },
    offline: {
      icon: <XCircle className="w-3.5 h-3.5 text-red-500" />,
      label: '后端离线',
      labelClass: 'text-red-600 dark:text-red-400',
    },
  }[healthStatus];

  // ── 强制改密界面 ──────────────────────────────────────────────────────────────
  if (showChangePassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="p-4 bg-amber-100 dark:bg-amber-900/30 rounded-2xl mb-4">
              <KeyRound className="w-10 h-10 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">首次登录</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">请设置新密码以继续</p>
          </div>

          <form onSubmit={handleChangePassword} className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 space-y-4">
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              临时密码仅一次有效，请立即设置专属密码（至少 8 位）。
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                新密码
              </label>
              <input
                ref={newPasswordRef}
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="至少 8 位"
                required
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                确认新密码
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                required
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              {loading ? '提交中...' : '设置新密码'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── 常规登录界面 ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-primary-100 dark:bg-primary-900/30 rounded-2xl mb-4">
            <Bot className="w-10 h-10 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">MantisBot</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">请登录以继续使用</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              账户名
            </label>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入账户名"
              required
              autoComplete="username"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || healthStatus === 'offline'}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors"
          >
            <Lock className="w-4 h-4" />
            {loading ? '登录中...' : '登录'}
          </button>

          {/* Health status bar */}
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => healthStatus === 'offline' && setShowHealthDetail(v => !v)}
              className={`w-full flex items-center justify-between gap-2 text-xs py-1 rounded transition-colors ${
                healthStatus === 'offline'
                  ? 'cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30 px-1 -mx-1'
                  : 'cursor-default'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {healthIndicator.icon}
                <span className={healthIndicator.labelClass}>{healthIndicator.label}</span>
                {healthStatus === 'offline' && healthError && (
                  <span className="text-red-400 dark:text-red-500 truncate max-w-[160px]">— {healthError}</span>
                )}
              </span>
              {healthStatus === 'offline' && (
                showHealthDetail
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              )}
            </button>

            {/* Offline guidance panel */}
            {healthStatus === 'offline' && showHealthDetail && (
              <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 space-y-2">
                <p className="text-xs text-red-700 dark:text-red-300 font-medium">后端服务未启动</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  请在项目根目录执行以下命令启动后端：
                </p>
                <div className="flex items-start gap-2 bg-gray-900 dark:bg-black rounded-md px-3 py-2">
                  <Terminal className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <code className="text-xs text-green-400 font-mono break-all">npm start</code>
                </div>
                {healthError && (
                  <div className="text-xs text-red-500 dark:text-red-400 font-mono bg-red-100 dark:bg-red-950/40 rounded px-2 py-1 break-all">
                    {healthError}
                  </div>
                )}
                <p className="text-xs text-red-500 dark:text-red-400">
                  启动后页面将自动检测并恢复登录。
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
