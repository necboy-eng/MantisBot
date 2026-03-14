// web-ui/src/components/UserManagementSection.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { usePermission } from '../hooks/usePermission.js';
import { ShieldOff } from 'lucide-react';

interface User {
  id: string;
  username: string;
  roleId: string;
  displayName: string | null;
  email: string | null;
  isEnabled: number;
  forcePasswordChange: number;
  createdAt: number;
}

interface Role {
  id: string;
  name: string;
}

export function UserManagementSection() {
  const canManage = usePermission('manageUsers');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', roleId: 'role_member', displayName: '' });
  const [createError, setCreateError] = useState('');
  const [resetResult, setResetResult] = useState<{ userId: string; tempPassword: string } | null>(null);
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null);
  const [savingRoleUserId, setSavingRoleUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        authFetch('/api/users'),
        authFetch('/api/roles'),
      ]);
      setUsers(await usersRes.json());
      setRoles(await rolesRes.json());
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
          <ShieldOff className="w-10 h-10 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-1">无访问权限</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs">
          当前账号没有用户管理权限，请联系管理员。
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    setCreateError('');
    const res = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    });
    if (res.ok) {
      setShowCreate(false);
      setCreateForm({ username: '', password: '', roleId: 'role_member', displayName: '' });
      await load();
    } else {
      const data = await res.json();
      setCreateError(data.error ?? '创建失败');
    }
  };

  const handleToggleEnabled = async (user: User) => {
    await authFetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: user.isEnabled === 1 ? 0 : 1 }),
    });
    await load();
  };

  const handleResetPassword = async (userId: string) => {
    const res = await authFetch(`/api/users/${userId}/reset-password`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setResetResult({ userId, tempPassword: data.tempPassword });
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('确认删除该用户？此操作不可撤销')) return;
    const res = await authFetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      await load();
    } else {
      const data = await res.json();
      alert(data.error ?? '删除失败');
    }
  };

  const handleRoleChange = async (userId: string, newRoleId: string) => {
    setSavingRoleUserId(userId);
    try {
      const res = await authFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: newRoleId }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, roleId: newRoleId } : u));
      } else {
        const data = await res.json();
        alert(data.error ?? '修改角色失败');
      }
    } finally {
      setSavingRoleUserId(null);
      setEditingRoleUserId(null);
    }
  };

  const inputClass = 'w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  if (loading) return (
    <div className="text-gray-500 dark:text-gray-400 text-sm p-4">加载中...</div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* 标题栏 */}
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">用户管理</h2>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
          className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          + 新建用户
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* 重置密码结果提示 */}
      {resetResult && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-200 mb-1.5">临时密码（仅显示一次，请立即告知用户）</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg font-mono text-gray-900 dark:text-gray-100 text-sm tracking-wider">
              {resetResult.tempPassword}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(resetResult.tempPassword)}
              className="text-xs px-2 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              复制
            </button>
            <button
              onClick={() => setResetResult(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 新建用户表单 */}
      {showCreate && (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">新建用户</h3>
          <input
            className={inputClass}
            placeholder="用户名"
            value={createForm.username}
            onChange={e => setCreateForm({ ...createForm, username: e.target.value })}
          />
          <input
            type="password"
            className={inputClass}
            placeholder="初始密码"
            value={createForm.password}
            onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
          />
          <select
            className={inputClass}
            value={createForm.roleId}
            onChange={e => setCreateForm({ ...createForm, roleId: e.target.value })}
          >
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {createError && (
            <p className="text-xs text-red-500 dark:text-red-400">{createError}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              确认创建
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateError(''); }}
              className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-4 py-1.5 rounded-lg text-sm transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 用户列表 */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2.5 px-4 font-medium text-gray-600 dark:text-gray-400">用户名</th>
              <th className="text-left py-2.5 px-4 font-medium text-gray-600 dark:text-gray-400">角色</th>
              <th className="text-left py-2.5 px-4 font-medium text-gray-600 dark:text-gray-400">状态</th>
              <th className="text-left py-2.5 px-4 font-medium text-gray-600 dark:text-gray-400">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="py-2.5 px-4 text-gray-900 dark:text-gray-100 font-medium">{user.username}</td>
                <td className="py-2.5 px-4 text-gray-600 dark:text-gray-400">
                  {editingRoleUserId === user.id ? (
                    <select
                      autoFocus
                      defaultValue={user.roleId}
                      disabled={savingRoleUserId === user.id}
                      onChange={e => handleRoleChange(user.id, e.target.value)}
                      onBlur={() => setEditingRoleUserId(null)}
                      className="text-sm px-2 py-1 rounded-lg border border-primary-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {roles.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setEditingRoleUserId(user.id)}
                      title="点击修改角色"
                      className="group flex items-center gap-1 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {roles.find(r => r.id === user.roleId)?.name ?? user.roleId}
                      <span className="opacity-0 group-hover:opacity-100 text-xs text-primary-500 transition-opacity">✎</span>
                    </button>
                  )}
                </td>
                <td className="py-2.5 px-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    user.isEnabled === 1
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  }`}>
                    {user.isEnabled === 1 ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggleEnabled(user)}
                      className={`text-xs hover:underline ${user.isEnabled === 1 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}
                    >
                      {user.isEnabled === 1 ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleResetPassword(user.id)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      重置密码
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-xs text-red-500 dark:text-red-400 hover:underline"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  暂无用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
