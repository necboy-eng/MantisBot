// src/channels/http-ws/routes/__tests__/users-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { initSystemDb, closeSystemDb } from '../../../../auth/db.js';
import { initBuiltinRoles } from '../../../../auth/roles-store.js';
import { createUser } from '../../../../auth/users-store.js';
import { hashPassword } from '../../../../auth/password.js';
import { login } from '../../../../auth/auth-service.js';
import { createAuthMiddleware } from '../../middleware/authenticate.js';
import { usersRouter } from '../users-routes.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let adminToken: string;
let memberToken: string;
let app: express.Express;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'users-routes-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'admin', passwordHash: await hashPassword('pass'), roleId: 'role_admin' });
  createUser({ username: 'member', passwordHash: await hashPassword('pass'), roleId: 'role_member' });
  adminToken = (await login({ username: 'admin', password: 'pass' })).accessToken;
  memberToken = (await login({ username: 'member', password: 'pass' })).accessToken;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createAuthMiddleware());
  app.use('/api', usersRouter);
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

describe('GET /api/users', () => {
  it('should return user list for admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Should not expose passwordHash
    expect(res.body[0].passwordHash).toBeUndefined();
  });

  it('should deny non-admin access with 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users', () => {
  it('should create a new user (admin only)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newuser', password: 'Pass12345!', roleId: 'role_viewer' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('newuser');
    expect(res.body.passwordHash).toBeUndefined();
  });
});

describe('PATCH /api/users/:id', () => {
  it('should update user role (admin only)', async () => {
    // Get member user id first
    const listRes = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const member = listRes.body.find((u: any) => u.username === 'member');

    const res = await request(app)
      .patch(`/api/users/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: 'role_viewer' });
    expect(res.status).toBe(200);
    expect(res.body.roleId).toBe('role_viewer');
  });
});

describe('GET /api/roles', () => {
  it('should return roles list', async () => {
    const res = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((r: any) => r.id === 'role_admin')).toBe(true);
  });
});

describe('Path ACL endpoints', () => {
  it('should set and retrieve role path ACL', async () => {
    const putRes = await request(app)
      .put('/api/path-acl/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: 'role_member', storageId: 'local', path: '/shared', permission: 'read' });
    expect(putRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/path-acl?roleId=role_member&storageId=local')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.length).toBeGreaterThanOrEqual(1);
    expect(getRes.body[0].path).toBe('/shared');
  });

  it('should deny path-acl access to non-admin', async () => {
    const res = await request(app)
      .get('/api/path-acl?roleId=role_member')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });
});
