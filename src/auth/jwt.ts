// src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

export interface JWTPayload {
  userId: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: Record<string, boolean>;
  exp: number;
  iat: number;
}

/**
 * 运行时临时 secret（仅当 JWT_SECRET 未设置时使用）
 * 重启后失效，所有已签发的 token 将无效
 */
let _runtimeSecret: string | null = null;

function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret) return envSecret;
  if (_runtimeSecret) return _runtimeSecret;
  // 不应走到这里（validateJwtSecret 已经初始化了 _runtimeSecret）
  throw new Error('JWT_SECRET not initialized');
}

/**
 * 校验/初始化 JWT_SECRET。
 * - 若 JWT_SECRET 环境变量已设置且 >= 32 字节：正常使用
 * - 若未设置：自动生成运行时临时 secret，打印警告（适用于开发/首次启动场景）
 * - 若已设置但 < 32 字节：拒绝启动
 */
export function validateJwtSecret(): void {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // 自动生成运行时 secret，避免阻断启动
    _runtimeSecret = randomBytes(48).toString('hex');
    console.warn(
      '[Auth] JWT_SECRET not set — using temporary runtime secret (sessions will invalidate on restart).\n' +
      '       For production, set: JWT_SECRET=$(openssl rand -base64 32)'
    );
    return;
  }

  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 bytes (current: ${secret.length}). ` +
      'Generate with: openssl rand -base64 32'
    );
  }
}

/**
 * 签发 Access Token
 */
export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    // 不设置 expiresIn，由 payload.exp 控制
  });
}

/**
 * 验证 Access Token
 * 显式锁定算法为 HS256，防止算法混淆攻击
 */
export function verifyAccessToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],  // 锁定算法，拒绝 alg=none 等
  }) as JWTPayload;

  return decoded;
}
