// src/auth/__tests__/token-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import { createUser } from '../users-store.js';
import { hashPassword } from '../password.js';
import {
  createRefreshToken, getRefreshToken, revokeToken,
  revokeAllUserTokens, countActiveTokens, rotateToken,
} from '../token-store.js';
import { getSystemDb } from '../db.js';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let userId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'token-store-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  const user = createUser({ username: 'testuser', passwordHash: hashPassword('pass'), roleId: 'role_member' });
  userId = user.id;
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createRefreshToken', () => {
  it('should create a token record', () => {
    const token = createRefreshToken({ userId, userAgent: 'test-agent', ipAddress: '127.0.0.1' });
    expect(token.id).toBeTruthy();
    expect(token.tokenHash).toBeTruthy();
    expect(token.userId).toBe(userId);
    expect(token.isRevoked).toBe(0);
    expect(token.rotatedAt).toBeNull();
    expect(token.nextTokenId).toBeNull();
  });

  it('should enforce max 5 concurrent sessions (evict oldest)', () => {
    for (let i = 0; i < 6; i++) {
      createRefreshToken({ userId, userAgent: `agent-${i}`, ipAddress: '127.0.0.1' });
    }
    expect(countActiveTokens(userId)).toBe(5);
  });
});

describe('getRefreshToken / revokeToken', () => {
  it('should retrieve token by raw token value', () => {
    const { rawToken, ...record } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const found = getRefreshToken(rawToken);
    expect(found?.id).toBe(record.id);
  });

  it('should revoke a token', () => {
    const { rawToken } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    revokeToken(rawToken);
    const found = getRefreshToken(rawToken);
    expect(found?.isRevoked).toBe(1);
  });
});

describe('rotateToken', () => {
  it('should create a new token and link the old one', () => {
    const { rawToken: oldRaw, id: oldId } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const { rawToken: newRaw, id: newId } = rotateToken(oldRaw);

    const oldRecord = getRefreshToken(oldRaw);
    expect(oldRecord?.rotatedAt).not.toBeNull();
    expect(oldRecord?.nextTokenId).toBe(newId);

    const newRecord = getRefreshToken(newRaw);
    expect(newRecord?.isRevoked).toBe(0);
  });

  it('should return next token idempotently within grace period', () => {
    const { rawToken: oldRaw } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const { rawToken: newRaw1 } = rotateToken(oldRaw);
    // simulate retry within grace period — same old token presented again
    const { rawToken: newRaw2 } = rotateToken(oldRaw);
    // grace period returns the stored next_raw_token — same value
    expect(newRaw1).toBe(newRaw2);
  });

  it('should revoke all user tokens if old token is outside grace period', () => {
    const { rawToken: oldRaw } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    rotateToken(oldRaw);
    // Simulate replay after grace period by manipulating rotated_at directly via DB
    const db = getSystemDb();
    const oldHash = createHash('sha256').update(oldRaw).digest('hex');
    db.prepare("UPDATE refresh_tokens SET rotated_at = ? WHERE token_hash = ?")
      .run(Date.now() - 60000, oldHash);

    expect(() => rotateToken(oldRaw)).toThrow('token_reuse_detected');
    expect(countActiveTokens(userId)).toBe(0);
  });
});
