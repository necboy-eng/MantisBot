// src/channels/http-ws/routes/users-routes.ts
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { requirePermission } from '../middleware/require-permission.js';
import {
  getAllUsers, getUserById, createUser, updateUser, deleteUser,
} from '../../../auth/users-store.js';
import {
  getAllRoles, getRoleById, createRole, updateRole, deleteRole,
} from '../../../auth/roles-store.js';
import {
  getPathAclForRole, getPathAclForUser, setRolePathAcl, setUserPathAcl, deletePathAcl,
  getPathAclByPath, upsertPathAcl, type AclPermission,
} from '../../../auth/path-acl-store.js';
import { hashPassword } from '../../../auth/password.js';
import { logAuditEvent } from '../../../auth/audit-logger.js';

export const usersRouter = Router();

/** 从 User 对象中移除敏感字段 */
function sanitizeUser(user: ReturnType<typeof getUserById>) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ─── Users ───────────────────────────────────────────────────────────────────

// GET /api/users
usersRouter.get('/users', requirePermission('manageUsers'), (req, res) => {
  const users = getAllUsers().map(sanitizeUser);
  return res.json(users);
});

// GET /api/users/:id
usersRouter.get('/users/:id', requirePermission('manageUsers'), (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not Found' });
  return res.json(sanitizeUser(user));
});

