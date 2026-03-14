// src/auth/__tests__/path-acl-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import { createUser } from '../users-store.js';
import { hashPassword } from '../password.js';
import {
  setRolePathAcl, setUserPathAcl, resolveAccess,
  getPathAclForRole, getPathAclForUser, deletePathAcl,
} from '../path-acl-store.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let userId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'path-acl-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  const user = createUser({ username: 'alice', passwordHash: hashPassword('x'), roleId: 'role_member' });
  userId = user.id;
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

const SID = 'local'; // storageId used in all tests

describe('resolveAccess', () => {
  it('should deny by default with no ACL rules', () => {
    const result = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/secret.txt' });
    expect(result.granted).toBe(false);
  });

  it('should grant access via role rule', () => {
    setRolePathAcl({ roleId: 'role_member', storageId: SID, path: '/files/shared', permission: 'read' });
    const result = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/shared/doc.pdf' });
    expect(result.granted).toBe(true);
    expect(result.source).toBe('role');
  });

  it('should user override deny role grant', () => {
    setRolePathAcl({ roleId: 'role_member', storageId: SID, path: '/files/shared', permission: 'read' });
    setUserPathAcl({ userId, storageId: SID, path: '/files/shared/private', permission: 'deny' });
    const result = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/shared/private/secret.txt' });
    expect(result.granted).toBe(false);
    expect(result.source).toBe('user');
  });

  it('should use longest-prefix match', () => {
    setRolePathAcl({ roleId: 'role_member', storageId: SID, path: '/files', permission: 'read' });
    setRolePathAcl({ roleId: 'role_member', storageId: SID, path: '/files/restricted', permission: 'deny' });
    const open = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/open.txt' });
    expect(open.granted).toBe(true);
    const restricted = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/restricted/top.txt' });
    expect(restricted.granted).toBe(false);
  });

  it('should grant write implies read', () => {
    setRolePathAcl({ roleId: 'role_member', storageId: SID, path: '/files/writable', permission: 'write' });
    const readResult = resolveAccess({ roleId: 'role_member', userId, storageId: SID, requestPath: '/files/writable/doc.txt', requiredPermission: 'read' });
    expect(readResult.granted).toBe(true);
  });

  it('should admin always have full access', () => {
    const result = resolveAccess({ roleId: 'role_admin', userId, storageId: SID, requestPath: '/files/anything/deep' });
    expect(result.granted).toBe(true);
    expect(result.source).toBe('admin');
  });
});
