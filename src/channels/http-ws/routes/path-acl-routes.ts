// src/channels/http-ws/routes/path-acl-routes.ts
import { Router } from 'express';
import { requirePermission } from '../middleware/require-permission.js';
import {
  getPathAclByPath,
  upsertPathAcl,
  deletePathAcl,
  type AclPermission,
  type PathAclEntry,
} from '../../../auth/path-acl-store.js';
import { getSystemDb } from '../../../auth/db.js';
import { getAllRoles, type Role } from '../../../auth/roles-store.js';
import { getAllUsers, type User } from '../../../auth/users-store.js';

export const pathAclRouter = Router();

/**
 * GET /api/path-acl/all
 * 获取所有 ACL 规则（需要 manageUsers 权限）
 */
pathAclRouter.get('/path-acl/all', requirePermission('manageUsers'), (_req, res) => {
  try {
    const db = getSystemDb();
    const entries = (db.prepare(`SELECT * FROM path_acl ORDER BY path, subject_type, subject_id`).all() as Record<string, unknown>[]).map(row => ({
      id: row.id as number,
      subjectType: row.subject_type as 'role' | 'user',
      subjectId: row.subject_id as string,
      storageId: row.storage_id as string,
      path: row.path as string,
      permission: row.permission as AclPermission,
      createdAt: row.created_at as number,
    }));
    res.json(entries);
  } catch (err) {
    console.error('[path-acl/all] error:', err);
    res.status(500).json({ error: 'Failed to fetch ACL rules' });
  }
});

/**
 * GET /api/path-acl/subjects
 * 获取所有角色和用户列表（用于下拉选择）
 */
pathAclRouter.get('/path-acl/subjects', requirePermission('manageUsers'), (_req, res) => {
  try {
    const roles = getAllRoles().map((r: Role) => ({ id: r.id, name: r.name, type: 'role' as const }));
    const users = getAllUsers().map((u: User) => ({ id: u.id, username: u.username, displayName: u.displayName, type: 'user' as const }));
    res.json({ roles, users });
  } catch (err) {
    console.error('[path-acl/subjects] error:', err);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

/**
 * GET /api/path-acl?path=<encodedPath>&storageId=<storageId>
 * 查询某路径下的所有 ACL 规则（需要 manageUsers 权限）
 */
pathAclRouter.get('/path-acl', requirePermission('manageUsers'), (req, res) => {
  const targetPath = req.query.path as string;
  const storageId = req.query.storageId as string | undefined;

  if (!targetPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  console.log('[path-acl GET]', { targetPath, storageId });
  const entries = getPathAclByPath(targetPath, storageId);
  console.log('[path-acl GET] found', entries.length, 'entries:', JSON.stringify(entries));
  res.json(entries);
});

/**
 * POST /api/path-acl
 * 新增或更新一条 ACL 规则（需要 manageUsers 权限）
 * body: { subjectType: 'role'|'user', subjectId: string, storageId: string, path: string, permission: 'read'|'write'|'deny' }
 */
pathAclRouter.post('/path-acl', requirePermission('manageUsers'), (req, res) => {
  const { subjectType, subjectId, storageId, path: targetPath, permission } = req.body;

  if (!subjectType || !subjectId || !storageId || !targetPath || !permission) {
    return res.status(400).json({ error: 'subjectType, subjectId, storageId, path, permission are required' });
  }

  if (subjectType !== 'role' && subjectType !== 'user') {
    return res.status(400).json({ error: 'subjectType must be role or user' });
  }

  const validPermissions: AclPermission[] = ['read', 'write', 'deny'];
  if (!validPermissions.includes(permission as AclPermission)) {
    return res.status(400).json({ error: 'permission must be read, write, or deny' });
  }

  try {
    const entry = upsertPathAcl({
      subjectType: subjectType as 'role' | 'user',
      subjectId,
      storageId,
      path: targetPath,
      permission: permission as AclPermission,
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error('[path-acl] upsert error:', err);
    res.status(500).json({ error: 'Failed to save ACL rule' });
  }
});

/**
 * DELETE /api/path-acl/:id
 * 删除一条 ACL 规则（需要 manageUsers 权限）
 */
pathAclRouter.delete('/path-acl/:id', requirePermission('manageUsers'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    deletePathAcl(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[path-acl] delete error:', err);
    res.status(500).json({ error: 'Failed to delete ACL rule' });
  }
});
