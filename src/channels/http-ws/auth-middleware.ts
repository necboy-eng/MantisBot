// src/channels/http-ws/auth-middleware.ts
// 兼容层：保留旧版导出供现有代码使用，内部使用新 JWT 鉴权逻辑
// Deprecated: 直接使用 src/channels/http-ws/middleware/authenticate.ts

import { createHmac, createHash } from 'crypto';

const HMAC_SECRET = 'mantisbot-auth-secret';

/**
 * 对明文密码进行 SHA-256 哈希，返回 "sha256:<hex>" 格式
 * @deprecated 使用 src/auth/password.ts 的 hashPassword（argon2）
 */
export function hashPassword(plain: string): string {
  const hex = createHash('sha256').update(plain).digest('hex');
  return `sha256:${hex}`;
}

/**
 * 验证提交的明文密码是否与存储值匹配
 * 存储值可以是 "sha256:<hex>"（哈希）或明文（旧格式）
 * @deprecated 使用 src/auth/password.ts 的 verifyPassword（argon2）
 */
export function verifyPassword(submitted: string, stored: string): boolean {
  if (stored.startsWith('sha256:')) {
    const submittedHash = `sha256:${createHash('sha256').update(submitted).digest('hex')}`;
    return submittedHash === stored;
  }
  // 兼容旧版明文密码
  return submitted === stored;
}

/**
 * 根据用户名和存储密码值计算期望的 token（旧 HMAC 模式）
 * @deprecated 不再使用 HMAC token，请使用 JWT 认证（/auth/login）
 */
export function computeToken(username: string, storedPassword: string): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(`${username}:${storedPassword}`)
    .digest('hex');
}

/**
 * 创建 Express 鉴权中间件（兼容层，内部委托给新 JWT 中间件）
 * @deprecated 使用 src/channels/http-ws/middleware/authenticate.ts 的 createAuthMiddleware
 */
export { createAuthMiddleware } from './middleware/authenticate.js';
