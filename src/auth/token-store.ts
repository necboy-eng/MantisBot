// src/auth/token-store.ts
import { createHash, randomBytes } from 'crypto';
import { getSystemDb } from './db.js';
import { nanoid } from 'nanoid';

const GRACE_PERIOD_MS = 30 * 1000; // 30 秒
const MAX_SESSIONS = 5;
const RT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  rawToken?: string; // 仅 createRefreshToken / rotateToken 返回时包含
  userAgent: string | null;
  ipAddress: string | null;
  isRevoked: number;
  rotatedAt: number | null;
  nextTokenId: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface CreateTokenInput {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createRefreshToken(input: CreateTokenInput): RefreshToken & { rawToken: string } {
  const db = getSystemDb();
  const now = Date.now();

  // 强制最大并发会话数：撤销最旧的超量记录
  const activeTokens = db.prepare(`
    SELECT id FROM refresh_tokens
    WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
    ORDER BY created_at ASC
  `).all(input.userId, now);

  if (activeTokens.length >= MAX_SESSIONS) {
    const toEvict = (activeTokens as any[]).slice(0, activeTokens.length - MAX_SESSIONS + 1);
    for (const t of toEvict) {
      db.prepare("UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?").run((t as any).id);
    }
  }

  const rawToken = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = `rt_${nanoid(12)}`;
  const expiresAt = now + RT_TTL_MS;

  db.prepare(`
    INSERT INTO refresh_tokens (
      id, user_id, token_hash, user_agent, ip_address,
      is_revoked, rotated_at, next_token_id, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    id, input.userId, tokenHash,
    input.userAgent ?? null, input.ipAddress ?? null,
    expiresAt, now,
  );

  const record = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(id);
  return { ...mapRow(record), rawToken };
}

export function getRefreshToken(rawToken: string): RefreshToken | null {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  return row ? mapRow(row) : null;
}

export function revokeToken(rawToken: string): void {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllUserTokens(userId: string): void {
  const db = getSystemDb();
  db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ?').run(userId);
}

export function countActiveTokens(userId: string): number {
  const db = getSystemDb();
  const now = Date.now();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM refresh_tokens
    WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
  `).get(userId, now) as any;
  return row.count as number;
}

/**
 * 轮换 Refresh Token。
 *
 * - 纯撤销（is_revoked=1, rotated_at=null）→ token_revoked
 * - 已轮换且在 grace period 内 → 幂等返回存储的 next_raw_token（支持网络重试）
 * - 已轮换且超出 grace period → 重放攻击，撤销该用户所有 token
 * - 正常 → 创建新 token，将 next_raw_token 写入旧记录
 */
export function rotateToken(rawToken: string): RefreshToken & { rawToken: string } {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as any;

  if (!row) {
    throw new Error('token_not_found');
  }

  const record = mapRow(row);

  // 纯撤销（未轮换）：is_revoked=1 且 rotated_at=null
  if (record.isRevoked === 1 && record.rotatedAt === null) {
    throw new Error('token_revoked');
  }

  // 已轮换处理
  if (record.rotatedAt !== null) {
    const withinGrace = Date.now() - record.rotatedAt < GRACE_PERIOD_MS;

    if (withinGrace && row.next_raw_token) {
      // grace period 内：幂等返回已存储的新 rawToken
      const nextRow = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(record.nextTokenId) as any;
      if (nextRow) {
        return { ...mapRow(nextRow), rawToken: row.next_raw_token as string };
      }
    }

    // grace period 外 → 重放攻击
    revokeAllUserTokens(record.userId);
    throw new Error('token_reuse_detected');
  }

  if (record.expiresAt < Date.now()) {
    throw new Error('token_expired');
  }

  // 正常轮换
  const newToken = createRefreshToken({
    userId: record.userId,
    userAgent: record.userAgent ?? undefined,
    ipAddress: record.ipAddress ?? undefined,
  });

  // 标记旧 token 已轮换，并存储新 rawToken 以支持 grace period 幂等
  db.prepare(`
    UPDATE refresh_tokens
    SET rotated_at = ?, next_token_id = ?, next_raw_token = ?, is_revoked = 1
    WHERE id = ?
  `).run(Date.now(), newToken.id, newToken.rawToken, record.id);

  return newToken;
}

function mapRow(row: any): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    isRevoked: row.is_revoked,
    rotatedAt: row.rotated_at,
    nextTokenId: row.next_token_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
