// src/auth/__tests__/roles-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import {
  initBuiltinRoles,
  getRoleById,
  getRoleByName,
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  type Role
} from '../roles-store.js';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

describe('RolesStore', () => {
  const testDbPath = join(process.cwd(), 'data', 'test-roles-system.db');

  beforeEach(() => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
    initSystemDb(testDbPath);
  });

  afterEach(() => {
    closeSystemDb();
    if (existsSync(testDbPath)) rmSync(testDbPath);
  });

  it('should initialize builtin roles', () => {
    initBuiltinRoles();

    const adminRole = getRoleById('role_admin');
    expect(adminRole).toBeDefined();
    expect(adminRole?.name).toBe('管理员');
    expect(adminRole?.isBuiltin).toBe(1);
    expect(adminRole?.permissions.manageUsers).toBe(true);

    const memberRole = getRoleById('role_member');
    expect(memberRole).toBeDefined();
    expect(memberRole?.permissions.chat).toBe(true);
    expect(memberRole?.permissions.manageUsers).toBe(false);
  });

  it('should get role by name', () => {
    initBuiltinRoles();

    const role = getRoleByName('管理员');
    expect(role).toBeDefined();
    expect(role?.id).toBe('role_admin');
  });

  it('should create custom role', () => {
    initBuiltinRoles();

    const newRole: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> = {
      name: '研发团队',
      description: '研发部门成员',
      isBuiltin: 0,
      permissions: {
        chat: true,
        viewHistory: true,
        useAgentTeams: true,
        useFileManager: true,
        editModelConfig: false,
        editServerConfig: false,
        manageUsers: false,
        accessStorage: false,
        installSkills: true,
        managePlugins: false,
      },
    };

    const created = createRole(newRole);
    expect(created.id).toMatch(/^role_/);
    expect(created.name).toBe('研发团队');
    expect(created.permissions.installSkills).toBe(true);
  });

  it('should not delete builtin role', () => {
    initBuiltinRoles();

    expect(() => deleteRole('role_admin')).toThrow('无法删除内置角色');
  });

  it('should update role permissions', () => {
    initBuiltinRoles();

    const customRole = createRole({
      name: '测试角色',
      permissions: { chat: true },
      isBuiltin: 0,
    });

    const updated = updateRole(customRole.id, {
      permissions: { chat: true, viewHistory: true },
    });

    expect(updated.permissions.viewHistory).toBe(true);
  });
});
