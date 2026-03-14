// src/auth/auth-service.ts
import { getUserByUsername, getUserById, recordLoginFailure, resetLoginFailures, updateUser } from './users-store.js';
import { getSystemDb } from './db.js';
import { verifyPassword } from './password.js';
import { signAccessToken, validateJwtSecret } from './jwt.js';
import { createRefreshToken, getRefreshToken, revokeToken, rotateToken } from './token-store.js';
import { logAuditEvent } from './audit-logger.js';
import { getRoleById } from './roles-store.js';

export interface LoginInput {
  username: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  forcePasswordChange: boolean;
}

export interface RefreshInput {
  rawRefreshToken: string;
  ipAddress?: string;
}

export interface RefreshResult {
  accessToken: string;
  newRefreshToken: string;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  validateJwtSecret();

  const user = getUserByUsername(input.username);

  // 用户不存在 → 统一返回 invalid_credentials（不泄露用户名是否存在）
  if (!user) {
    logAuditEvent({ action: 'login_failed', username: input.username, ipAddress: input.ipAddress });
    throw new Error('invalid_credentials');
  }

  // 1. 账户锁定检查（先于密码校验，防止锁定期间被暴力枚举）
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('account_locked');
  }

  // 2. 账户禁用检查（先于密码校验，禁用用户密码正确也不应重置失败计数）
  if (user.isEnabled === 0) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('account_disabled');
  }

  // 3. 密码校验（异步）
  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    recordLoginFailure(user.id);
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('invalid_credentials');
  }

  // 4. 临时密码过期检查
  if (user.forcePasswordChange === 1 && user.tempPasswordExpiresAt !== null && user.tempPasswordExpiresAt < Date.now()) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('temp_password_expired');
  }

  // 登录成功：重置失败计数，更新最后登录时间
  resetLoginFailures(user.id);
  getSystemDb().prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), user.id);

  const role = getRoleById(user.roleId);
  // permissions is stored as JSON string in DB, role.permissions is already parsed as object
  // Convert to string[] for JWT: admin gets ['*'], others get array of true-valued keys
  let permissions: string[];
  if (user.roleId === 'role_admin') {
    permissions = ['*'];
  } else {
    const permsObj = role?.permissions ?? {};
    permissions = Object.keys(permsObj).filter(k => permsObj[k] === true);
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = signAccessToken({
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
    roleName: role?.name ?? '',
    permissions: permissions as any, // JWTPayload.permissions is Record<string,boolean> but we sign string[]
    exp: now + 900, // 15 minutes
    iat: now,
  });

  const { rawToken: refreshToken } = createRefreshToken({
    userId: user.id,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  logAuditEvent({
    action: 'login_success',
    userId: user.id,
    username: user.username,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    accessToken,
    refreshToken,
    forcePasswordChange: user.forcePasswordChange === 1,
  };
}

export async function refreshAccessToken(input: RefreshInput): Promise<RefreshResult> {
  validateJwtSecret();

  const newTokenRecord = rotateToken(input.rawRefreshToken);

  const user = getUserById(newTokenRecord.userId);
  if (!user) throw new Error('user_not_found');

  const role = getRoleById(user.roleId);
  let permissions: string[];
  if (user.roleId === 'role_admin') {
    permissions = ['*'];
  } else {
    const permsObj = role?.permissions ?? {};
    permissions = Object.keys(permsObj).filter(k => permsObj[k] === true);
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = signAccessToken({
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
    roleName: role?.name ?? '',
    permissions: permissions as any,
    exp: now + 900,
    iat: now,
  });

  return {
    accessToken,
    newRefreshToken: newTokenRecord.rawToken,
  };
}

export async function logout(input: { rawRefreshToken: string; userId?: string; username?: string }): Promise<void> {
  const record = getRefreshToken(input.rawRefreshToken);
  if (record) {
    revokeToken(input.rawRefreshToken);
    logAuditEvent({
      action: 'logout',
      userId: record.userId,
    });
  }
}
