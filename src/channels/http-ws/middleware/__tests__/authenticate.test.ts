// src/channels/http-ws/middleware/__tests__/authenticate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initSystemDb, closeSystemDb } from '../../../../auth/db.js';
import { initBuiltinRoles } from '../../../../auth/roles-store.js';
import { createUser } from '../../../../auth/users-store.js';
import { hashPassword } from '../../../../auth/password.js';
import { login } from '../../../../auth/auth-service.js';
import { createAuthMiddleware } from '../authenticate.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let accessToken: string;
let app: import('express').Express;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-mw-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'alice', passwordHash: await hashPassword('pass'), roleId: 'role_member' });
  const result = await login({ username: 'alice', password: 'pass' });
  accessToken = result.accessToken;

  // 每次创建新 app 实例，避免中间件堆叠
  app = express();
  app.use(createAuthMiddleware());
  app.get('/test', (req, res) => res.json({ ok: true, userId: (req as any).user?.userId }));
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

it('should attach user to req on valid Bearer token', async () => {
  const res = await request(app)
    .get('/test')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(200);
  expect(res.body.userId).toBeTruthy();
});

it('should reject missing token with 401', async () => {
  const res = await request(app).get('/test');
  expect(res.status).toBe(401);
});

it('should reject invalid token with 401', async () => {
  const res = await request(app)
    .get('/test')
    .set('Authorization', 'Bearer invalid.token.here');
  expect(res.status).toBe(401);
});

it('should allow token via query param ?token=', async () => {
  const res = await request(app)
    .get(`/test?token=${accessToken}`);
  expect(res.status).toBe(200);
});
