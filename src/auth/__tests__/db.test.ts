// src/auth/__tests__/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb, getSystemDb } from '../db.js';
import { existsSync } from 'fs';
import { join } from 'path';

describe('SystemDb', () => {
  const testDbPath = join(process.cwd(), 'data', 'test-system.db');

  beforeEach(() => {
    // 确保测试前关闭已有连接
    closeSystemDb();
  });

  afterEach(() => {
    closeSystemDb();
  });

  it('should create database file if not exists', () => {
    initSystemDb(testDbPath);
    expect(existsSync(testDbPath)).toBe(true);
  });

  it('should create all required tables', () => {
    const db = initSystemDb(testDbPath);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    const tableNames = tables.map((t: any) => t.name);

    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('refresh_tokens');
    expect(tableNames).toContain('path_acl');
    expect(tableNames).toContain('audit_logs');
  });

  it('should return same instance on multiple calls', () => {
    const db1 = initSystemDb(testDbPath);
    const db2 = getSystemDb();
    expect(db1).toBe(db2);
  });
});
