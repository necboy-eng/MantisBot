// src/auth/users-store.ts
import { getSystemDb } from './db.js';
import { nanoid } from 'nanoid';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  roleId: string;
  displayName: string | null;
  email: string | null;
  isEnabled: number;           // 1 = enabled, 0 = disabled
  forcePasswordChange: number; // 1 = must change password on next login
  tempPasswordExpiresAt: number | null;
  failedLoginCount: number;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string | Promise<string>;
  roleId: string;
  displayName?: string;
  email?: string;
  forcePasswordChange?: number;
  tempPasswordExpiresAt?: number | null;
}

export interface UpdateUserInput {
  passwordHash?: string;
  roleId?: string;
  displayName?: string;
  email?: string;
  isEnabled?: number;
  forcePasswordChange?: number;
  tempPasswordExpiresAt?: number | null;
}

/** 统计当前启用的 admin 数量 */
function countEnabledAdmins(): number {
  const db = getSystemDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM users
    WHERE role_id = 'role_admin' AND is_enabled = 1
  `).get() as { count: number };
  return row.count;
}

export function createUser(input: CreateUserInput): User {
  const db = getSystemDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const id = `user_${nanoid(12)}`;
  const now = Date.now();
  // passwordHash may be a Promise if caller forgets await; coerce to string
  const passwordHash = String(input.passwordHash);

  db.prepare(`
    INSERT INTO users (
      id, username, password_hash, role_id, display_name, email,
      is_enabled, force_password_change, temp_password_expires_at,
      failed_login_count, locked_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, NULL, ?, ?)
  `).run(
    id,
    input.username,
    passwordHash,
    input.roleId,
    input.displayName ?? null,
    input.email ?? null,
    input.forcePasswordChange ?? 0,
    input.tempPasswordExpiresAt ?? null,
    now,
    now,
  );

  return getUserById(id)!;
}

export function getUserById(id: string): User | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? mapRow(row) : null;
}

export function getUserByUsername(username: string): User | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row ? mapRow(row) : null;
}

export function getAllUsers(): User[] {
  const db = getSystemDb();
  return (db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]).map(mapRow);
}

export function updateUser(id: string, updates: UpdateUserInput): User {
  const db = getSystemDb();
  const existing = getUserById(id);
  if (!existing) {
    throw new Error(`用户不存在: ${id}`);
  }

  // 最后 admin 保护：降级检查
  if (
    updates.roleId !== undefined &&
    updates.roleId !== 'role_admin' &&
    existing.roleId === 'role_admin' &&
    existing.isEnabled === 1 &&
    countEnabledAdmins() <= 1
  ) {
    throw new Error('无法降级最后一个启用的管理员');
  }

  const now = Date.now();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.passwordHash !== undefined) { fields.push('password_hash = ?'); values.push(updates.passwordHash); }
  if (updates.roleId !== undefined) { fields.push('role_id = ?'); values.push(updates.roleId); }
  if (updates.displayName !== undefined) { fields.push('display_name = ?'); values.push(updates.displayName); }
  if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
  if (updates.isEnabled !== undefined) { fields.push('is_enabled = ?'); values.push(updates.isEnabled); }
  if (updates.forcePasswordChange !== undefined) { fields.push('force_password_change = ?'); values.push(updates.forcePasswordChange); }
  if (updates.tempPasswordExpiresAt !== undefined) { fields.push('temp_password_expires_at = ?'); values.push(updates.tempPasswordExpiresAt); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id)!;
}

export function deleteUser(id: string): void {
  const db = getSystemDb();
  const user = getUserById(id);
  if (!user) throw new Error(`用户不存在: ${id}`);

  // 最后 admin 保护：删除检查
  if (user.roleId === 'role_admin' && user.isEnabled === 1 && countEnabledAdmins() <= 1) {
    throw new Error('无法删除最后一个启用的管理员');
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function enableUser(id: string): User {
  return updateUser(id, { isEnabled: 1 });
}

export function disableUser(id: string): User {
  const user = getUserById(id);
  if (!user) throw new Error(`用户不存在: ${id}`);

  // 最后 admin 保护：禁用检查
  if (user.roleId === 'role_admin' && user.isEnabled === 1 && countEnabledAdmins() <= 1) {
    throw new Error('无法禁用最后一个启用的管理员');
  }

  return updateUser(id, { isEnabled: 0 });
}

/** 记录一次登录失败；第5次起锁定15分钟 */
export function recordLoginFailure(id: string): void {
  const db = getSystemDb();
  const user = getUserById(id);
  if (!user) return;

  const newCount = user.failedLoginCount + 1;
  const lockedUntil = newCount >= 5 ? Date.now() + 15 * 60 * 1000 : user.lockedUntil;
  const now = Date.now();

  db.prepare(`
    UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?
  `).run(newCount, lockedUntil, now, id);
}

/** 登录成功后重置失败计数 */
export function resetLoginFailures(id: string): void {
  const db = getSystemDb();
  db.prepare(`
    UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?
  `).run(Date.now(), id);
}

function mapRow(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    roleId: row.role_id,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    isEnabled: row.is_enabled,
    forcePasswordChange: row.force_password_change,
    tempPasswordExpiresAt: row.temp_password_expires_at ?? null,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
