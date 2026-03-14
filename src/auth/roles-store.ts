// src/auth/roles-store.ts
import { getSystemDb, type SystemDb } from './db.js';
import { v4 as uuidv4 } from 'uuid';

export interface Role {
  id: string;
  name: string;
  description?: string;
  isBuiltin: number;
  permissions: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  isBuiltin?: number;
}

const BUILTIN_ROLES: Array<{ id: string; name: string; description: string; permissions: Record<string, boolean> }> = [
  {
    id: 'role_admin',
    name: '管理员',
    description: '系统超级管理员，拥有所有权限',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: true,
      editModelConfig: true,
      editServerConfig: true,
      manageUsers: true,
      useFileManager: true,
      accessStorage: true,
      installSkills: true,
      managePlugins: true,
    },
  },
  {
    id: 'role_member',
    name: '普通成员',
    description: '普通团队成员',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: true,
      useFileManager: true,
      editModelConfig: false,
      editServerConfig: false,
      manageUsers: false,
      accessStorage: false,
      installSkills: false,
      managePlugins: false,
    },
  },
  {
    id: 'role_viewer',
    name: '访客',
    description: '只读访客',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: false,
      useFileManager: false,
      editModelConfig: false,
      editServerConfig: false,
      manageUsers: false,
      accessStorage: false,
      installSkills: false,
      managePlugins: false,
    },
  },
];

/**
 * 初始化内置角色（首次启动时调用）
 */
export function initBuiltinRoles(): void {
  const db = getSystemDb();
  const now = Date.now();

  for (const builtin of BUILTIN_ROLES) {
    const existing = db.prepare('SELECT id FROM roles WHERE id = ?').get(builtin.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO roles (id, name, description, is_builtin, permissions, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(
        builtin.id,
        builtin.name,
        builtin.description,
        JSON.stringify(builtin.permissions),
        now,
        now
      );
    }
  }
}

export function getRoleById(id: string): Role | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRoleByName(name: string): Role | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM roles WHERE name = ?').get(name) as any;
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllRoles(): Role[] {
  const db = getSystemDb();
  const rows = db.prepare('SELECT * FROM roles ORDER BY is_builtin DESC, name ASC').all();

  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function createRole(input: RoleInput): Role {
  const db = getSystemDb();
  const now = Date.now();
  const id = `role_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

  db.prepare(`
    INSERT INTO roles (id, name, description, is_builtin, permissions, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description || null,
    JSON.stringify(input.permissions),
    now,
    now
  );

  return {
    id,
    name: input.name,
    description: input.description,
    isBuiltin: 0,
    permissions: input.permissions,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateRole(id: string, updates: Partial<RoleInput>): Role {
  const db = getSystemDb();
  const existing = getRoleById(id);
  if (!existing) {
    throw new Error(`角色不存在: ${id}`);
  }

  const now = Date.now();
  const updatedPermissions = updates.permissions || existing.permissions;
  const updatedName = updates.name || existing.name;
  const updatedDesc = updates.description !== undefined ? updates.description : existing.description;

  db.prepare(`
    UPDATE roles
    SET name = ?, description = ?, permissions = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updatedName,
    updatedDesc,
    JSON.stringify(updatedPermissions),
    now,
    id
  );

  return {
    ...existing,
    name: updatedName,
    description: updatedDesc,
    permissions: updatedPermissions,
    updatedAt: now,
  };
}

export function deleteRole(id: string): void {
  const db = getSystemDb();
  const role = getRoleById(id);
  if (!role) {
    throw new Error(`角色不存在: ${id}`);
  }

  if (role.isBuiltin === 1) {
    throw new Error('无法删除内置角色');
  }

  // 检查是否有用户使用该角色
  const usersWithRole = db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').get(id) as any;
  if (usersWithRole.count > 0) {
    throw new Error(`无法删除：有 ${usersWithRole.count} 个用户正在使用该角色`);
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
}
