// src/auth/__tests__/auth-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import { createUser } from '../users-store.js';
import { hashPassword } from '../password.js';
import { login, logout, refreshAccessToken } from '../auth-service.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-service-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  // 使用 await hashPassword 创建真实的 argon2id 哈希
  createUser({ username: 'alice', passwordHash: await hashPassword('password123'), roleId: 'role_member' });
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

describe('login', () => {
  it('should return accessToken and refreshToken on valid credentials', async () => {
    const result = await login({ username: 'alice', password: 'password123', ipAddress: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('should throw on wrong password', async () => {
    await expect(login({ username: 'alice', password: 'wrong', ipAddress: '::1' }))
      .rejects.toThrow('invalid_credentials');
  });

  it('should throw on unknown user', async () => {
    await expect(login({ username: 'ghost', password: 'x', ipAddress: '::1' }))
      .rejects.toThrow('invalid_credentials');
  });

  it('should lock account after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await login({ username: 'alice', password: 'wrong', ipAddress: '::1' }).catch(() => {});
    }
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('account_locked');
  });

  it('should reject disabled user', async () => {
    const { getUserByUsername, updateUser } = await import('../users-store.js');
    const user = getUserByUsername('alice')!;
    updateUser(user.id, { isEnabled: 0 });
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('account_disabled');
  });

  it('should reject temp password past expiry', async () => {
    const { getUserByUsername, updateUser } = await import('../users-store.js');
    const user = getUserByUsername('alice')!;
    updateUser(user.id, { forcePasswordChange: 1, tempPasswordExpiresAt: Date.now() - 1000 });
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('temp_password_expired');
  });
});

describe('refreshAccessToken', () => {
  it('should return new accessToken for valid refreshToken', async () => {
    const { refreshToken } = await login({ username: 'alice', password: 'password123', ipAddress: '::1' });
    const result = await refreshAccessToken({ rawRefreshToken: refreshToken });
    expect(result.accessToken).toBeTruthy();
  });

  it('should reject invalid refreshToken', async () => {
    await expect(refreshAccessToken({ rawRefreshToken: 'fake-token' }))
      .rejects.toThrow('token_not_found');
  });
});

describe('logout', () => {
  it('should revoke the refresh token', async () => {
    const { refreshToken } = await login({ username: 'alice', password: 'password123', ipAddress: '::1' });
    await logout({ rawRefreshToken: refreshToken });
    await expect(refreshAccessToken({ rawRefreshToken: refreshToken }))
      .rejects.toThrow();
  });
});
