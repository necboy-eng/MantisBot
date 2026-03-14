// src/auth/path-acl-store.ts
import { getSystemDb } from './db.js';

export type AclPermission = 'read' | 'write' | 'deny';

export interface PathAclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
  createdAt: number;
}

/** 将数据库 snake_case 原始行转换为 camelCase 的 PathAclEntry */
function rowToEntry(row: Record<string, unknown>): PathAclEntry {
  return {
    id:          row.id as number,
    subjectType: row.subject_type as 'role' | 'user',
    subjectId:   row.subject_id as string,
    storageId:   row.storage_id as string,
    path:        row.path as string,
    permission:  row.permission as AclPermission,
    createdAt:   row.created_at as number,
  };
}

export interface ResolveResult {
  granted: boolean;
  permission: AclPermission | null;
  source: 'admin' | 'user' | 'role' | 'default';
}

export interface ResolveInput {
  roleId: string;
  userId: string;
  storageId: string;
  requestPath: string;
  requiredPermission?: AclPermission;
}

const ADMIN_ROLE_ID = 'role_admin';

function permissionCovers(actual: AclPermission, required: AclPermission): boolean {
  if (actual === 'deny') return false;
  if (actual === 'write') return true;
  return actual === required;
}

function findBestMatch(rules: PathAclEntry[], requestPath: string): PathAclEntry | null {
  let best: PathAclEntry | null = null;
  let bestLen = -1;

  for (const rule of rules) {
    const prefix = rule.path.endsWith('/') ? rule.path : rule.path + '/';
    const isMatch =
      requestPath === rule.path ||
      requestPath.startsWith(prefix);

    if (isMatch && rule.path.length > bestLen) {
      best = rule;
      bestLen = rule.path.length;
    }
  }

  return best;
}

export function resolveAccess(input: ResolveInput): ResolveResult {
  const { roleId, userId, storageId, requestPath, requiredPermission = 'read' } = input;

  if (roleId === ADMIN_ROLE_ID) {
    return { granted: true, permission: 'write', source: 'admin' };
  }

  const db = getSystemDb();

  const userRules = (db.prepare(`
    SELECT * FROM path_acl
    WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ?
  `).all(userId, storageId) as Record<string, unknown>[]).map(rowToEntry);

  const userMatch = findBestMatch(userRules, requestPath);

  if (userMatch) {
    const granted = permissionCovers(userMatch.permission, requiredPermission);
    return { granted, permission: userMatch.permission, source: 'user' };
  }

  const roleRules = (db.prepare(`
    SELECT * FROM path_acl
    WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ?
  `).all(roleId, storageId) as Record<string, unknown>[]).map(rowToEntry);

  const roleMatch = findBestMatch(roleRules, requestPath);

  if (roleMatch) {
    const granted = permissionCovers(roleMatch.permission, requiredPermission);
    return { granted, permission: roleMatch.permission, source: 'role' };
  }

  return { granted: false, permission: null, source: 'default' };
}

export function setRolePathAcl(input: {
  roleId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
}): void {
  const db = getSystemDb();
  const now = Date.now();

  const existing = db.prepare(`
    SELECT id FROM path_acl
    WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ? AND path = ?
  `).get(input.roleId, input.storageId, input.path);

  if (existing) {
    db.prepare(`UPDATE path_acl SET permission = ?, created_at = ? WHERE id = ?`)
      .run(input.permission, now, (existing as any).id);
  } else {
    db.prepare(`
      INSERT INTO path_acl (subject_type, subject_id, storage_id, path, permission, created_at)
      VALUES ('role', ?, ?, ?, ?, ?)
    `).run(input.roleId, input.storageId, input.path, input.permission, now);
  }
}

export function setUserPathAcl(input: {
  userId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
}): void {
  const db = getSystemDb();
  const now = Date.now();

  const existing = db.prepare(`
    SELECT id FROM path_acl
    WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ? AND path = ?
  `).get(input.userId, input.storageId, input.path);

  if (existing) {
    db.prepare(`UPDATE path_acl SET permission = ?, created_at = ? WHERE id = ?`)
      .run(input.permission, now, (existing as any).id);
  } else {
    db.prepare(`
      INSERT INTO path_acl (subject_type, subject_id, storage_id, path, permission, created_at)
      VALUES ('user', ?, ?, ?, ?, ?)
    `).run(input.userId, input.storageId, input.path, input.permission, now);
  }
}

