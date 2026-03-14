// src/channels/http-ws/middleware/__tests__/require-permission.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initSystemDb, closeSystemDb } from '../../../../auth/db.js';
import { initBuiltinRoles } from '../../../../auth/roles-store.js';
import { createUser } from '../../../../auth/users-store.js';
import { hashPassword } from '../../../../auth/password.js';
import { login } from '../../../../auth/auth-service.js';
import { createAuthMiddleware } from '../authenticate.js';
import { requirePermission } from '../require-permission.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let memberToken: string;
let adminToken: string;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'perm-mw-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  // member 有 chat 权限
  createUser({ username: 'member', passwordHash: await hashPassword('pass'), roleId: 'role_member' });
  // admin 有所有权限
  createUser({ username: 'admin', passwordHash: await hashPassword('pass'), roleId: 'role_admin' });
  memberToken = (await login({ username: 'member', password: 'pass' })).accessToken;
  adminToken = (await login({ username: 'admin', password: 'pass' })).accessToken;
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

function makeApp(permission: string) {
  const app = express();
  app.use(createAuthMiddleware());
  app.get('/protected', requirePermission(permission), (req, res) => res.json({ ok: true }));
  return app;
}

it('should allow admin to access any permission', async () => {
  const app = makeApp('manageUsers');
  const res = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
});

it('should deny if user lacks the permission', async () => {
  const app = makeApp('manageUsers');
  const res = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(403);
});

it('should allow if user has the permission in JWT', async () => {
  // role_member has chat permission
  const app = makeApp('chat');
  const res = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${memberToken}`);
  expect(res.status).toBe(200);
});

it('should return 401 if not authenticated', async () => {
  const app = makeApp('chat');
  const res = await request(app).get('/protected');
  expect(res.status).toBe(401);
});
