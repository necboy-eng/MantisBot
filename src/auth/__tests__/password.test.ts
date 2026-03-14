// src/auth/__tests__/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('Password', () => {
  it('should hash password with argon2id format', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^argon2id:/);
  });

  it('should verify correct password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject wrong password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword('wrongPassword', hash);
    expect(isValid).toBe(false);
  });

  it('should reject old SHA-256 format when verifying', async () => {
    // 旧格式 SHA-256 哈希
    const oldHash = 'sha256:5e884898da28047d9f5dcb6c05e24b16da28047d9f5dcb6c05e24b16';
    const isValid = await verifyPassword('password', oldHash);
    expect(isValid).toBe(false);
  });
});
