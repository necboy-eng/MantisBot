// web-ui/src/components/PathAclDialog.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { X, Trash2, Plus, ShieldCheck } from 'lucide-react';

interface PathAclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: 'read' | 'write' | 'deny';
  createdAt: number;
}

interface Role {
  id: string;
  name: string;
}

interface User {
  id: string;
  username: string;
  displayName: string | null;
}

interface PathAclDialogProps {
  targetPath: string;
  storageId: string;
  onClose: () => void;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: '只读',
  write: '读写',
  deny: '拒绝',
};

const PERMISSION_COLORS: Record<string, string> = {
  read: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600',
  write: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600',
  deny: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-600',
};

export function PathAclDialog({ targetPath, storageId, onClose }: PathAclDialogProps) {
  const [entries, setEntries] = useState<PathAclEntry[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 新增表单状态
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    subjectType: 'role' as 'role' | 'user',
    subjectId: '',
    permission: 'read' as 'read' | 'write' | 'deny',
  });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    console.log('[PathAclDialog] load', { targetPath, storageId });
    try {
      const [aclRes, rolesRes, usersRes] = await Promise.all([
        authFetch(`/api/path-acl?path=${encodeURIComponent(targetPath)}&storageId=${encodeURIComponent(storageId)}`),
        authFetch('/api/roles'),
        authFetch('/api/users'),
      ]);
      const aclData = aclRes.ok ? await aclRes.json() : [];
      console.log('[PathAclDialog] aclRes status', aclRes.status, 'data', aclData);
      if (aclRes.ok) setEntries(aclData);
      if (rolesRes.ok) setRoles(await rolesRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // 初始化 subjectId
    setAddForm(f => ({ ...f, subjectId: '' }));
  }, [targetPath]);

  const handleDelete = async (id: number) => {
    const res = await authFetch(`/api/path-acl/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setEntries(prev => prev.filter(e => e.id !== id));
    } else {
      setError('删除失败');
    }
  };

  const handleAdd = async () => {
    setAddError('');
    if (!addForm.subjectId) {
      setAddError('请选择角色或用户');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/path-acl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType: addForm.subjectType,
          subjectId: addForm.subjectId,
          storageId,
          path: targetPath,
          permission: addForm.permission,
        }),
      });
      if (res.ok) {
        const entry = await res.json();
        // upsert 到本地列表
        setEntries(prev => {
          const idx = prev.findIndex(e => e.id === entry.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = entry;
            return copy;
          }
          return [...prev, entry];
        });
        setShowAdd(false);
        setAddForm({ subjectType: 'role', subjectId: '', permission: 'read' });
      } else {
        const data = await res.json();
        setAddError(data.error ?? '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const getSubjectName = (entry: PathAclEntry): string => {
    if (entry.subjectType === 'role') {
      return roles.find(r => r.id === entry.subjectId)?.name ?? entry.subjectId;
    }
    const u = users.find(u => u.id === entry.subjectId);
    return u ? (u.displayName ?? u.username) : entry.subjectId;
  };

  const selectClass =
    'w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        onClick={onClose}
      />

      {/* 对话框主体 */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">路径权限设置</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs" title={targetPath}>
                {targetPath}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">加载中...</div>
          ) : (
            <>
              {/* 当前规则列表 */}
              {entries.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-6 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                  该路径暂无自定义权限规则
                  <br />
                  <span className="text-xs">（未匹配规则时默认拒绝访问）</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* 类型标签 */}
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {entry.subjectType === 'role' ? '角色' : '用户'}
                        </span>
                        {/* 名称 */}
                        <span className="text-sm text-gray-900 dark:text-gray-100 font-medium truncate">
                          {getSubjectName(entry)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* 权限 badge */}
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PERMISSION_COLORS[entry.permission] ?? ''}`}>
                          {PERMISSION_LABELS[entry.permission] ?? entry.permission}
                        </span>
                        {/* 删除按钮 */}
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
                          title="删除此规则"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 添加规则表单 */}
              {showAdd ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">添加规则</h3>

                  {/* 主体类型 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAddForm(f => ({ ...f, subjectType: 'role', subjectId: '' }))}
                      className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${
                        addForm.subjectType === 'role'
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      角色
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddForm(f => ({ ...f, subjectType: 'user', subjectId: '' }))}
                      className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${
                        addForm.subjectType === 'user'
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      用户
                    </button>
                  </div>

                  {/* 选择角色/用户 */}
                  <select
                    className={selectClass}
                    value={addForm.subjectId}
                    onChange={e => setAddForm(f => ({ ...f, subjectId: e.target.value }))}
                  >
                    <option value="">-- 请选择 --</option>
                    {addForm.subjectType === 'role'
                      ? roles.filter(r => r.id !== 'role_admin').map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))
                      : users.map(u => (
                          <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>
                        ))
                    }
                  </select>

                  {/* 选择权限 */}
                  <select
                    className={selectClass}
                    value={addForm.permission}
                    onChange={e => setAddForm(f => ({ ...f, permission: e.target.value as 'read' | 'write' | 'deny' }))}
                  >
                    <option value="read">只读（read）</option>
                    <option value="write">读写（write）</option>
                    <option value="deny">拒绝（deny）</option>
                  </select>

                  {addError && (
                    <p className="text-xs text-red-500 dark:text-red-400">{addError}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleAdd}
                      disabled={saving}
                      className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      {saving ? '保存中...' : '确认添加'}
                    </button>
                    <button
                      onClick={() => { setShowAdd(false); setAddError(''); }}
                      className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-4 py-1.5 rounded-lg text-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setShowAdd(true); setAddError(''); }}
                  className="w-full flex items-center justify-center gap-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 py-2.5 rounded-lg text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加权限规则
                </button>
              )}

              {/* 说明 */}
              <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1 pt-1">
                <p>• 规则采用最长前缀匹配，更具体的路径规则优先</p>
                <p>• 用户规则优先于角色规则</p>
                <p>• 管理员（role_admin）始终拥有完全权限</p>
                <p>• 无匹配规则时默认<strong>拒绝</strong>访问</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
