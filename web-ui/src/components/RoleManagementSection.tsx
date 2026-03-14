// web-ui/src/components/RoleManagementSection.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { usePermission } from '../hooks/usePermission.js';

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, boolean>;  // API 返回已解析的对象
  isBuiltin: number;
}

const AVAILABLE_PERMISSIONS = [
  { key: 'chat',           label: '使用对话' },
  { key: 'viewHistory',    label: '查看历史' },
  { key: 'useAgentTeams',  label: '使用 Agent 组' },
  { key: 'useFileManager', label: '管理文件' },
  { key: 'editModelConfig',  label: '编辑模型配置' },
  { key: 'editServerConfig', label: '编辑服务器配置' },
  { key: 'installSkills',    label: '安装 Skill' },
  { key: 'managePlugins',    label: '管理插件' },
  { key: 'manageUsers',      label: '管理用户' },
];

export function RoleManagementSection() {
  const canManage = usePermission('manageUsers');
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  const load = async () => {
    const res = await authFetch('/api/roles');
    if (res.ok) setRoles(await res.json());
  };

  useEffect(() => { load(); }, []);

  if (!canManage) return null; // UserManagementSection 已处理无权限提示，此处不重复渲染

  const handleEdit = (role: Role) => {
    setEditing(role.id);
    setEditPerms({ ...role.permissions });
  };

  const handleSave = async (roleId: string) => {
    const res = await authFetch(`/api/roles/${roleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: editPerms }),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const data = await res.json();
      setError(data.error ?? '保存失败');
    }
  };

  const togglePerm = (key: string) => {
    setEditPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">角色权限管理</h2>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {roles.map(role => {
          let perms: Record<string, boolean> = role.permissions ?? {};
          const isEditing = editing === role.id;
          const isAdmin = role.id === 'role_admin';
          const currentPerms = isEditing ? editPerms : perms;

          return (
            <div
              key={role.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800/50"
            >
              {/* 角色标题行 */}
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{role.name}</span>
                  {role.isBuiltin === 1 && (
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                      内置
                    </span>
                  )}
                </div>
                {!isAdmin && (
                  isEditing ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(role.id)}
                        className="text-xs bg-primary-600 hover:bg-primary-700 text-white px-3 py-1 rounded-lg transition-colors"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 px-3 py-1 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEdit(role)}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      编辑
                    </button>
                  )
                )}
              </div>

              {/* 权限 badges */}
              <div className="flex flex-wrap gap-1.5">
                {isAdmin ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">全部权限（不可编辑）</span>
                ) : (
                  AVAILABLE_PERMISSIONS.map(({ key, label }) => {
                    const active = currentPerms[key] === true;
                    const clickable = isEditing;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => clickable && togglePerm(key)}
                        disabled={!clickable}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-300'
                            : 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500'
                        } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                      >
                        {label}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
