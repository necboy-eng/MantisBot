// src/auth/__tests__/jwt.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  validateJwtSecret,
  type JWTPayload
} from '../jwt.js';

describe('JWT', () => {
  const originalEnv = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.JWT_SECRET = originalEnv;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  it('should sign and verify access token', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true, viewHistory: true },
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = signAccessToken(payload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.username).toBe(payload.username);
    expect(decoded.permissions.chat).toBe(true);
  });

  it('should reject token with wrong secret', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true },
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = signAccessToken(payload);

    // 使用错误的 secret 验证
    process.env.JWT_SECRET = 'wrong-secret-key-must-be-at-least-32-bytes!!';
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('should reject expired token', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true },
      exp: Math.floor(Date.now() / 1000) - 1,  // 已过期
      iat: Math.floor(Date.now() / 1000) - 1000,
    };

    const token = signAccessToken(payload);
    expect(() => verifyAccessToken(token)).toThrow('jwt expired');
  });

  it('should validate JWT_SECRET length', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => validateJwtSecret()).toThrow('at least 32 bytes');

    process.env.JWT_SECRET = 'this-is-a-valid-secret-key-with-32-bytes!!';
    expect(() => validateJwtSecret()).not.toThrow();
  });

  it('should reject alg=none token', () => {
    // 构造一个 alg=none 的恶意 token（简化示例）
    const maliciousToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ1XzEyMyJ9.';

    expect(() => verifyAccessToken(maliciousToken)).toThrow();
  });
});
