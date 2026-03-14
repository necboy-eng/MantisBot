// src/channels/http-ws/middleware/__tests__/file-access-guard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initSystemDb, closeSystemDb } from '../../../../auth/db.js';
import { initBuiltinRoles } from '../../../../auth/roles-store.js';
import { createUser } from '../../../../auth/users-store.js';
import { hashPassword } from '../../../../auth/password.js';
import { login } from '../../../../auth/auth-service.js';
import { setRolePathAcl } from '../../../../auth/path-acl-store.js';
import { createAuthMiddleware } from '../authenticate.js';
import { fileAccessGuard } from '../file-access-guard.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let memberToken: string;
let adminToken: string;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'file-guard-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'member', passwordHash: await hashPassword('pass'), roleId: 'role_member' });
  createUser({ username: 'admin', passwordHash: await hashPassword('pass'), roleId: 'role_admin' });
  memberToken = (await login({ username: 'member', password: 'pass' })).accessToken;
  adminToken = (await login({ username: 'admin', password: 'pass' })).accessToken;

  // Grant role_member read on /shared
  setRolePathAcl({ roleId: 'role_member', storageId: 'local', path: '/shared', permission: 'read' });
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

function makeApp(accessType: 'read' | 'write' = 'read') {
  const app = express();
  app.use(createAuthMiddleware());
  // Route matches /files/:storageId/*
  app.get('/files/:storageId/*', fileAccessGuard(accessType), (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

it('should allow access to permitted path', async () => {
  const res = await request(makeApp())
    .get('/files/local/shared/doc.txt')
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(200);
});

it('should deny access to non-permitted path', async () => {
  const res = await request(makeApp())
    .get('/files/local/private/doc.txt')
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(403);
});

it('should allow admin to access any path', async () => {
  const res = await request(makeApp('write'))
    .get('/files/local/private/top-secret.txt')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
});
