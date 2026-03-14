// web-ui/src/components/PathAclEditor.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { usePermission } from '../hooks/usePermission.js';

interface PathAclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: 'read' | 'write' | 'deny';
}

interface PathAclEditorProps {
  subjectType: 'role' | 'user';
  subjectId: string;
  subjectName: string;
  storageId?: string;
}

export function PathAclEditor({ subjectType, subjectId, subjectName, storageId = 'local' }: PathAclEditorProps) {
  const canManage = usePermission('manageUsers');
  const [entries, setEntries] = useState<PathAclEntry[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newPermission, setNewPermission] = useState<'read' | 'write' | 'deny'>('read');

  const load = async () => {
    const param = subjectType === 'role' ? `roleId=${subjectId}` : `userId=${subjectId}`;
    const res = await authFetch(`/api/path-acl?${param}&storageId=${storageId}`);
    setEntries(await res.json());
  };

  useEffect(() => { if (canManage) load(); }, [subjectId, storageId]);

  if (!canManage) return null;

  const handleAdd = async () => {
    if (!newPath.startsWith('/')) {
      alert('路径必须以 / 开头');
      return;
    }
    const endpoint = subjectType === 'role' ? '/api/path-acl/role' : '/api/path-acl/user';
    const body = subjectType === 'role'
      ? { roleId: subjectId, storageId, path: newPath, permission: newPermission }
      : { userId: subjectId, storageId, path: newPath, permission: newPermission };
    await authFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setNewPath('');
    await load();
  };

  const handleDelete = async (id: number) => {
    await authFetch(`/api/path-acl/${id}`, { method: 'DELETE' });
    await load();
  };

  const permLabel = { read: '只读', write: '读写', deny: '禁止' };
  const permClass = {
    read: 'bg-blue-100 text-blue-700',
    write: 'bg-green-100 text-green-700',
    deny: 'bg-red-100 text-red-700',
  };

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium mb-2">
        {subjectName} 的路径权限 <span className="text-gray-400">({storageId})</span>
      </h4>
      <div className="space-y-1 mb-3">
        {entries.length === 0 && (
          <p className="text-xs text-gray-400">无特殊路径规则（默认拒绝）</p>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
            <span className="font-mono">{entry.path}</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${permClass[entry.permission]}`}>
                {permLabel[entry.permission]}
              </span>
              <button onClick={() => handleDelete(entry.id)} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm font-mono"
          placeholder="/path/to/directory"
          value={newPath}
          onChange={e => setNewPath(e.target.value)}
        />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={newPermission}
          onChange={e => setNewPermission(e.target.value as 'read' | 'write' | 'deny')}
        >
          <option value="read">只读</option>
          <option value="write">读写</option>
          <option value="deny">禁止</option>
        </select>
        <button onClick={handleAdd} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">添加</button>
      </div>
    </div>
  );
}