// POST /api/users — async 路由，因为 hashPassword 是异步的
usersRouter.post('/users', requirePermission('manageUsers'), async (req, res) => {
  const { username, password, roleId, displayName, email } = req.body ?? {};
  if (!username || !password || !roleId) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少必填字段' });
  }
  try {
    const passwordHash = await hashPassword(password);
    const user = createUser({
      username,
      passwordHash,
      roleId,
      displayName,
      email,
    });
    logAuditEvent({
      action: 'create_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetUsername: username },
    });
    return res.status(201).json(sanitizeUser(user));
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:id
usersRouter.patch('/users/:id', requirePermission('manageUsers'), (req, res) => {
  const { roleId, displayName, email, isEnabled } = req.body ?? {};
  try {
    const user = updateUser(req.params.id, { roleId, displayName, email, isEnabled });
    logAuditEvent({
      action: 'update_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    return res.json(sanitizeUser(user));
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id
usersRouter.delete('/users/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    deleteUser(req.params.id);
    logAuditEvent({
      action: 'delete_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password — async 路由，因为 hashPassword 是异步的
usersRouter.post('/users/:id/reset-password', requirePermission('manageUsers'), async (req, res) => {
  try {
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(tempPassword);

    updateUser(req.params.id, {
      passwordHash,
      forcePasswordChange: 1,
      tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时
    });
    logAuditEvent({
      action: 'admin_password_reset',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    // 临时密码仅此一次明文返回
    return res.json({ ok: true, tempPassword });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/users/:id/force-logout (revoke all sessions)
usersRouter.post('/users/:id/force-logout', requirePermission('manageUsers'), async (req, res) => {
  const { revokeAllUserTokens } = await import('../../../auth/token-store.js');
  revokeAllUserTokens(req.params.id);
  logAuditEvent({
    action: 'force_logout',
    userId: req.user?.userId,
    username: req.user?.username,
    detail: { targetId: req.params.id },
  });
  return res.json({ ok: true });
});

// ─── Roles ───────────────────────────────────────────────────────────────────

// GET /api/roles
usersRouter.get('/roles', requirePermission('manageUsers'), (req, res) => {
  return res.json(getAllRoles());
});

// POST /api/roles
usersRouter.post('/roles', requirePermission('manageUsers'), (req, res) => {
  const { name, description, permissions } = req.body ?? {};
  if (!name || !permissions) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 name 或 permissions' });
  }
  try {
    const role = createRole({ name, description, permissions });
    logAuditEvent({
      action: 'role_permission_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { action: 'create', roleId: role.id },
    });
    return res.status(201).json(role);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/roles/:id
usersRouter.patch('/roles/:id', requirePermission('manageUsers'), (req, res) => {
  const { name, description, permissions } = req.body ?? {};
  try {
    const role = updateRole(req.params.id, { name, description, permissions });
    logAuditEvent({
      action: 'role_permission_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { action: 'update', roleId: req.params.id },
    });
    return res.json(role);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/roles/:id
usersRouter.delete('/roles/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    deleteRole(req.params.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── Path ACL ────────────────────────────────────────────────────────────────

// GET /api/path-acl?path=<path>&storageId=  (按目标路径查询所有规则)
// GET /api/path-acl?roleId=&storageId=       (查询某角色所有规则)
// GET /api/path-acl?userId=&storageId=       (查询某用户所有规则)
usersRouter.get('/path-acl', requirePermission('manageUsers'), (req, res) => {
  const { roleId, userId, storageId, path: targetPath } = req.query as Record<string, string>;

  // 按路径查询（PathAclDialog 使用此方式）
  if (targetPath) {
    console.log('[path-acl GET by path]', { targetPath, storageId });
    const entries = getPathAclByPath(targetPath, storageId || undefined);
    console.log('[path-acl GET by path] found', entries.length, 'entries:', JSON.stringify(entries));
    return res.json(entries);
  }

  if (roleId) {
    return res.json(getPathAclForRole(roleId, storageId));
  }
  if (userId) {
    return res.json(getPathAclForUser(userId, storageId));
  }
  return res.status(400).json({ error: 'BadRequest', message: '需提供 path、roleId 或 userId' });
});

// PUT /api/path-acl/role
usersRouter.put('/path-acl/role', requirePermission('manageUsers'), (req, res) => {
  const { roleId, storageId, path, permission } = req.body ?? {};
  if (!roleId || !storageId || !path || !permission) {
    return res.status(400).json({ error: 'BadRequest' });
  }
  try {
    setRolePathAcl({ roleId, storageId, path, permission });
    logAuditEvent({
      action: 'path_acl_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { subjectType: 'role', roleId, storageId, path, permission },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PUT /api/path-acl/user
usersRouter.put('/path-acl/user', requirePermission('manageUsers'), (req, res) => {
  const { userId, storageId, path, permission } = req.body ?? {};
  if (!userId || !storageId || !path || !permission) {
    return res.status(400).json({ error: 'BadRequest' });
  }
  try {
    setUserPathAcl({ userId, storageId, path, permission });
    logAuditEvent({
      action: 'path_acl_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { subjectType: 'user', userId, storageId, path, permission },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/path-acl/:id
usersRouter.delete('/path-acl/:id', requirePermission('manageUsers'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'BadRequest' });
  deletePathAcl(id);
  return res.json({ ok: true });
});

// POST /api/path-acl（PathAclDialog 通用 upsert 接口）
// body: { subjectType: 'role'|'user', subjectId, storageId, path, permission }
usersRouter.post('/path-acl', requirePermission('manageUsers'), (req, res) => {
  const { subjectType, subjectId, storageId, path: targetPath, permission } = req.body ?? {};

  if (!subjectType || !subjectId || !storageId || !targetPath || !permission) {
    return res.status(400).json({ error: 'BadRequest', message: 'subjectType, subjectId, storageId, path, permission are required' });
  }
  if (subjectType !== 'role' && subjectType !== 'user') {
    return res.status(400).json({ error: 'BadRequest', message: 'subjectType must be role or user' });
  }
  const validPermissions: AclPermission[] = ['read', 'write', 'deny'];
  if (!validPermissions.includes(permission as AclPermission)) {
    return res.status(400).json({ error: 'BadRequest', message: 'permission must be read, write, or deny' });
  }

  try {
    const entry = upsertPathAcl({
      subjectType: subjectType as 'role' | 'user',
      subjectId,
      storageId,
      path: targetPath,
      permission: permission as AclPermission,
    });
    logAuditEvent({
      action: 'path_acl_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { subjectType, subjectId, storageId, path: targetPath, permission },
    });
    return res.status(201).json(entry);
  } catch (err: any) {
    console.error('[path-acl] upsert error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save ACL rule' });
  }
});

// POST /api/users/:id/change-password (用户修改自己的密码)
usersRouter.post('/users/:id/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'BadRequest', message: '密码至少 8 位' });
  }
  // 只能修改自己的密码，或管理员修改任何人的
  const requestingUser = req.user;
  if (!requestingUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const canManage = Array.isArray(requestingUser.permissions)
    ? requestingUser.permissions.includes('*') || requestingUser.permissions.includes('manageUsers')
    : false;
  if (requestingUser.userId !== req.params.id && !canManage) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // 用户修改自己密码时必须验证当前密码；管理员操作他人账户时跳过
  if (requestingUser.userId === req.params.id) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'BadRequest', message: '请输入当前密码' });
    }
    const { getUserById } = await import('../../../auth/users-store.js');
    const { verifyPassword } = await import('../../../auth/password.js');
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not Found' });
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_credentials', message: '当前密码错误' });
    }
  }
  try {
    const passwordHash = await hashPassword(newPassword);
    updateUser(req.params.id, { passwordHash, forcePasswordChange: 0, tempPasswordExpiresAt: null });
    logAuditEvent({
      action: 'password_changed',
      userId: requestingUser.userId,
      username: requestingUser.username,
      detail: { targetId: req.params.id, self: requestingUser.userId === req.params.id },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
