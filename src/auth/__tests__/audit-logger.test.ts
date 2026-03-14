// src/auth/__tests__/audit-logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { logAuditEvent, getAuditLogs, AuditAction } from '../audit-logger.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

it('should log a login_success event', () => {
  logAuditEvent({
    action: 'login_success',
    userId: 'user_abc',
    username: 'alice',
    ipAddress: '127.0.0.1',
    userAgent: 'Chrome',
  });

  const logs = getAuditLogs({ userId: 'user_abc' });
  expect(logs).toHaveLength(1);
  expect(logs[0].action).toBe('login_success');
  expect(logs[0].username).toBe('alice');
});

it('should log detail as JSON string', () => {
  logAuditEvent({
    action: 'role_permission_changed',
    userId: 'user_xyz',
    username: 'admin',
    detail: { roleId: 'role_member', before: ['chat'], after: ['chat', 'viewHistory'] },
  });

  const logs = getAuditLogs({ action: 'role_permission_changed' });
  expect(logs).toHaveLength(1);
  const parsed = JSON.parse(logs[0].detail!);
  expect(parsed.roleId).toBe('role_member');
});

it('should filter by action', () => {
  logAuditEvent({ action: 'login_success', userId: 'u1', username: 'a' });
  logAuditEvent({ action: 'login_failed', userId: 'u1', username: 'a' });
  const failed = getAuditLogs({ action: 'login_failed' });
  expect(failed).toHaveLength(1);
});

it('should limit result count', () => {
  for (let i = 0; i < 10; i++) {
    logAuditEvent({ action: 'login_success', userId: 'u1', username: 'a' });
  }
  const logs = getAuditLogs({ limit: 3 });
  expect(logs).toHaveLength(3);
});