export function getPathAclForRole(roleId: string, storageId?: string): PathAclEntry[] {
  const db = getSystemDb();
  if (storageId) {
    return (db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ?`).all(roleId, storageId) as Record<string, unknown>[]).map(rowToEntry);
  }
  return (db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'role' AND subject_id = ?`).all(roleId) as Record<string, unknown>[]).map(rowToEntry);
}

export function getPathAclForUser(userId: string, storageId?: string): PathAclEntry[] {
  const db = getSystemDb();
  if (storageId) {
    return (db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ?`).all(userId, storageId) as Record<string, unknown>[]).map(rowToEntry);
  }
  return (db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'user' AND subject_id = ?`).all(userId) as Record<string, unknown>[]).map(rowToEntry);
}

export function deletePathAcl(id: number): void {
  const db = getSystemDb();
  db.prepare('DELETE FROM path_acl WHERE id = ?').run(id);
}

/**
 * 批量查询一组路径中哪些有 ACL 规则，返回有规则的路径 Set
 */
export function getPathsWithAcl(paths: string[], storageId: string): Set<string> {
  if (paths.length === 0) return new Set();
  const db = getSystemDb();
  const placeholders = paths.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT DISTINCT path FROM path_acl WHERE storage_id = ? AND path IN (${placeholders})`
  ).all(storageId, ...paths) as { path: string }[];
  return new Set(rows.map(r => r.path));
}

/**
 * 批量查询一组路径的 ACL 权限类型，返回 path → permission 的 Map。
 * 当一个路径有多条规则时，优先级：deny > read/write（取最严格的）。
 */
export function getPathsAclPermission(paths: string[], storageId: string): Map<string, AclPermission> {
  if (paths.length === 0) return new Map();
  const db = getSystemDb();
  const placeholders = paths.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT path, permission FROM path_acl WHERE storage_id = ? AND path IN (${placeholders})`
  ).all(storageId, ...paths) as { path: string; permission: AclPermission }[];

  const result = new Map<string, AclPermission>();
  for (const row of rows) {
    const existing = result.get(row.path);
    // deny 优先，其次 write，其次 read
    if (!existing || row.permission === 'deny' || (row.permission === 'write' && existing === 'read')) {
      result.set(row.path, row.permission);
    }
  }
  return result;
}
export function getPathAclByPath(targetPath: string, storageId?: string): PathAclEntry[] {
  const db = getSystemDb();
  if (storageId) {
    return (db.prepare(`SELECT * FROM path_acl WHERE path = ? AND storage_id = ? ORDER BY subject_type, subject_id`)
      .all(targetPath, storageId) as Record<string, unknown>[]).map(rowToEntry);
  }
  return (db.prepare(`SELECT * FROM path_acl WHERE path = ? ORDER BY subject_type, subject_id`)
    .all(targetPath) as Record<string, unknown>[]).map(rowToEntry);
}

/**
 * 批量 upsert（setRolePathAcl / setUserPathAcl 的通用版本）
 */
export function upsertPathAcl(input: {
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
}): PathAclEntry {
  const db = getSystemDb();
  const now = Date.now();

  const existingRow = db.prepare(`
    SELECT * FROM path_acl
    WHERE subject_type = ? AND subject_id = ? AND storage_id = ? AND path = ?
  `).get(input.subjectType, input.subjectId, input.storageId, input.path) as Record<string, unknown> | undefined;

  if (existingRow) {
    db.prepare(`UPDATE path_acl SET permission = ?, created_at = ? WHERE id = ?`)
      .run(input.permission, now, existingRow.id);
    const existing = rowToEntry(existingRow);
    return { ...existing, permission: input.permission, createdAt: now };
  } else {
    const result = db.prepare(`
      INSERT INTO path_acl (subject_type, subject_id, storage_id, path, permission, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.subjectType, input.subjectId, input.storageId, input.path, input.permission, now);
    return {
      id: result.lastInsertRowid as number,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      storageId: input.storageId,
      path: input.path,
      permission: input.permission,
      createdAt: now,
    };
  }
}
