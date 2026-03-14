import { useState, useEffect } from 'react';
import { Plus, Trash2, FolderOpen, Info, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authFetch } from '../utils/auth';

interface AclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: 'read' | 'write' | 'deny';
  createdAt: number;
}

interface Subject {
  id: string;
  name?: string;
  username?: string;
  displayName?: string;
  type: 'role' | 'user';
}

interface PermissionOption {
  value: 'read' | 'write' | 'deny';
  label: string;
  color: string;
}

export function PathAclSection() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AclEntry[]>([]);
  const [subjects, setSubjects] = useState<{ roles: Subject[]; users: Subject[] }>({ roles: [], users: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [newPath, setNewPath] = useState('');
  const [newSubjectType, setNewSubjectType] = useState<'role' | 'user'>('role');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newPermission, setNewPermission] = useState<'read' | 'write' | 'deny'>('read');

  const permissionOptions: PermissionOption[] = [
    { value: 'read', label: t('pathAcl.permissionRead'), color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    { value: 'write', label: t('pathAcl.permissionWrite'), color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    { value: 'deny', label: t('pathAcl.permissionDeny'), color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, subjectsRes] = await Promise.all([
        authFetch('/api/path-acl/all'),
        authFetch('/api/path-acl/subjects'),
      ]);

      if (entriesRes.ok) {
        const data = await entriesRes.json();
        setEntries(data);
      } else {
        const errData = await entriesRes.json().catch(() => ({ error: 'Unknown error' }));
        if (entriesRes.status === 403) {
          setError(t('pathAcl.noPermission') || '您没有权限管理目录访问控制（需要 manageUsers 权限）');
        } else {
          setError(errData.error || errData.message || 'Failed to fetch ACL rules');
        }
      }

      if (subjectsRes.ok) {
        const data = await subjectsRes.json();
        setSubjects(data);
      }
    } catch (err) {
      console.error('Failed to fetch ACL data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch ACL data');
    } finally {
      setLoading(false);
    }
  }

  async function addEntry() {
    if (!newPath.trim() || !newSubjectId) return;

    const entry = {
      subjectType: newSubjectType,
      subjectId: newSubjectId,
      storageId: 'local',
      path: newPath.trim(),
      permission: newPermission,
    };

    setSaving(true);
    try {
      const res = await authFetch('/api/path-acl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });

      if (res.ok) {
        await fetchData();
        setNewPath('');
        setNewSubjectId('');
        setNewPermission('read');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add ACL rule');
      }
    } catch (err) {
      console.error('Failed to add ACL entry:', err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm(t('pathAcl.confirmDelete'))) return;

    setSaving(true);
    try {
      const res = await authFetch(`/api/path-acl/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setEntries(entries.filter(e => e.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete ACL entry:', err);
    } finally {
      setSaving(false);
    }
  }

  function togglePath(path: string) {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  }

  // Group entries by path
  const entriesByPath = entries.reduce((acc, entry) => {
    if (!acc[entry.path]) acc[entry.path] = [];
    acc[entry.path].push(entry);
    return acc;
  }, {} as Record<string, AclEntry[]>);

  function getSubjectName(entry: AclEntry): string {
    if (entry.subjectType === 'role') {
      const role = subjects.roles.find(r => r.id === entry.subjectId);
      return role?.name || entry.subjectId;
    } else {
      const user = subjects.users.find(u => u.id === entry.subjectId);
      return user?.displayName || user?.username || entry.subjectId;
    }
  }

  function getPermissionColor(permission: string): string {
    const option = permissionOptions.find(o => o.value === permission);
    return option?.color || '';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">{t('pathAcl.loading')}</div>
      </div>
    );
  }

  // 显示错误信息（如权限不足）
  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-800 dark:text-red-300">
              <p className="font-medium mb-1">{t('pathAcl.error') || '加载失败'}</p>
              <p>{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-medium mb-1">{t('pathAcl.title')}</p>
            <p>{t('pathAcl.description')}</p>
          </div>
        </div>
      </div>

      {/* Add new rule form */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('pathAcl.addRule')}</h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Path input */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pathAcl.path')}
            </label>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/path/to/directory"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Subject type selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pathAcl.subjectType')}
            </label>
            <select
              value={newSubjectType}
              onChange={(e) => {
                setNewSubjectType(e.target.value as 'role' | 'user');
                setNewSubjectId('');
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="role">{t('pathAcl.role')}</option>
              <option value="user">{t('pathAcl.user')}</option>
            </select>
          </div>

          {/* Subject selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pathAcl.subject')}
            </label>
            <select
              value={newSubjectId}
              onChange={(e) => setNewSubjectId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t('pathAcl.selectSubject')}</option>
              {newSubjectType === 'role' ? (
                subjects.roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))
              ) : (
                subjects.users.map(u => (
                  <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Permission selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('pathAcl.permission')}
            </label>
            <select
              value={newPermission}
              onChange={(e) => setNewPermission(e.target.value as 'read' | 'write' | 'deny')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {permissionOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Add button */}
          <div className="md:col-span-3 flex items-end">
            <button
              onClick={addEntry}
              disabled={saving || !newPath.trim() || !newSubjectId}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('pathAcl.add')}
            </button>
          </div>
        </div>
      </div>

      {/* ACL rules list grouped by path */}
      <div className="space-y-2">
        {Object.keys(entriesByPath).length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('pathAcl.noData')}</p>
            <p className="text-sm mt-1">{t('pathAcl.noDataHint')}</p>
          </div>
        ) : (
          Object.entries(entriesByPath).map(([path, pathEntries]) => (
            <div key={path} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {/* Path header */}
              <button
                onClick={() => togglePath(path)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedPaths.has(path) ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  )}
                  <FolderOpen className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                  <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{path}</span>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {pathEntries.length} {pathEntries.length === 1 ? t('pathAcl.rule') : t('pathAcl.rules')}
                </span>
              </button>

              {/* Entries for this path */}
              {expandedPaths.has(path) && (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {pathEntries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-1 rounded ${entry.subjectType === 'role' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}>
                          {entry.subjectType === 'role' ? t('pathAcl.role') : t('pathAcl.user')}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          {getSubjectName(entry)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-1 rounded ${getPermissionColor(entry.permission)}`}>
                          {permissionOptions.find(o => o.value === entry.permission)?.label}
                        </span>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          disabled={saving}
                          className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Permission explanation */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-2">
        <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('pathAcl.permissionTypes')}</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <span className="inline-block w-16 text-blue-700 dark:text-blue-300 font-medium">{t('pathAcl.permissionRead')}</span>
            <span className="text-gray-600 dark:text-gray-400">{t('pathAcl.permissionReadDesc')}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-block w-16 text-green-700 dark:text-green-300 font-medium">{t('pathAcl.permissionWrite')}</span>
            <span className="text-gray-600 dark:text-gray-400">{t('pathAcl.permissionWriteDesc')}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-block w-16 text-red-700 dark:text-red-300 font-medium">{t('pathAcl.permissionDeny')}</span>
            <span className="text-gray-600 dark:text-gray-400">{t('pathAcl.permissionDenyDesc')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
