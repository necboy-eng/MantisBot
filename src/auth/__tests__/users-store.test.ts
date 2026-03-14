// src/auth/__tests__/users-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import {
  createUser, getUserById, getUserByUsername, updateUser,
  deleteUser, enableUser, disableUser, recordLoginFailure,
  resetLoginFailures, getAllUsers,
} from '../users-store.js';
import { hashPassword } from '../password.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'users-store-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createUser', () => {
  it('should create a user with hashed password', () => {
    const user = createUser({
      username: 'alice',
      passwordHash: hashPassword('secret123'),
      roleId: 'role_member',
      displayName: 'Alice',
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.roleId).toBe('role_member');
    expect(user.isEnabled).toBe(1);
    expect(user.forcePasswordChange).toBe(0);
  });

  it('should reject duplicate username', () => {
    createUser({ username: 'bob', passwordHash: 'x', roleId: 'role_member' });
    expect(() =>
      createUser({ username: 'bob', passwordHash: 'y', roleId: 'role_member' })
    ).toThrow('用户名已存在');
  });

  it('should support forcePasswordChange and tempPasswordExpiresAt', () => {
    const expiresAt = Date.now() + 86400000;
    const user = createUser({
      username: 'temp_user',
      passwordHash: hashPassword('temp123'),
      roleId: 'role_viewer',
      forcePasswordChange: 1,
      tempPasswordExpiresAt: expiresAt,
    });
    expect(user.forcePasswordChange).toBe(1);
    expect(user.tempPasswordExpiresAt).toBe(expiresAt);
  });
});

describe('last admin protection', () => {
  it('should prevent deleting the last enabled admin', () => {
    const admin = createUser({
      username: 'admin1',
      passwordHash: hashPassword('pass'),
      roleId: 'role_admin',
    });
    expect(() => deleteUser(admin.id)).toThrow('无法删除最后一个启用的管理员');
  });

  it('should prevent disabling the last enabled admin', () => {
    const admin = createUser({
      username: 'admin2',
      passwordHash: hashPassword('pass'),
      roleId: 'role_admin',
    });
    expect(() => disableUser(admin.id)).toThrow('无法禁用最后一个启用的管理员');
  });

  it('should prevent demoting the last enabled admin', () => {
    const admin = createUser({
      username: 'admin3',
      passwordHash: hashPassword('pass'),
      roleId: 'role_admin',
    });
    expect(() => updateUser(admin.id, { roleId: 'role_member' })).toThrow('无法降级最后一个启用的管理员');
  });

  it('should allow deletion when a second admin exists', () => {
    const admin1 = createUser({ username: 'a1', passwordHash: 'x', roleId: 'role_admin' });
    const admin2 = createUser({ username: 'a2', passwordHash: 'y', roleId: 'role_admin' });
    expect(() => deleteUser(admin1.id)).not.toThrow();
    expect(getUserById(admin1.id)).toBeNull();
  });
});

describe('login lockout', () => {
  it('should lock account after 5 consecutive failures', () => {
    const user = createUser({ username: 'lockme', passwordHash: 'x', roleId: 'role_member' });
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(user.id);
    }
    const updated = getUserById(user.id)!;
    expect(updated.failedLoginCount).toBe(5);
    expect(updated.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('should reset failures on successful login', () => {
    const user = createUser({ username: 'resetme', passwordHash: 'x', roleId: 'role_member' });
    recordLoginFailure(user.id);
    recordLoginFailure(user.id);
    resetLoginFailures(user.id);
    const updated = getUserById(user.id)!;
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });
});
