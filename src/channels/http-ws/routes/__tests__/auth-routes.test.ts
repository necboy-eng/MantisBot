// src/channels/http-ws/routes/__tests__/auth-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { initSystemDb, closeSystemDb } from '../../../../auth/db.js';
import { initBuiltinRoles } from '../../../../auth/roles-store.js';
import { createUser } from '../../../../auth/users-store.js';
import { hashPassword } from '../../../../auth/password.js';
import { authRouter } from '../auth-routes.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let app: express.Express;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-routes-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'alice', passwordHash: await hashPassword('password123'), roleId: 'role_member' });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

describe('POST /auth/login', () => {
  it('should return accessToken and set refreshToken cookie', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/rt=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('should return 401 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('should return 400 on missing fields', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'alice' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  it('should return new accessToken with valid RT cookie', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'password123' });
    const cookies = loginRes.headers['set-cookie'];

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookies);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
  });

  it('should return 401 without RT cookie', async () => {
    const res = await request(app).post('/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('should clear the RT cookie', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'password123' });
    const cookies = loginRes.headers['set-cookie'];

    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Cookie', cookies);
    expect(logoutRes.status).toBe(200);
    // Cookie should be cleared (Max-Age=0 or Expires in past)
    expect(logoutRes.headers['set-cookie'][0]).toMatch(/rt=;|Max-Age=0/);
  });
});
