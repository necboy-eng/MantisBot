# MantisBot 用户权限管理系统实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的多用户权限管理体系，包括 RBAC 角色、路径 ACL、JWT+RT 会话机制、SQLite 系统库。

**Architecture:**
- 后端认证核心模块（`src/auth/`）不依赖 Express，便于未来复用
- 中间件层与路由层分离，HTTP 与 WS 鉴权统一
- AT 仅存内存 + HttpOnly Cookie RT，兼顾安全与无感刷新

**Tech Stack:**
- 后端：Node.js 22+ / TypeScript / Express / node:sqlite / argon2 / jsonwebtoken
- 前端：React / React Router / Zustand（或 Context）/ Tailwind
- 测试：Vitest

---

## 文件结构规划

### 后端新增文件

```
src/auth/
├── db.ts                      # system.db 初始化、Schema 迁移
├── jwt.ts                     # AT 签发/验证、启动时校验 JWT_SECRET
├── password.ts                # argon2id 哈希/验证
├── token-store.ts             # refresh_tokens CRUD + 轮转宽限期
├── users-store.ts             # users CRUD + 最后admin保护 + 登录锁定
├── roles-store.ts             # roles CRUD + 内置角色初始化
├── path-acl-store.ts          # path_acl CRUD + 安全前缀匹配
├── audit-logger.ts            # audit_logs 写入
├── auth-service.ts            # 组合以上暴露业务方法
└── __tests__/
    ├── db.test.ts
    ├── jwt.test.ts
    ├── password.test.ts
    ├── token-store.test.ts
    ├── users-store.test.ts
    ├── roles-store.test.ts
    └── path-acl-store.test.ts

src/channels/http-ws/
├── middleware/
│   ├── authenticate.ts        # 替换旧 auth-middleware.ts
│   ├── require-permission.ts  # requirePermission(key) 工厂
│   └── file-access-guard.ts   # fileAccessGuard 中间件
└── routes/
    ├── auth-routes.ts         # /auth/login|logout|refresh
    └── users-routes.ts        # /api/users /api/roles /api/path-acl

src/
└── cli.ts                     # reset-admin-password CLI 命令
```

### 前端新增/修改文件

```
web-ui/src/
├── stores/
│   └── auth-store.ts          # AT 内存管理（Zustand）
├── hooks/
│   └── usePermission.ts       # 细粒度权限检查
├── components/
│   ├── LoginPage.tsx          # 重写
│   ├── UserManagementSection.tsx  # 重写
│   ├── RoleManagementSection.tsx  # 新增
│   └── PathAclEditor.tsx      # 新增
└── utils/
    └── auth.ts                # 修改：移除 localStorage，改用内存 + Cookie
```

---

## Chunk 1: 数据库初始化与密码模块

### Task 1: 系统数据库初始化

**Files:**
- Create: `src/auth/db.ts`
- Create: `src/auth/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing test for database initialization**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run src/auth/__tests__/db.test.ts`
Expected: FAIL with "Cannot find module '../db.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/auth/db.ts
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '../../data');

export interface SystemDb {
  prepare(sql: string): any;
  exec(sql: string): void;
  close(): void;
  transaction<T>(fn: () => T): T;
}

class SystemDbImpl implements SystemDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
    console.log('[SystemDb] Database initialized:', dbPath);
  }

  private initializeSchema(): void {
    this.db.exec(`
      -- roles 表
      CREATE TABLE IF NOT EXISTS roles (
        id           TEXT PRIMARY KEY,
        name         TEXT UNIQUE NOT NULL,
        description  TEXT,
        is_builtin   INTEGER DEFAULT 0,
        permissions  TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      -- users 表
      CREATE TABLE IF NOT EXISTS users (
        id                       TEXT PRIMARY KEY,
        username                 TEXT UNIQUE NOT NULL,
        password_hash            TEXT NOT NULL,
        display_name             TEXT,
        email                    TEXT,
        role_id                  TEXT NOT NULL DEFAULT 'role_member',
        is_enabled               INTEGER NOT NULL DEFAULT 1,
        failed_login_count       INTEGER NOT NULL DEFAULT 0,
        locked_until             INTEGER,
        force_password_change    INTEGER NOT NULL DEFAULT 0,
        temp_password_expires_at INTEGER,
        last_login_at            INTEGER,
        created_at               INTEGER NOT NULL,
        updated_at               INTEGER NOT NULL,
        FOREIGN KEY (role_id) REFERENCES roles(id)
      );

      -- refresh_tokens 表
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL,
        token_hash     TEXT NOT NULL UNIQUE,
        user_agent     TEXT,
        ip_address     TEXT,
        is_revoked     INTEGER NOT NULL DEFAULT 0,
        rotated_at     INTEGER,
        next_token_id  TEXT,
        next_raw_token TEXT,
        expires_at     INTEGER NOT NULL,
        created_at     INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- path_acl 表
      CREATE TABLE IF NOT EXISTS path_acl (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_type  TEXT NOT NULL,
        subject_id    TEXT NOT NULL,
        storage_id    TEXT NOT NULL,
        path          TEXT NOT NULL,
        permission    TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_path_acl
        ON path_acl(subject_type, subject_id, storage_id, path);

      -- audit_logs 表
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        action      TEXT NOT NULL,
        user_id     TEXT,
        username    TEXT,
        ip_address  TEXT,
        user_agent  TEXT,
        detail      TEXT,
        created_at  INTEGER NOT NULL
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `);
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

let globalDb: SystemDbImpl | null = null;
let globalDbPath: string | null = null;

export function initSystemDb(dbPath?: string): SystemDb {
  const finalPath = dbPath || join(DEFAULT_DATA_DIR, 'system.db');

  if (globalDb && globalDbPath === finalPath) {
    return globalDb;
  }

  if (globalDb) {
    globalDb.close();
  }

  globalDb = new SystemDbImpl(finalPath);
  globalDbPath = finalPath;

  return globalDb;
}

export function getSystemDb(): SystemDb {
  if (!globalDb) {
    return initSystemDb();
  }
  return globalDb;
}

export function closeSystemDb(): void {
  if (globalDb) {
    globalDb.close();
    globalDb = null;
    globalDbPath = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run src/auth/__tests__/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/db.ts src/auth/__tests__/db.test.ts
git commit -m "feat(auth): add system database initialization with schema migration

- Create roles, users, refresh_tokens, path_acl, audit_logs tables
- Add indexes for common queries
- Support transaction wrapper
- Add unit tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2: 密码哈希模块

**Files:**
- Create: `src/auth/password.ts`
- Create: `src/auth/__tests__/password.test.ts`

- [ ] **Step 1: Write the failing test for password hashing**

```typescript
// src/auth/__tests__/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('Password', () => {
  it('should hash password with argon2id format', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^argon2id:/);
  });

  it('should verify correct password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject wrong password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword('wrongPassword', hash);
    expect(isValid).toBe(false);
  });

  it('should reject old SHA-256 format when verifying', async () => {
    // 旧格式 SHA-256 哈希
    const oldHash = 'sha256:5e884898da28047d9f5dcb6c05e24b16da28047d9f5dcb6c05e24b16';
    const isValid = await verifyPassword('password', oldHash);
    expect(isValid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run src/auth/__tests__/password.test.ts`
Expected: FAIL with "Cannot find module '../password.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/auth/password.ts
import * as argon2 from 'argon2';

/**
 * 使用 argon2id 算法哈希密码
 * 返回格式：argon2:$argon2id$v=19$m=65536,t=3,p=4$...
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  const hash = await argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,      // 64 MB
    timeCost: 3,             // 3 iterations
    parallelism: 4,          // 4 threads
  });
  return `argon2id:${hash}`;
}

/**
 * 验证密码是否匹配
 * 仅支持 argon2id 格式，拒绝旧 SHA-256 格式
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string
): Promise<boolean> {
  // 拒绝旧的 SHA-256 格式
  if (storedHash.startsWith('sha256:')) {
    return false;
  }

  // 解析 argon2id: 前缀
  if (!storedHash.startsWith('argon2id:')) {
    return false;
  }

  const actualHash = storedHash.slice('argon2id:'.length);

  try {
    return await argon2.verify(actualHash, plainPassword);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Install argon2 dependency**

Run: `npm install argon2 && npm install -D @types/argon2`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run src/auth/__tests__/password.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/password.ts src/auth/__tests__/password.test.ts package.json package-lock.json
git commit -m "feat(auth): add argon2id password hashing module

- Hash passwords with argon2id algorithm (memory=64MB, time=3, parallelism=4)
- Reject legacy SHA-256 format during verification
- Add unit tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 3: JWT 模块

**Files:**
- Create: `src/auth/jwt.ts`
- Create: `src/auth/__tests__/jwt.test.ts`

- [ ] **Step 1: Write the failing test for JWT operations**

```typescript
// src/auth/__tests__/jwt.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  validateJwtSecret,
  type JWTPayload
} from '../jwt.js';

describe('JWT', () => {
  const originalEnv = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.JWT_SECRET = originalEnv;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  it('should sign and verify access token', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true, viewHistory: true },
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = signAccessToken(payload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.username).toBe(payload.username);
    expect(decoded.permissions.chat).toBe(true);
  });

  it('should reject token with wrong secret', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true },
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = signAccessToken(payload);

    // 使用错误的 secret 验证
    process.env.JWT_SECRET = 'wrong-secret-key-must-be-at-least-32-bytes!!';
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('should reject expired token', () => {
    const payload: JWTPayload = {
      userId: 'u_12345678',
      username: 'testuser',
      roleId: 'role_member',
      roleName: '普通成员',
      permissions: { chat: true },
      exp: Math.floor(Date.now() / 1000) - 1,  // 已过期
      iat: Math.floor(Date.now() / 1000) - 1000,
    };

    const token = signAccessToken(payload);
    expect(() => verifyAccessToken(token)).toThrow('jwt expired');
  });

  it('should validate JWT_SECRET length', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => validateJwtSecret()).toThrow('at least 32 bytes');

    process.env.JWT_SECRET = 'this-is-a-valid-secret-key-with-32-bytes!!';
    expect(() => validateJwtSecret()).not.toThrow();
  });

  it('should reject alg=none token', () => {
    // 构造一个 alg=none 的恶意 token（简化示例）
    const maliciousToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ1XzEyMyJ9.';

    expect(() => verifyAccessToken(maliciousToken)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run src/auth/__tests__/jwt.test.ts`
Expected: FAIL with "Cannot find module '../jwt.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/auth/jwt.ts
import * as jwt from 'jsonwebtoken';

export interface JWTPayload {
  userId: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: Record<string, boolean>;
  exp: number;
  iat: number;
}

/**
 * 校验 JWT_SECRET 环境变量
 * 必须至少 32 字节，否则拒绝启动
 */
export function validateJwtSecret(): void {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required. Generate with: openssl rand -base64 32');
  }

  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 bytes (current: ${secret.length}). ` +
      'Generate with: openssl rand -base64 32'
    );
  }
}

/**
 * 签发 Access Token
 */
export function signAccessToken(payload: JWTPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not set');
  }

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    // 不设置 expiresIn，由 payload.exp 控制
  });
}

/**
 * 验证 Access Token
 * 显式锁定算法为 HS256，防止算法混淆攻击
 */
export function verifyAccessToken(token: string): JWTPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not set');
  }

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],  // 锁定算法，拒绝 alg=none 等
  }) as JWTPayload;

  return decoded;
}
```

- [ ] **Step 4: Install jsonwebtoken dependency**

Run: `npm install jsonwebtoken && npm install -D @types/jsonwebtoken`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run src/auth/__tests__/jwt.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/jwt.ts src/auth/__tests__/jwt.test.ts package.json package-lock.json
git commit -m "feat(auth): add JWT access token module with algorithm lock

- Sign and verify access tokens with HS256
- Validate JWT_SECRET length >= 32 bytes at startup
- Lock algorithms to ['HS256'] to prevent algorithm confusion attacks
- Add unit tests including alg=none rejection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: 用户与角色存储

### Task 4: 角色存储模块

**Files:**
- Create: `src/auth/roles-store.ts`
- Create: `src/auth/__tests__/roles-store.test.ts`

- [ ] **Step 1: Write the failing test for roles store**

```typescript
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

describe('RolesStore', () => {
  const testDbPath = join(process.cwd(), 'data', 'test-roles-system.db');

  beforeEach(() => {
    initSystemDb(testDbPath);
  });

  afterEach(() => {
    closeSystemDb();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run src/auth/__tests__/roles-store.test.ts`
Expected: FAIL with "Cannot find module '../roles-store.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/auth/roles-store.ts
import { getSystemDb, type SystemDb } from './db.js';
import { v4 as uuidv4 } from 'uuid';

export interface Role {
  id: string;
  name: string;
  description?: string;
  isBuiltin: number;
  permissions: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
}

const BUILTIN_ROLES: Array<{ id: string; name: string; description: string; permissions: Record<string, boolean> }> = [
  {
    id: 'role_admin',
    name: '管理员',
    description: '系统超级管理员，拥有所有权限',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: true,
      editModelConfig: true,
      editServerConfig: true,
      manageUsers: true,
      useFileManager: true,
      accessStorage: true,
      installSkills: true,
      managePlugins: true,
    },
  },
  {
    id: 'role_member',
    name: '普通成员',
    description: '普通团队成员',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: true,
      useFileManager: true,
      editModelConfig: false,
      editServerConfig: false,
      manageUsers: false,
      accessStorage: false,
      installSkills: false,
      managePlugins: false,
    },
  },
  {
    id: 'role_viewer',
    name: '访客',
    description: '只读访客',
    permissions: {
      chat: true,
      viewHistory: true,
      useAgentTeams: false,
      useFileManager: false,
      editModelConfig: false,
      editServerConfig: false,
      manageUsers: false,
      accessStorage: false,
      installSkills: false,
      managePlugins: false,
    },
  },
];

/**
 * 初始化内置角色（首次启动时调用）
 */
export function initBuiltinRoles(): void {
  const db = getSystemDb();
  const now = Date.now();

  for (const builtin of BUILTIN_ROLES) {
    const existing = db.prepare('SELECT id FROM roles WHERE id = ?').get(builtin.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO roles (id, name, description, is_builtin, permissions, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(
        builtin.id,
        builtin.name,
        builtin.description,
        JSON.stringify(builtin.permissions),
        now,
        now
      );
    }
  }
}

export function getRoleById(id: string): Role | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRoleByName(name: string): Role | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM roles WHERE name = ?').get(name);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllRoles(): Role[] {
  const db = getSystemDb();
  const rows = db.prepare('SELECT * FROM roles ORDER BY is_builtin DESC, name ASC').all();

  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.is_builtin,
    permissions: JSON.parse(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function createRole(input: RoleInput): Role {
  const db = getSystemDb();
  const now = Date.now();
  const id = `role_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

  db.prepare(`
    INSERT INTO roles (id, name, description, is_builtin, permissions, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description || null,
    JSON.stringify(input.permissions),
    now,
    now
  );

  return {
    id,
    name: input.name,
    description: input.description,
    isBuiltin: 0,
    permissions: input.permissions,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateRole(id: string, updates: Partial<RoleInput>): Role {
  const db = getSystemDb();
  const existing = getRoleById(id);
  if (!existing) {
    throw new Error(`角色不存在: ${id}`);
  }

  const now = Date.now();
  const updatedPermissions = updates.permissions || existing.permissions;
  const updatedName = updates.name || existing.name;
  const updatedDesc = updates.description !== undefined ? updates.description : existing.description;

  db.prepare(`
    UPDATE roles
    SET name = ?, description = ?, permissions = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updatedName,
    updatedDesc,
    JSON.stringify(updatedPermissions),
    now,
    id
  );

  return {
    ...existing,
    name: updatedName,
    description: updatedDesc,
    permissions: updatedPermissions,
    updatedAt: now,
  };
}

export function deleteRole(id: string): void {
  const db = getSystemDb();
  const role = getRoleById(id);
  if (!role) {
    throw new Error(`角色不存在: ${id}`);
  }

  if (role.isBuiltin === 1) {
    throw new Error('无法删除内置角色');
  }

  // 检查是否有用户使用该角色
  const usersWithRole = db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').get(id);
  if (usersWithRole.count > 0) {
    throw new Error(`无法删除：有 ${usersWithRole.count} 个用户正在使用该角色`);
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run src/auth/__tests__/roles-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/roles-store.ts src/auth/__tests__/roles-store.test.ts
git commit -m "feat(auth): add roles store with builtin roles initialization

- Support builtin roles: admin, member, viewer
- CRUD operations for custom roles
- Prevent deleting builtin roles
- Prevent deleting roles with users

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 5: 用户存储模块（含最后 admin 保护 + 登录锁定）

**Files:**
- Create: `src/auth/users-store.ts`
- Create: `src/auth/__tests__/users-store.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/auth/__tests__/users-store.test.ts`
Expected: FAIL — `Cannot find module '../users-store.js'`

- [ ] **Step 3: 实现 users-store.ts**

```typescript
// src/auth/users-store.ts
import { getSystemDb } from './db.js';
import { nanoid } from 'nanoid';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  roleId: string;
  displayName: string | null;
  email: string | null;
  isEnabled: number;           // 1 = enabled, 0 = disabled
  forcePasswordChange: number; // 1 = must change password on next login
  tempPasswordExpiresAt: number | null;
  failedLoginCount: number;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}
// Note: db.ts DDL must use column names: is_enabled, force_password_change,
// temp_password_expires_at, failed_login_count, locked_until, last_login_at

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  roleId: string;
  displayName?: string;
  email?: string;
  forcePasswordChange?: number;
  tempPasswordExpiresAt?: number | null;
}

export interface UpdateUserInput {
  passwordHash?: string;
  roleId?: string;
  displayName?: string;
  email?: string;
  isEnabled?: number;
  forcePasswordChange?: number;
  tempPasswordExpiresAt?: number | null;
}

/** 统计当前启用的 admin 数量 */
function countEnabledAdmins(): number {
  const db = getSystemDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM users
    WHERE role_id = 'role_admin' AND is_enabled = 1
  `).get();
  return row.count as number;
}

export function createUser(input: CreateUserInput): User {
  const db = getSystemDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const id = `user_${nanoid(12)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO users (
      id, username, password_hash, role_id, display_name, email,
      is_enabled, force_password_change, temp_password_expires_at,
      failed_login_count, locked_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, NULL, ?, ?)
  `).run(
    id,
    input.username,
    input.passwordHash,
    input.roleId,
    input.displayName ?? null,
    input.email ?? null,
    input.forcePasswordChange ?? 0,
    input.tempPasswordExpiresAt ?? null,
    now,
    now,
  );

  return getUserById(id)!;
}

export function getUserById(id: string): User | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? mapRow(row) : null;
}

export function getUserByUsername(username: string): User | null {
  const db = getSystemDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row ? mapRow(row) : null;
}

export function getAllUsers(): User[] {
  const db = getSystemDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(mapRow);
}

export function updateUser(id: string, updates: UpdateUserInput): User {
  const db = getSystemDb();
  const existing = getUserById(id);
  if (!existing) {
    throw new Error(`用户不存在: ${id}`);
  }

  // 最后 admin 保护：降级检查
  if (
    updates.roleId !== undefined &&
    updates.roleId !== 'role_admin' &&
    existing.roleId === 'role_admin' &&
    existing.isEnabled === 1 &&
    countEnabledAdmins() <= 1
  ) {
    throw new Error('无法降级最后一个启用的管理员');
  }

  const now = Date.now();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.passwordHash !== undefined) { fields.push('password_hash = ?'); values.push(updates.passwordHash); }
  if (updates.roleId !== undefined) { fields.push('role_id = ?'); values.push(updates.roleId); }
  if (updates.displayName !== undefined) { fields.push('display_name = ?'); values.push(updates.displayName); }
  if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
  if (updates.isEnabled !== undefined) { fields.push('is_enabled = ?'); values.push(updates.isEnabled); }
  if (updates.forcePasswordChange !== undefined) { fields.push('force_password_change = ?'); values.push(updates.forcePasswordChange); }
  if (updates.tempPasswordExpiresAt !== undefined) { fields.push('temp_password_expires_at = ?'); values.push(updates.tempPasswordExpiresAt); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id)!;
}

export function deleteUser(id: string): void {
  const db = getSystemDb();
  const user = getUserById(id);
  if (!user) throw new Error(`用户不存在: ${id}`);

  // 最后 admin 保护：删除检查
  if (user.roleId === 'role_admin' && user.isEnabled === 1 && countEnabledAdmins() <= 1) {
    throw new Error('无法删除最后一个启用的管理员');
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function enableUser(id: string): User {
  return updateUser(id, { isEnabled: 1 });
}

export function disableUser(id: string): User {
  const user = getUserById(id);
  if (!user) throw new Error(`用户不存在: ${id}`);

  // 最后 admin 保护：禁用检查
  if (user.roleId === 'role_admin' && user.isEnabled === 1 && countEnabledAdmins() <= 1) {
    throw new Error('无法禁用最后一个启用的管理员');
  }

  return updateUser(id, { isEnabled: 0 });
}

/** 记录一次登录失败；第5次起锁定15分钟 */
export function recordLoginFailure(id: string): void {
  const db = getSystemDb();
  const user = getUserById(id);
  if (!user) return;

  const newCount = user.failedLoginCount + 1;
  const lockedUntil = newCount >= 5 ? Date.now() + 15 * 60 * 1000 : user.lockedUntil;
  const now = Date.now();

  db.prepare(`
    UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?
  `).run(newCount, lockedUntil, now, id);
}

/** 登录成功后重置失败计数 */
export function resetLoginFailures(id: string): void {
  const db = getSystemDb();
  db.prepare(`
    UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?
  `).run(Date.now(), id);
}

function mapRow(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    roleId: row.role_id,
    displayName: row.display_name,
    email: row.email,
    isEnabled: row.is_enabled,
    forcePasswordChange: row.force_password_change,
    tempPasswordExpiresAt: row.temp_password_expires_at,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/auth/__tests__/users-store.test.ts`
Expected: PASS（所有用例通过）

- [ ] **Step 5: Commit**

```bash
git add src/auth/users-store.ts src/auth/__tests__/users-store.test.ts
git commit -m "feat(auth): add users store with admin protection and login lockout

- CRUD for users with nanoid-generated IDs
- Last admin protection: block delete/disable/demote when only one enabled admin
- Login lockout: 5 consecutive failures triggers 15-minute lock
- Support forcePasswordChange and tempPasswordExpiresAt for temporary passwords

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 6: Refresh Token 存储模块（含 grace period 轮换）

**Files:**
- Create: `src/auth/token-store.ts`
- Create: `src/auth/__tests__/token-store.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// src/auth/__tests__/token-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import { createUser } from '../users-store.js';
import { hashPassword } from '../password.js';
import {
  createRefreshToken, getRefreshToken, revokeToken,
  revokeAllUserTokens, countActiveTokens, rotateToken,
} from '../token-store.js';
import { getSystemDb } from '../db.js';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let userId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'token-store-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  const user = createUser({ username: 'testuser', passwordHash: hashPassword('pass'), roleId: 'role_member' });
  userId = user.id;
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createRefreshToken', () => {
  it('should create a token record', () => {
    const token = createRefreshToken({ userId, userAgent: 'test-agent', ipAddress: '127.0.0.1' });
    expect(token.id).toBeTruthy();
    expect(token.tokenHash).toBeTruthy();
    expect(token.userId).toBe(userId);
    expect(token.isRevoked).toBe(0);
    expect(token.rotatedAt).toBeNull();
    expect(token.nextTokenId).toBeNull();
  });

  it('should enforce max 5 concurrent sessions (evict oldest)', () => {
    for (let i = 0; i < 6; i++) {
      createRefreshToken({ userId, userAgent: `agent-${i}`, ipAddress: '127.0.0.1' });
    }
    expect(countActiveTokens(userId)).toBe(5);
  });
});

describe('getRefreshToken / revokeToken', () => {
  it('should retrieve token by raw token value', () => {
    const { rawToken, ...record } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const found = getRefreshToken(rawToken);
    expect(found?.id).toBe(record.id);
  });

  it('should revoke a token', () => {
    const { rawToken } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    revokeToken(rawToken);
    const found = getRefreshToken(rawToken);
    expect(found?.isRevoked).toBe(1);
  });
});

describe('rotateToken', () => {
  it('should create a new token and link the old one', () => {
    const { rawToken: oldRaw, id: oldId } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const { rawToken: newRaw, id: newId } = rotateToken(oldRaw);

    const oldRecord = getRefreshToken(oldRaw);
    expect(oldRecord?.rotatedAt).not.toBeNull();
    expect(oldRecord?.nextTokenId).toBe(newId);

    const newRecord = getRefreshToken(newRaw);
    expect(newRecord?.isRevoked).toBe(0);
  });

  it('should return next token idempotently within grace period', () => {
    const { rawToken: oldRaw } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    const { rawToken: newRaw1 } = rotateToken(oldRaw);
    // simulate retry within grace period — same old token presented again
    const { rawToken: newRaw2 } = rotateToken(oldRaw);
    // grace period returns the stored next_raw_token — same value
    expect(newRaw1).toBe(newRaw2);
  });

  it('should revoke all user tokens if old token is outside grace period', () => {
    const { rawToken: oldRaw } = createRefreshToken({ userId, userAgent: 'ua', ipAddress: '::1' });
    rotateToken(oldRaw);
    // Simulate replay after grace period by manipulating rotated_at directly via DB
    const db = getSystemDb();
    const oldHash = createHash('sha256').update(oldRaw).digest('hex');
    db.prepare("UPDATE refresh_tokens SET rotated_at = ? WHERE token_hash = ?")
      .run(Date.now() - 60000, oldHash);

    expect(() => rotateToken(oldRaw)).toThrow('token_reuse_detected');
    expect(countActiveTokens(userId)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/auth/__tests__/token-store.test.ts`
Expected: FAIL — `Cannot find module '../token-store.js'`

- [ ] **Step 3: 实现 token-store.ts**

```typescript
// src/auth/token-store.ts
import { createHash, randomBytes } from 'crypto';
import { getSystemDb } from './db.js';
import { nanoid } from 'nanoid';

const GRACE_PERIOD_MS = 30 * 1000; // 30 秒
const MAX_SESSIONS = 5;
const RT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  rawToken?: string; // 仅 createRefreshToken / rotateToken 返回时包含
  userAgent: string | null;
  ipAddress: string | null;
  isRevoked: number;
  rotatedAt: number | null;
  nextTokenId: string | null;
  // next_raw_token is stored in DB but not exposed in this interface
  // (accessed via row.next_raw_token directly in rotateToken)
  expiresAt: number;
  createdAt: number;
}
// Note: db.ts DDL must include next_raw_token TEXT column in refresh_tokens table

export interface CreateTokenInput {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createRefreshToken(input: CreateTokenInput): RefreshToken & { rawToken: string } {
  const db = getSystemDb();
  const now = Date.now();

  // 强制最大并发会话数：删除最旧的超量记录
  const activeTokens = db.prepare(`
    SELECT id FROM refresh_tokens
    WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
    ORDER BY created_at ASC
  `).all(input.userId, now);

  if (activeTokens.length >= MAX_SESSIONS) {
    const toEvict = activeTokens.slice(0, activeTokens.length - MAX_SESSIONS + 1);
    for (const t of toEvict) {
      db.prepare("UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?").run(t.id);
    }
  }

  const rawToken = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = `rt_${nanoid(12)}`;
  const expiresAt = now + RT_TTL_MS;

  db.prepare(`
    INSERT INTO refresh_tokens (
      id, user_id, token_hash, user_agent, ip_address,
      is_revoked, rotated_at, next_token_id, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    id, input.userId, tokenHash,
    input.userAgent ?? null, input.ipAddress ?? null,
    expiresAt, now,
  );

  const record = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(id);
  return { ...mapRow(record), rawToken };
}

export function getRefreshToken(rawToken: string): RefreshToken | null {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  return row ? mapRow(row) : null;
}

export function revokeToken(rawToken: string): void {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllUserTokens(userId: string): void {
  const db = getSystemDb();
  db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ?').run(userId);
}

export function countActiveTokens(userId: string): number {
  const db = getSystemDb();
  const now = Date.now();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM refresh_tokens
    WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
  `).get(userId, now);
  return row.count as number;
}

/**
 * 轮换 Refresh Token。
 *
 * - 纯撤销（is_revoked=1, rotated_at=null）→ token_revoked
 * - 已轮换且在 grace period 内 → 幂等返回存储的 next_raw_token（支持网络重试）
 * - 已轮换且超出 grace period → 重放攻击，撤销该用户所有 token
 * - 正常 → 创建新 token，将 next_raw_token 写入旧记录
 *
 * refresh_tokens 表需包含 next_raw_token TEXT 列（由 db.ts 建表时加入）。
 */
export function rotateToken(rawToken: string): RefreshToken & { rawToken: string } {
  const db = getSystemDb();
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);

  if (!row) {
    throw new Error('token_not_found');
  }

  const record = mapRow(row);

  // 纯撤销（未轮换）：is_revoked=1 且 rotated_at=null
  if (record.isRevoked === 1 && record.rotatedAt === null) {
    throw new Error('token_revoked');
  }

  // 已轮换处理
  if (record.rotatedAt !== null) {
    const withinGrace = Date.now() - record.rotatedAt < GRACE_PERIOD_MS;

    if (withinGrace && row.next_raw_token) {
      // grace period 内：幂等返回已存储的新 rawToken
      const nextRow = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(record.nextTokenId);
      if (nextRow) {
        return { ...mapRow(nextRow), rawToken: row.next_raw_token as string };
      }
    }

    // grace period 外 → 重放攻击
    revokeAllUserTokens(record.userId);
    throw new Error('token_reuse_detected');
  }

  if (record.expiresAt < Date.now()) {
    throw new Error('token_expired');
  }

  // 正常轮换
  const newToken = createRefreshToken({
    userId: record.userId,
    userAgent: record.userAgent ?? undefined,
    ipAddress: record.ipAddress ?? undefined,
  });

  // 标记旧 token 已轮换，并存储新 rawToken 以支持 grace period 幂等
  db.prepare(`
    UPDATE refresh_tokens
    SET rotated_at = ?, next_token_id = ?, next_raw_token = ?, is_revoked = 1
    WHERE id = ?
  `).run(Date.now(), newToken.id, newToken.rawToken, record.id);

  return newToken;
}

function mapRow(row: any): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    isRevoked: row.is_revoked,
    rotatedAt: row.rotated_at,
    nextTokenId: row.next_token_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/auth/__tests__/token-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/token-store.ts src/auth/__tests__/token-store.test.ts
git commit -m "feat(auth): add refresh token store with rotation and grace period

- Store RT as SHA-256 hash, never raw value
- Max 5 concurrent sessions per user (evict oldest)
- 30-second grace period for idempotent rotation on network retry
- Revoke all user tokens on reuse attack detection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 7: 路径 ACL 存储模块

**Files:**
- Create: `src/auth/path-acl-store.ts`
- Create: `src/auth/__tests__/path-acl-store.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/auth/__tests__/path-acl-store.test.ts`
Expected: FAIL — `Cannot find module '../path-acl-store.js'`

- [ ] **Step 3: 实现 path-acl-store.ts**

```typescript
// src/auth/path-acl-store.ts
import { getSystemDb } from './db.js';

export type AclPermission = 'read' | 'write' | 'deny';

export interface PathAclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;  // e.g. 'local' or 'nas-1'
  path: string;
  permission: AclPermission;
  createdAt: number;
}

export interface ResolveResult {
  granted: boolean;
  permission: AclPermission | null;
  source: 'admin' | 'user' | 'role' | 'default';
}

export interface ResolveInput {
  roleId: string;
  userId: string;
  storageId: string;    // e.g. 'local' or 'nas-1'
  requestPath: string;
  requiredPermission?: AclPermission;
}

/** Admin 始终有完整访问权限 */
const ADMIN_ROLE_ID = 'role_admin';

/** 写权限包含读权限 */
function permissionCovers(actual: AclPermission, required: AclPermission): boolean {
  if (actual === 'deny') return false;
  if (actual === 'write') return true; // write 包含 read
  return actual === required;
}

/**
 * 从 ACL 规则列表中找到匹配 requestPath 的最长前缀规则。
 * 使用精确前缀匹配：path '/' 分隔符方式避免 LIKE 注入。
 */
function findBestMatch(rules: PathAclEntry[], requestPath: string): PathAclEntry | null {
  let best: PathAclEntry | null = null;
  let bestLen = -1;

  for (const rule of rules) {
    const prefix = rule.path.endsWith('/') ? rule.path : rule.path + '/';
    const isMatch =
      requestPath === rule.path ||
      requestPath.startsWith(prefix);

    if (isMatch && rule.path.length > bestLen) {
      best = rule;
      bestLen = rule.path.length;
    }
  }

  return best;
}

export function resolveAccess(input: ResolveInput): ResolveResult {
  const { roleId, userId, storageId, requestPath, requiredPermission = 'read' } = input;

  // admin 始终授权
  if (roleId === ADMIN_ROLE_ID) {
    return { granted: true, permission: 'write', source: 'admin' };
  }

  const db = getSystemDb();

  // 查询用户级别规则（独立查询，避免 subject_type 混淆）
  const userRules = db.prepare(`
    SELECT * FROM path_acl
    WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ?
  `).all(userId, storageId) as PathAclEntry[];

  const userMatch = findBestMatch(userRules, requestPath);

  if (userMatch) {
    const granted = permissionCovers(userMatch.permission, requiredPermission);
    return { granted, permission: userMatch.permission, source: 'user' };
  }

  // 查询角色级别规则（独立查询）
  const roleRules = db.prepare(`
    SELECT * FROM path_acl
    WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ?
  `).all(roleId, storageId) as PathAclEntry[];

  const roleMatch = findBestMatch(roleRules, requestPath);

  if (roleMatch) {
    const granted = permissionCovers(roleMatch.permission, requiredPermission);
    return { granted, permission: roleMatch.permission, source: 'role' };
  }

  // 默认拒绝
  return { granted: false, permission: null, source: 'default' };
}

export function setRolePathAcl(input: {
  roleId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
}): void {
  const db = getSystemDb();
  const now = Date.now();

  const existing = db.prepare(`
    SELECT id FROM path_acl
    WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ? AND path = ?
  `).get(input.roleId, input.storageId, input.path);

  if (existing) {
    db.prepare(`UPDATE path_acl SET permission = ?, created_at = ? WHERE id = ?`)
      .run(input.permission, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO path_acl (subject_type, subject_id, storage_id, path, permission, created_at)
      VALUES ('role', ?, ?, ?, ?, ?)
    `).run(input.roleId, input.storageId, input.path, input.permission, now);
  }
}

export function setUserPathAcl(input: {
  userId: string;
  storageId: string;
  path: string;
  permission: AclPermission;
}): void {
  const db = getSystemDb();
  const now = Date.now();

  const existing = db.prepare(`
    SELECT id FROM path_acl
    WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ? AND path = ?
  `).get(input.userId, input.storageId, input.path);

  if (existing) {
    db.prepare(`UPDATE path_acl SET permission = ?, created_at = ? WHERE id = ?`)
      .run(input.permission, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO path_acl (subject_type, subject_id, storage_id, path, permission, created_at)
      VALUES ('user', ?, ?, ?, ?, ?)
    `).run(input.userId, input.storageId, input.path, input.permission, now);
  }
}

export function getPathAclForRole(roleId: string, storageId?: string): PathAclEntry[] {
  const db = getSystemDb();
  if (storageId) {
    return db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'role' AND subject_id = ? AND storage_id = ?`).all(roleId, storageId) as PathAclEntry[];
  }
  return db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'role' AND subject_id = ?`).all(roleId) as PathAclEntry[];
}

export function getPathAclForUser(userId: string, storageId?: string): PathAclEntry[] {
  const db = getSystemDb();
  if (storageId) {
    return db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'user' AND subject_id = ? AND storage_id = ?`).all(userId, storageId) as PathAclEntry[];
  }
  return db.prepare(`SELECT * FROM path_acl WHERE subject_type = 'user' AND subject_id = ?`).all(userId) as PathAclEntry[];
}

export function deletePathAcl(id: number): void {
  const db = getSystemDb();
  db.prepare('DELETE FROM path_acl WHERE id = ?').run(id);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/auth/__tests__/path-acl-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/path-acl-store.ts src/auth/__tests__/path-acl-store.test.ts
git commit -m "feat(auth): add path ACL store with longest-prefix matching

- Separate queries for user vs role rules (avoid subject_type confusion)
- Longest-prefix matching with exact '/' separator (no SQL injection via LIKE)
- User-level overrides role-level
- Admin role always grants full access
- Write permission implies read permission

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 8: 审计日志模块

**Files:**
- Create: `src/auth/audit-logger.ts`
- Create: `src/auth/__tests__/audit-logger.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/auth/__tests__/audit-logger.test.ts`
Expected: FAIL — `Cannot find module '../audit-logger.js'`

- [ ] **Step 3: 实现 audit-logger.ts**

```typescript
// src/auth/audit-logger.ts
import { getSystemDb } from './db.js';

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'token_reuse_detected'
  | 'logout'
  | 'create_user'
  | 'update_user'
  | 'delete_user'
  | 'admin_password_reset'
  | 'force_logout'
  | 'role_permission_changed'
  | 'path_acl_changed';

export interface AuditLogEntry {
  id: number;
  action: AuditAction;
  userId: string | null;
  username: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: number;
}

export interface LogAuditInput {
  action: AuditAction;
  userId?: string;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: Record<string, unknown> | string;
}

export interface GetAuditLogsInput {
  userId?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

export function logAuditEvent(input: LogAuditInput): void {
  const db = getSystemDb();
  const detail = input.detail !== undefined
    ? (typeof input.detail === 'string' ? input.detail : JSON.stringify(input.detail))
    : null;

  db.prepare(`
    INSERT INTO audit_logs (action, user_id, username, ip_address, user_agent, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.action,
    input.userId ?? null,
    input.username ?? null,
    input.ipAddress ?? null,
    input.userAgent ?? null,
    detail,
    Date.now(),
  );
}

export function getAuditLogs(input: GetAuditLogsInput = {}): AuditLogEntry[] {
  const db = getSystemDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (input.userId) { conditions.push('user_id = ?'); params.push(input.userId); }
  if (input.action) { conditions.push('action = ?'); params.push(input.action); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = input.limit ? `LIMIT ${input.limit}` : '';
  const offset = input.offset ? `OFFSET ${input.offset}` : '';

  return db.prepare(`
    SELECT * FROM audit_logs ${where} ORDER BY created_at DESC ${limit} ${offset}
  `).all(...params) as AuditLogEntry[];
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/auth/__tests__/audit-logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/audit-logger.ts src/auth/__tests__/audit-logger.test.ts
git commit -m "feat(auth): add audit logger with 11 mandatory event types

- Typed AuditAction union covers all required events
- Support detail as object (auto-serialized to JSON)
- Filterable by userId and action

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 9: 认证服务（业务逻辑编排层）

**Files:**
- Create: `src/auth/auth-service.ts`
- Create: `src/auth/__tests__/auth-service.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// src/auth/__tests__/auth-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSystemDb, closeSystemDb } from '../db.js';
import { initBuiltinRoles } from '../roles-store.js';
import { createUser } from '../users-store.js';
import { hashPassword } from '../password.js';
import { login, logout, refreshAccessToken } from '../auth-service.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-service-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'alice', passwordHash: hashPassword('password123'), roleId: 'role_member' });
});

afterEach(() => {
  closeSystemDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

describe('login', () => {
  it('should return accessToken and refreshToken on valid credentials', async () => {
    const result = await login({ username: 'alice', password: 'password123', ipAddress: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('should throw on wrong password', async () => {
    await expect(login({ username: 'alice', password: 'wrong', ipAddress: '::1' }))
      .rejects.toThrow('invalid_credentials');
  });

  it('should throw on unknown user', async () => {
    await expect(login({ username: 'ghost', password: 'x', ipAddress: '::1' }))
      .rejects.toThrow('invalid_credentials');
  });

  it('should lock account after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await login({ username: 'alice', password: 'wrong', ipAddress: '::1' }).catch(() => {});
    }
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('account_locked');
  });

  it('should reject disabled user', async () => {
    const { getUserByUsername, updateUser } = await import('../users-store.js');
    const user = getUserByUsername('alice')!;
    updateUser(user.id, { isEnabled: 0 });
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('account_disabled');
  });

  it('should reject temp password past expiry', async () => {
    const { getUserByUsername, updateUser } = await import('../users-store.js');
    const user = getUserByUsername('alice')!;
    updateUser(user.id, { forcePasswordChange: 1, tempPasswordExpiresAt: Date.now() - 1000 });
    await expect(login({ username: 'alice', password: 'password123', ipAddress: '::1' }))
      .rejects.toThrow('temp_password_expired');
  });
});

describe('refreshAccessToken', () => {
  it('should return new accessToken for valid refreshToken', async () => {
    const { refreshToken } = await login({ username: 'alice', password: 'password123', ipAddress: '::1' });
    const result = await refreshAccessToken({ rawRefreshToken: refreshToken });
    expect(result.accessToken).toBeTruthy();
  });

  it('should reject invalid refreshToken', async () => {
    await expect(refreshAccessToken({ rawRefreshToken: 'fake-token' }))
      .rejects.toThrow('token_not_found');
  });
});

describe('logout', () => {
  it('should revoke the refresh token', async () => {
    const { refreshToken } = await login({ username: 'alice', password: 'password123', ipAddress: '::1' });
    await logout({ rawRefreshToken: refreshToken });
    await expect(refreshAccessToken({ rawRefreshToken: refreshToken }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/auth/__tests__/auth-service.test.ts`
Expected: FAIL — `Cannot find module '../auth-service.js'`

- [ ] **Step 3: 实现 auth-service.ts**

```typescript
// src/auth/auth-service.ts
import { getUserByUsername, getUserById, recordLoginFailure, resetLoginFailures, updateUser } from './users-store.js';
import { getSystemDb } from './db.js';
import { verifyPassword } from './password.js';
import { signAccessToken, validateJwtSecret } from './jwt.js';
import { createRefreshToken, getRefreshToken, revokeToken, rotateToken } from './token-store.js';
import { logAuditEvent } from './audit-logger.js';
import { getRoleById } from './roles-store.js';

export interface LoginInput {
  username: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  forcePasswordChange: boolean;
}

export interface RefreshInput {
  rawRefreshToken: string;
  ipAddress?: string;
}

export interface RefreshResult {
  accessToken: string;
  newRefreshToken: string;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  validateJwtSecret();

  const user = getUserByUsername(input.username);

  // 用户不存在 → 统一返回 invalid_credentials（不泄露用户名是否存在）
  if (!user) {
    logAuditEvent({ action: 'login_failed', username: input.username, ipAddress: input.ipAddress });
    throw new Error('invalid_credentials');
  }

  // 1. 账户锁定检查（先于密码校验，防止锁定期间被暴力枚举）
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('account_locked');
  }

  // 2. 账户禁用检查（先于密码校验，禁用用户密码正确也不应重置失败计数）
  if (user.isEnabled === 0) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('account_disabled');
  }

  // 3. 密码校验
  if (!verifyPassword(input.password, user.passwordHash)) {
    recordLoginFailure(user.id);
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('invalid_credentials');
  }

  // 4. 临时密码过期检查
  if (user.forcePasswordChange === 1 && user.tempPasswordExpiresAt !== null && user.tempPasswordExpiresAt < Date.now()) {
    logAuditEvent({ action: 'login_failed', userId: user.id, username: user.username, ipAddress: input.ipAddress });
    throw new Error('temp_password_expired');
  }

  // 登录成功：重置失败计数，更新最后登录时间
  resetLoginFailures(user.id);
  updateUser(user.id, {}); // lastLoginAt updated separately
  // Update lastLoginAt directly
  getSystemDb().prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), user.id);

  const role = getRoleById(user.roleId);
  const permissions: string[] = role ? JSON.parse(role.permissions as string) : [];

  const accessToken = signAccessToken({
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
    roleName: role?.name ?? '',
    permissions,
  });

  const { rawToken: refreshToken } = createRefreshToken({
    userId: user.id,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  logAuditEvent({
    action: 'login_success',
    userId: user.id,
    username: user.username,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    accessToken,
    refreshToken,
    forcePasswordChange: user.forcePasswordChange === 1,
  };
}

export async function refreshAccessToken(input: RefreshInput): Promise<RefreshResult> {
  validateJwtSecret();

  const newTokenRecord = rotateToken(input.rawRefreshToken);

  const user = getUserById(newTokenRecord.userId);
  if (!user) throw new Error('user_not_found');

  const role = getRoleById(user.roleId);
  const permissions: string[] = role ? JSON.parse(role.permissions as string) : [];

  const accessToken = signAccessToken({
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
    roleName: role?.name ?? '',
    permissions,
  });

  return {
    accessToken,
    newRefreshToken: newTokenRecord.rawToken,
  };
}

export async function logout(input: { rawRefreshToken: string; userId?: string; username?: string }): Promise<void> {
  const record = getRefreshToken(input.rawRefreshToken);
  if (record) {
    revokeToken(input.rawRefreshToken);
    logAuditEvent({
      action: 'logout',
      userId: record.userId,
    });
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/auth/__tests__/auth-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth-service.ts src/auth/__tests__/auth-service.test.ts
git commit -m "feat(auth): add auth service orchestrating login/logout/refresh flows

- Login validates credentials, lockout, disabled, temp password expiry
- Uniform invalid_credentials for unknown user and wrong password
- Refresh token rotation via token-store
- Audit logging for all success and failure events

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```


---

## Chunk 3: HTTP 中间件

### Task 10: 认证中间件（替换旧 auth-middleware.ts）

**Files:**
- Create: `src/channels/http-ws/middleware/authenticate.ts`
- Modify: `src/channels/http-ws/auth-middleware.ts` (保留旧 API 作兼容层，转发到新中间件)

- [ ] **Step 1: 编写失败测试**

```typescript
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
  createUser({ username: 'alice', passwordHash: hashPassword('pass'), roleId: 'role_member' });
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
```

- [ ] **Step 2: 安装 supertest**

```bash
npm install --save-dev supertest @types/supertest
```

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/authenticate.test.ts`
Expected: FAIL — `Cannot find module '../authenticate.js'`

- [ ] **Step 3: 实现 authenticate.ts**

```typescript
// src/channels/http-ws/middleware/authenticate.ts
// 新的多用户 JWT 鉴权中间件，替代旧版 HMAC 单用户中间件

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../../../auth/jwt.js';
import { getConfig } from '../../../config/loader.js';

// 扩展 Express Request，附加解析后的用户信息
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken) {
    return queryToken;
  }
  return null;
}

/**
 * 新认证中间件。
 * - 若 config.server.auth.enabled=false → 放行（兼容旧行为）
 * - 否则解析 JWT AT，将 payload 附加到 req.user
 */
export function createAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();
    const authConfig = config.server?.auth;

    if (!authConfig?.enabled) {
      // auth 未启用时注入虚拟管理员身份，确保下游中间件正常工作
      req.user = {
        userId: 'anonymous',
        username: 'anonymous',
        roleId: 'role_admin',
        roleName: '管理员',
        permissions: ['*'],
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 86400,
      } as JWTPayload;
      return next();
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    try {
      const payload = verifyAccessToken(token);
      req.user = payload;
      return next();
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'TokenExpired', message: 'Token 已过期，请刷新' });
      }
      return res.status(401).json({ error: 'Unauthorized', message: 'Token 无效' });
    }
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/authenticate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-ws/middleware/authenticate.ts \
        src/channels/http-ws/middleware/__tests__/authenticate.test.ts
git commit -m "feat(auth): add JWT authentication middleware

- Replaces HMAC single-user auth with multi-user JWT verification
- Attaches verified JWT payload to req.user
- Returns 401 with distinct TokenExpired vs Unauthorized errors
- Passes through if auth disabled (backward compatible)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 11: 权限要求中间件

**Files:**
- Create: `src/channels/http-ws/middleware/require-permission.ts`
- Create: `src/channels/http-ws/middleware/__tests__/require-permission.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
  createUser({ username: 'member', passwordHash: hashPassword('pass'), roleId: 'role_member' });
  // admin 有所有权限
  createUser({ username: 'admin', passwordHash: hashPassword('pass'), roleId: 'role_admin' });
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
  // role_admin has ['*'] or all permissions listed
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
  // role_member has chat permission by default in initBuiltinRoles
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/require-permission.test.ts`
Expected: FAIL — `Cannot find module '../require-permission.js'`

- [ ] **Step 3: 实现 require-permission.ts**

```typescript
// src/channels/http-ws/middleware/require-permission.ts
import type { Request, Response, NextFunction } from 'express';

/**
 * 权限检查中间件工厂。
 * 依赖 authenticate 中间件先附加 req.user。
 *
 * JWT payload 的 permissions 字段：
 * - role_admin: ['*']（表示超级权限）
 * - 其他角色: 具体权限列表，如 ['chat', 'viewHistory']
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    // permissions 是 string[]，由 auth-service signAccessToken 签发
    // role_admin 携带 ['*'] 表示超级权限
    const permissions: string[] = Array.isArray(user.permissions)
      ? user.permissions
      : Object.keys(user.permissions ?? {}).filter(k => (user.permissions as any)[k]);

    // 超级权限（admin 角色）
    if (permissions.includes('*')) {
      return next();
    }

    if (!permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `缺少权限: ${permission}`,
      });
    }

    return next();
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/require-permission.test.ts`
Expected: PASS

Note: If the test for "allow if user has chat permission" fails because `role_member` doesn't include `chat` in its permissions list, update `initBuiltinRoles()` in `src/auth/roles-store.ts` to include `chat` in `role_member`'s permissions JSON.

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-ws/middleware/require-permission.ts \
        src/channels/http-ws/middleware/__tests__/require-permission.test.ts
git commit -m "feat(auth): add requirePermission middleware factory

- Reads permissions from JWT payload (no DB query needed)
- role_admin with ['*'] always passes
- Returns 403 Forbidden with missing permission name

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 12: 文件访问守卫中间件

**Files:**
- Create: `src/channels/http-ws/middleware/file-access-guard.ts`
- Create: `src/channels/http-ws/middleware/__tests__/file-access-guard.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
  createUser({ username: 'member', passwordHash: hashPassword('pass'), roleId: 'role_member' });
  createUser({ username: 'admin', passwordHash: hashPassword('pass'), roleId: 'role_admin' });
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/file-access-guard.test.ts`
Expected: FAIL — `Cannot find module '../file-access-guard.js'`

- [ ] **Step 3: 实现 file-access-guard.ts**

```typescript
// src/channels/http-ws/middleware/file-access-guard.ts
import type { Request, Response, NextFunction } from 'express';
import { resolveAccess } from '../../../auth/path-acl-store.js';

/**
 * 文件访问守卫中间件工厂。
 * 依赖 authenticate 中间件先附加 req.user。
 *
 * 路由格式：/files/:storageId/* 或 /files/:storageId/:path
 * storageId 从 req.params.storageId 读取；
 * 文件路径从路由剩余部分（/*）拼接，规范化为 '/...' 格式。
 */
export function fileAccessGuard(requiredPermission: 'read' | 'write' = 'read') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    // 从路由参数提取 storageId 和路径
    const storageId = req.params.storageId ?? 'local';
    // Express wildcard param is '0' for /*
    const rawPath = req.params[0] ?? '';
    const requestPath = '/' + rawPath.replace(/^\/+/, '');

    const result = resolveAccess({
      roleId: user.roleId,
      userId: user.userId,
      storageId,
      requestPath,
      requiredPermission,
    });

    if (!result.granted) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `无访问权限: ${requestPath}`,
      });
    }

    return next();
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/channels/http-ws/middleware/__tests__/file-access-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-ws/middleware/file-access-guard.ts \
        src/channels/http-ws/middleware/__tests__/file-access-guard.test.ts
git commit -m "feat(auth): add fileAccessGuard middleware for path-level ACL

- Reads storageId from route param, normalizes file path
- Delegates to path-acl-store.resolveAccess for permission check
- Supports read/write permission levels

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```


---

## Chunk 4: 认证与管理路由

### Task 13: 认证路由（/auth/login|logout|refresh）

**Files:**
- Create: `src/channels/http-ws/routes/auth-routes.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-routes-test-'));
  initSystemDb(join(tmpDir, 'system.db'));
  initBuiltinRoles();
  createUser({ username: 'alice', passwordHash: hashPassword('password123'), roleId: 'role_member' });

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
```

- [ ] **Step 2: 安装 cookie-parser**

```bash
npm install cookie-parser
npm install --save-dev @types/cookie-parser
```

Run: `npm run test:run src/channels/http-ws/routes/__tests__/auth-routes.test.ts`
Expected: FAIL — `Cannot find module '../auth-routes.js'`

- [ ] **Step 3: 实现 auth-routes.ts**

```typescript
// src/channels/http-ws/routes/auth-routes.ts
import { Router } from 'express';
import { login, logout, refreshAccessToken } from '../../../auth/auth-service.js';

export const authRouter = Router();

const RT_COOKIE = 'rt';
const RT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天（毫秒）

function setRtCookie(res: import('express').Response, rawToken: string) {
  res.cookie(RT_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: RT_MAX_AGE,
    path: '/auth',
  });
}

function clearRtCookie(res: import('express').Response) {
  res.clearCookie(RT_COOKIE, { path: '/auth' });
}

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少用户名或密码' });
  }

  try {
    const result = await login({
      username,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setRtCookie(res, result.refreshToken);

    return res.json({
      accessToken: result.accessToken,
      forcePasswordChange: result.forcePasswordChange,
    });
  } catch (err: any) {
    const status = ['account_locked', 'account_disabled', 'temp_password_expired'].includes(err.message) ? 403 : 401;
    return res.status(status).json({ error: err.message });
  }
});

// POST /auth/refresh
authRouter.post('/refresh', async (req, res) => {
  const rawRefreshToken = req.cookies?.[RT_COOKIE];

  if (!rawRefreshToken) {
    return res.status(401).json({ error: 'Unauthorized', message: '缺少 Refresh Token' });
  }

  try {
    const result = await refreshAccessToken({ rawRefreshToken, ipAddress: req.ip });

    // 轮换后设置新 RT Cookie
    setRtCookie(res, result.newRefreshToken);

    return res.json({ accessToken: result.accessToken });
  } catch (err: any) {
    clearRtCookie(res);
    return res.status(401).json({ error: err.message });
  }
});

// POST /auth/logout
authRouter.post('/logout', async (req, res) => {
  const rawRefreshToken = req.cookies?.[RT_COOKIE];

  if (rawRefreshToken) {
    await logout({ rawRefreshToken });
  }

  clearRtCookie(res);
  return res.json({ ok: true });
});
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/channels/http-ws/routes/__tests__/auth-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-ws/routes/auth-routes.ts \
        src/channels/http-ws/routes/__tests__/auth-routes.test.ts
git commit -m "feat(auth): add auth routes for login/logout/refresh

- POST /auth/login: returns AT in body, RT in HttpOnly SameSite=Lax cookie
- POST /auth/refresh: reads RT from cookie, rotates it, returns new AT
- POST /auth/logout: revokes RT, clears cookie
- Secure flag set in production

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 14: 用户/角色/路径 ACL 管理路由

**Files:**
- Create: `src/channels/http-ws/routes/users-routes.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
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
  createUser({ username: 'admin', passwordHash: hashPassword('pass'), roleId: 'role_admin' });
  createUser({ username: 'member', passwordHash: hashPassword('pass'), roleId: 'role_member' });
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:run src/channels/http-ws/routes/__tests__/users-routes.test.ts`
Expected: FAIL — `Cannot find module '../users-routes.js'`

- [ ] **Step 3: 实现 users-routes.ts**

```typescript
// src/channels/http-ws/routes/users-routes.ts
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { requirePermission } from '../middleware/require-permission.js';
import {
  getAllUsers, getUserById, createUser, updateUser, deleteUser,
} from '../../../auth/users-store.js';
import {
  getAllRoles, getRoleById, createRole, updateRole, deleteRole,
} from '../../../auth/roles-store.js';
import {
  getPathAclForRole, getPathAclForUser, setRolePathAcl, setUserPathAcl, deletePathAcl,
} from '../../../auth/path-acl-store.js';
import { hashPassword } from '../../../auth/password.js';
import { logAuditEvent } from '../../../auth/audit-logger.js';

export const usersRouter = Router();

/** 从 User 对象中移除敏感字段 */
function sanitizeUser(user: ReturnType<typeof getUserById>) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ─── Users ───────────────────────────────────────────────────────────────────

// GET /api/users
usersRouter.get('/users', requirePermission('manageUsers'), (req, res) => {
  const users = getAllUsers().map(sanitizeUser);
  return res.json(users);
});

// GET /api/users/:id
usersRouter.get('/users/:id', requirePermission('manageUsers'), (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not Found' });
  return res.json(sanitizeUser(user));
});

// POST /api/users
usersRouter.post('/users', requirePermission('manageUsers'), (req, res) => {
  const { username, password, roleId, displayName, email } = req.body ?? {};
  if (!username || !password || !roleId) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少必填字段' });
  }
  try {
    const user = createUser({
      username,
      passwordHash: hashPassword(password),
      roleId,
      displayName,
      email,
    });
    logAuditEvent({
      action: 'create_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetUsername: username },
    });
    return res.status(201).json(sanitizeUser(user));
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:id
usersRouter.patch('/users/:id', requirePermission('manageUsers'), (req, res) => {
  const { roleId, displayName, email, isEnabled } = req.body ?? {};
  try {
    const user = updateUser(req.params.id, { roleId, displayName, email, isEnabled });
    logAuditEvent({
      action: 'update_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    return res.json(sanitizeUser(user));
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id
usersRouter.delete('/users/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    deleteUser(req.params.id);
    logAuditEvent({
      action: 'delete_user',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password (admin resets another user's password)
// 服务端生成随机临时密码，一次性明文返回给管理员
usersRouter.post('/users/:id/reset-password', requirePermission('manageUsers'), (req, res) => {
  try {
    const tempPassword = randomBytes(9).toString('base64url');

    updateUser(req.params.id, {
      passwordHash: hashPassword(tempPassword),
      forcePasswordChange: 1,
      tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时
    });
    logAuditEvent({
      action: 'admin_password_reset',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { targetId: req.params.id },
    });
    // 临时密码仅此一次明文返回
    return res.json({ ok: true, tempPassword });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/users/:id/force-logout (revoke all sessions)
usersRouter.post('/users/:id/force-logout', requirePermission('manageUsers'), async (req, res) => {
  const { revokeAllUserTokens } = await import('../../../auth/token-store.js');
  revokeAllUserTokens(req.params.id);
  logAuditEvent({
    action: 'force_logout',
    userId: req.user?.userId,
    username: req.user?.username,
    detail: { targetId: req.params.id },
  });
  return res.json({ ok: true });
});

// ─── Roles ───────────────────────────────────────────────────────────────────

// GET /api/roles
usersRouter.get('/roles', requirePermission('manageUsers'), (req, res) => {
  return res.json(getAllRoles());
});

// POST /api/roles
usersRouter.post('/roles', requirePermission('manageUsers'), (req, res) => {
  const { name, description, permissions } = req.body ?? {};
  if (!name || !Array.isArray(permissions)) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 name 或 permissions' });
  }
  try {
    const role = createRole({ name, description, permissions });
    logAuditEvent({
      action: 'role_permission_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { action: 'create', roleId: role.id },
    });
    return res.status(201).json(role);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/roles/:id
usersRouter.patch('/roles/:id', requirePermission('manageUsers'), (req, res) => {
  const { name, description, permissions } = req.body ?? {};
  try {
    const role = updateRole(req.params.id, { name, description, permissions });
    logAuditEvent({
      action: 'role_permission_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { action: 'update', roleId: req.params.id },
    });
    return res.json(role);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/roles/:id
usersRouter.delete('/roles/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    deleteRole(req.params.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── Path ACL ────────────────────────────────────────────────────────────────

// GET /api/path-acl?roleId=&userId=&storageId=
usersRouter.get('/path-acl', requirePermission('manageUsers'), (req, res) => {
  const { roleId, userId, storageId } = req.query as Record<string, string>;
  if (roleId) {
    return res.json(getPathAclForRole(roleId, storageId));
  }
  if (userId) {
    return res.json(getPathAclForUser(userId, storageId));
  }
  return res.status(400).json({ error: 'BadRequest', message: '需提供 roleId 或 userId' });
});

// PUT /api/path-acl/role
usersRouter.put('/path-acl/role', requirePermission('manageUsers'), (req, res) => {
  const { roleId, storageId, path, permission } = req.body ?? {};
  if (!roleId || !storageId || !path || !permission) {
    return res.status(400).json({ error: 'BadRequest' });
  }
  try {
    setRolePathAcl({ roleId, storageId, path, permission });
    logAuditEvent({
      action: 'path_acl_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { subjectType: 'role', roleId, storageId, path, permission },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PUT /api/path-acl/user
usersRouter.put('/path-acl/user', requirePermission('manageUsers'), (req, res) => {
  const { userId, storageId, path, permission } = req.body ?? {};
  if (!userId || !storageId || !path || !permission) {
    return res.status(400).json({ error: 'BadRequest' });
  }
  try {
    setUserPathAcl({ userId, storageId, path, permission });
    logAuditEvent({
      action: 'path_acl_changed',
      userId: req.user?.userId,
      username: req.user?.username,
      detail: { subjectType: 'user', userId, storageId, path, permission },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/path-acl/:id
usersRouter.delete('/path-acl/:id', requirePermission('manageUsers'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'BadRequest' });
  deletePathAcl(id);
  return res.json({ ok: true });
});
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run test:run src/channels/http-ws/routes/__tests__/users-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-ws/routes/users-routes.ts \
        src/channels/http-ws/routes/__tests__/users-routes.test.ts
git commit -m "feat(auth): add user/role/path-acl management API routes

- CRUD for users with passwordHash stripped from responses
- Admin password reset with forcePasswordChange + 24h expiry
- Force logout revokes all user sessions
- CRUD for roles
- PUT/GET/DELETE for path ACL entries
- All routes require manageUsers permission

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```


---

## Chunk 5: 前端认证系统重写

### Task 15: 前端 Auth Store（AT 内存管理）

**Files:**
- Modify: `web-ui/src/utils/auth.ts`
- Create: `web-ui/src/stores/auth-store.ts`

- [ ] **Step 1: 修改 web-ui/src/utils/auth.ts**

将 AT 从 localStorage 移至内存，并实现自动刷新逻辑：

```typescript
// web-ui/src/utils/auth.ts
// AT 仅存内存，RT 存于 HttpOnly Cookie（由服务端 Set-Cookie 管理）
// 对外暴露与旧版兼容的 authFetch / appendTokenToUrl / appendTokenToWsUrl

let _accessToken: string | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

/**
 * 刷新 Access Token（利用 HttpOnly Cookie 中的 RT）
 * 并发调用时只发一次请求（Promise 复用）
 */
export async function refreshToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include', // 携带 HttpOnly Cookie
      });
      if (!res.ok) {
        _accessToken = null;
        return null;
      }
      const data = await res.json();
      _accessToken = data.accessToken;
      return _accessToken;
    } catch {
      _accessToken = null;
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/**
 * 带鉴权的 fetch 包装，AT 过期时自动刷新并重试
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null) =>
    fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doFetch(_accessToken);

  if (res.status === 401) {
    const newToken = await refreshToken();
    if (!newToken) {
      // 刷新失败，触发重新登录事件
      window.dispatchEvent(new Event('auth:unauthorized'));
      return res;
    }
    res = await doFetch(newToken);
  }

  return res;
}

/**
 * 为 URL 附加 token（WS 连接用）
 */
export function appendTokenToWsUrl(url: string): string {
  if (!_accessToken) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(_accessToken)}`;
}

// 兼容旧版 appendTokenToUrl（已不建议用于 WS 之外的场景）
export function appendTokenToUrl(url: string): string {
  return appendTokenToWsUrl(url);
}
```

- [ ] **Step 2: 创建 web-ui/src/stores/auth-store.ts**

```typescript
// web-ui/src/stores/auth-store.ts
// 全局认证状态，使用 React Context + useReducer（不引入 Zustand）
import { setAccessToken, clearAccessToken } from '../utils/auth.js';

export interface AuthUser {
  userId: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  forcePasswordChange: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authEnabled: boolean;
  authChecked: boolean;
}

export type AuthAction =
  | { type: 'LOGIN_SUCCESS'; payload: { accessToken: string; user: AuthUser } }
  | { type: 'LOGOUT' }
  | { type: 'AUTH_DISABLED' }
  | { type: 'AUTH_CHECKED' }
  | { type: 'TOKEN_REFRESHED'; payload: { accessToken: string } };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      setAccessToken(action.payload.accessToken);
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        authChecked: true,
      };
    case 'TOKEN_REFRESHED': {
      setAccessToken(action.payload.accessToken);
      // 解码新 AT 更新 user 信息
      const updatedUser = decodeAccessToken(action.payload.accessToken);
      return { ...state, user: updatedUser ?? state.user };
    }
    case 'LOGOUT':
      clearAccessToken();
      return {
        ...state,
        user: null,
        isAuthenticated: false,
      };
    case 'AUTH_DISABLED':
      return {
        ...state,
        authEnabled: false,
        isAuthenticated: true,
        authChecked: true,
      };
    case 'AUTH_CHECKED':
      return { ...state, authChecked: true };
    default:
      return state;
  }
}

export const initialAuthState: AuthState = {
  user: null,
  isAuthenticated: false,
  authEnabled: true,
  authChecked: false,
};

/**
 * 从 JWT payload 解码用户信息（不验证签名，仅前端展示用）
 */
export function decodeAccessToken(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      userId: payload.userId,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      forcePasswordChange: false,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: 运行前端编译检查**

```bash
cd web-ui && npx tsc --noEmit
```
Expected: No TypeScript errors in auth.ts and auth-store.ts

- [ ] **Step 4: Commit**

```bash
git add web-ui/src/utils/auth.ts web-ui/src/stores/auth-store.ts
git commit -m "feat(frontend): migrate AT from localStorage to memory

- Access token stored in module-level variable, never persisted
- refreshToken() uses HttpOnly Cookie RT via POST /auth/refresh
- authFetch() auto-retries on 401 after token refresh
- WS URL helper uses in-memory AT
- authReducer for managing login/logout/refresh state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 16: LoginPage 重写

**Files:**
- Modify: `web-ui/src/components/LoginPage.tsx`

- [ ] **Step 1: 重写 LoginPage.tsx**

```typescript
// web-ui/src/components/LoginPage.tsx
import { useState, FormEvent } from 'react';
import { decodeAccessToken, AuthUser } from '../stores/auth-store.js';

interface LoginPageProps {
  onLoginSuccess: (accessToken: string, user: AuthUser, forcePasswordChange: boolean) => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const messages: Record<string, string> = {
          invalid_credentials: '用户名或密码错误',
          account_locked: '账户已锁定，请 15 分钟后重试',
          account_disabled: '账户已被禁用，请联系管理员',
          temp_password_expired: '临时密码已过期，请联系管理员重置',
        };
        setError(messages[data.error] ?? '登录失败，请稍后重试');
        return;
      }

      if (data.forcePasswordChange) {
        // 需要修改密码
        setPendingToken(data.accessToken);
        setShowChangePassword(true);
        return;
      }

      const user = decodeAccessToken(data.accessToken);
      if (!user) {
        setError('登录响应格式错误');
        return;
      }
      onLoginSuccess(data.accessToken, user, false);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码至少 8 位');
      return;
    }

    setLoading(true);
    try {
      const user = pendingToken ? decodeAccessToken(pendingToken) : null;
      if (!user) { setError('会话已失效，请重新登录'); return; }

      const res = await fetch(`/api/users/${user.userId}/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      if (!res.ok) {
        setError('修改密码失败，请重试');
        return;
      }

      // 重新登录获取新 token
      const loginRes = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password: newPassword }),
      });
      if (!loginRes.ok) {
        setError('密码已修改，请用新密码重新登录');
        setShowChangePassword(false);
        setPendingToken(null);
        return;
      }
      const loginData = await loginRes.json();
      const newUser = decodeAccessToken(loginData.accessToken);
      if (!newUser) { setError('修改成功，请重新登录'); return; }
      setPendingToken(null); // 清除临时 token
      onLoginSuccess(loginData.accessToken, newUser, false);
    } catch {
      setError('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (showChangePassword) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md w-96">
          <h2 className="text-xl font-semibold mb-2">首次登录，请修改密码</h2>
          <p className="text-sm text-gray-500 mb-4">临时密码仅一次有效，请设置新密码</p>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <input
              type="password"
              placeholder="新密码（至少8位）"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              type="password"
              placeholder="确认新密码"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '提交中...' : '设置新密码'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">MantisBot</h1>
        {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 编译检查**

```bash
cd web-ui && npx tsc --noEmit
```
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add web-ui/src/components/LoginPage.tsx
git commit -m "feat(frontend): rewrite LoginPage with force password change flow

- Multi-state UI: login form / change password form
- Error messages mapped from backend error codes
- Force password change flow: pending token held in state until password updated
- No localStorage usage

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 17: usePermission Hook + App.tsx 更新

**Files:**
- Create: `web-ui/src/hooks/usePermission.ts`
- Modify: `web-ui/src/App.tsx`

- [ ] **Step 1: 创建 usePermission.ts**

```typescript
// web-ui/src/hooks/usePermission.ts
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';

/**
 * 检查当前用户是否具有指定权限。
 * 在 auth.enabled=false 时始终返回 true（匿名管理员）。
 */
export function usePermission(permission: string): boolean {
  const { state } = useContext(AuthContext);
  if (!state.authEnabled) return true;
  if (!state.user) return false;
  const perms = state.user.permissions;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}
```

- [ ] **Step 2: 创建 web-ui/src/contexts/AuthContext.tsx**

```typescript
// web-ui/src/contexts/AuthContext.tsx
import { createContext, useReducer, useEffect, ReactNode } from 'react';
import { authReducer, initialAuthState, AuthState, AuthAction, decodeAccessToken } from '../stores/auth-store.js';
import { refreshToken } from '../utils/auth.js';

interface AuthContextValue {
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
}

export const AuthContext = createContext<AuthContextValue>({
  state: initialAuthState,
  dispatch: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  useEffect(() => {
    // 启动时检查 auth 状态：尝试刷新 token（利用 RT Cookie）
    const checkAuth = async () => {
      const res = await fetch('/api/auth/check');
      const data = await res.json();

      if (!data.enabled) {
        dispatch({ type: 'AUTH_DISABLED' });
        return;
      }

      // 尝试用 RT Cookie 刷新 AT
      const token = await refreshToken();
      if (token) {
        const user = decodeAccessToken(token);
        if (user) {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { accessToken: token, user } });
          return;
        }
      }

      dispatch({ type: 'AUTH_CHECKED' });
    };

    checkAuth();

    // 监听 auth:unauthorized 事件（authFetch 触发）
    const handler = () => dispatch({ type: 'LOGOUT' });
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  return (
    <AuthContext.Provider value={{ state, dispatch }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 3: 更新 App.tsx 使用 AuthContext**

在 `web-ui/src/App.tsx` 中：

1. 删除旧的 `isAuthenticated`, `authEnabled`, `authChecked` 本地 state
2. 将应用包裹在 `<AuthProvider>` 中
3. 用 `useContext(AuthContext)` 读取 auth 状态
4. `<LoginPage>` 的 `onLoginSuccess` 回调中 dispatch `LOGIN_SUCCESS`

Minimal change to App.tsx:

```typescript
// In App.tsx — wrap root with AuthProvider
import { AuthProvider, AuthContext } from './contexts/AuthContext.js';
import { LoginPage } from './components/LoginPage.js';
// ... other imports

function AppContent() {
  const { state, dispatch } = useContext(AuthContext);

  if (!state.authChecked) {
    return <div className="flex items-center justify-center min-h-screen">加载中...</div>;
  }

  if (!state.isAuthenticated) {
    return (
      <LoginPage
        onLoginSuccess={(accessToken, user, forcePasswordChange) => {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { accessToken, user } });
        }}
      />
    );
  }

  // ... rest of authenticated app
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

- [ ] **Step 4: 编译检查**

```bash
cd web-ui && npx tsc --noEmit
```
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add web-ui/src/hooks/usePermission.ts \
        web-ui/src/contexts/AuthContext.tsx \
        web-ui/src/App.tsx
git commit -m "feat(frontend): add AuthContext, usePermission hook, update App.tsx

- AuthContext wraps app with login/logout/refresh state
- Auto-refresh AT via RT Cookie on startup
- usePermission hook reads from JWT payload (no extra API call)
- App.tsx uses context instead of local state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 18: 用户管理 UI

**Files:**
- Create: `web-ui/src/components/UserManagementSection.tsx`
- Create: `web-ui/src/components/RoleManagementSection.tsx`
- Create: `web-ui/src/components/PathAclEditor.tsx`

- [ ] **Step 1: 创建 UserManagementSection.tsx**

```typescript
// web-ui/src/components/UserManagementSection.tsx
import { useState, useEffect, useContext } from 'react';
import { authFetch } from '../utils/auth.js';
import { AuthContext } from '../contexts/AuthContext.js';
import { usePermission } from '../hooks/usePermission.js';

interface User {
  id: string;
  username: string;
  roleId: string;
  displayName: string | null;
  email: string | null;
  isEnabled: number;
  forcePasswordChange: number;
  createdAt: number;
}

interface Role {
  id: string;
  name: string;
}

export function UserManagementSection() {
  const canManage = usePermission('manageUsers');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', roleId: 'role_member', displayName: '' });
  const [resetResult, setResetResult] = useState<{ userId: string; tempPassword: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        authFetch('/api/users'),
        authFetch('/api/roles'),
      ]);
      setUsers(await usersRes.json());
      setRoles(await rolesRes.json());
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!canManage) {
    return <div className="text-gray-500 text-sm p-4">无权限查看用户管理</div>;
  }

  const handleCreate = async () => {
    const res = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    });
    if (res.ok) {
      setShowCreate(false);
      setCreateForm({ username: '', password: '', roleId: 'role_member', displayName: '' });
      await load();
    } else {
      const data = await res.json();
      setError(data.error ?? '创建失败');
    }
  };

  const handleToggleEnabled = async (user: User) => {
    await authFetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: user.isEnabled === 1 ? 0 : 1 }),
    });
    await load();
  };

  const handleResetPassword = async (userId: string) => {
    const res = await authFetch(`/api/users/${userId}/reset-password`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setResetResult({ userId, tempPassword: data.tempPassword });
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('确认删除该用户？此操作不可撤销')) return;
    const res = await authFetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      await load();
    } else {
      const data = await res.json();
      alert(data.error ?? '删除失败');
    }
  };

  if (loading) return <div className="text-gray-500 p-4">加载中...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">用户管理</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
        >
          + 新建用户
        </button>
      </div>

      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

      {resetResult && (
        <div className="bg-yellow-50 border border-yellow-300 p-3 rounded mb-4 text-sm">
          <p className="font-medium">临时密码（仅显示一次）：</p>
          <code className="bg-white px-2 py-1 rounded border font-mono">{resetResult.tempPassword}</code>
          <button onClick={() => setResetResult(null)} className="ml-3 text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-gray-50 border rounded p-4 mb-4 space-y-3">
          <h3 className="font-medium text-sm">新建用户</h3>
          <input
            className="w-full border rounded px-3 py-1.5 text-sm"
            placeholder="用户名"
            value={createForm.username}
            onChange={e => setCreateForm({ ...createForm, username: e.target.value })}
          />
          <input
            type="password"
            className="w-full border rounded px-3 py-1.5 text-sm"
            placeholder="初始密码"
            value={createForm.password}
            onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
          />
          <select
            className="w-full border rounded px-3 py-1.5 text-sm"
            value={createForm.roleId}
            onChange={e => setCreateForm({ ...createForm, roleId: e.target.value })}
          >
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">确认创建</button>
            <button onClick={() => setShowCreate(false)} className="border px-3 py-1 rounded text-sm">取消</button>
          </div>
        </div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3">用户名</th>
            <th className="text-left py-2 px-3">角色</th>
            <th className="text-left py-2 px-3">状态</th>
            <th className="text-left py-2 px-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id} className="border-b hover:bg-gray-50">
              <td className="py-2 px-3">{user.username}</td>
              <td className="py-2 px-3">{roles.find(r => r.id === user.roleId)?.name ?? user.roleId}</td>
              <td className="py-2 px-3">
                <span className={`px-2 py-0.5 rounded text-xs ${user.isEnabled === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {user.isEnabled === 1 ? '启用' : '禁用'}
                </span>
              </td>
              <td className="py-2 px-3 space-x-2">
                <button onClick={() => handleToggleEnabled(user)} className="text-blue-600 hover:underline text-xs">
                  {user.isEnabled === 1 ? '禁用' : '启用'}
                </button>
                <button onClick={() => handleResetPassword(user.id)} className="text-orange-500 hover:underline text-xs">重置密码</button>
                <button onClick={() => handleDelete(user.id)} className="text-red-500 hover:underline text-xs">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 创建 RoleManagementSection.tsx**

```typescript
// web-ui/src/components/RoleManagementSection.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { usePermission } from '../hooks/usePermission.js';

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string;  // JSON string
  isBuiltin: number;
}

const AVAILABLE_PERMISSIONS = [
  { key: 'chat', label: '使用对话' },
  { key: 'viewHistory', label: '查看历史' },
  { key: 'useAgentTeams', label: '使用 Agent 组' },
  { key: 'manageFiles', label: '管理文件' },
  { key: 'manageUsers', label: '管理用户' },
];

export function RoleManagementSection() {
  const canManage = usePermission('manageUsers');
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await authFetch('/api/roles');
    setRoles(await res.json());
  };

  useEffect(() => { load(); }, []);

  if (!canManage) return null;

  const handleEdit = (role: Role) => {
    setEditing(role.id);
    try {
      setEditPerms(JSON.parse(role.permissions));
    } catch {
      setEditPerms([]);
    }
  };

  const handleSave = async (roleId: string) => {
    const res = await authFetch(`/api/roles/${roleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: editPerms }),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const data = await res.json();
      setError(data.error ?? '保存失败');
    }
  };

  const togglePerm = (key: string) => {
    setEditPerms(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">角色权限管理</h2>
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
      <div className="space-y-3">
        {roles.map(role => {
          const perms: string[] = (() => { try { return JSON.parse(role.permissions); } catch { return []; } })();
          const isEditing = editing === role.id;
          return (
            <div key={role.id} className="border rounded p-3">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <span className="font-medium">{role.name}</span>
                  {role.isBuiltin === 1 && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">内置</span>
                  )}
                </div>
                {role.id !== 'role_admin' && (
                  <button
                    onClick={() => isEditing ? handleSave(role.id) : handleEdit(role)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {isEditing ? '保存' : '编辑'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_PERMISSIONS.map(({ key, label }) => {
                  const active = isEditing ? editPerms.includes(key) : perms.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => isEditing && togglePerm(key)}
                      disabled={!isEditing || role.id === 'role_admin'}
                      className={`text-xs px-2 py-1 rounded border ${
                        active
                          ? 'bg-blue-100 border-blue-300 text-blue-700'
                          : 'bg-gray-50 border-gray-200 text-gray-400'
                      } ${isEditing && role.id !== 'role_admin' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                    >
                      {label}
                    </button>
                  );
                })}
                {role.id === 'role_admin' && (
                  <span className="text-xs text-gray-400 italic">全部权限（不可编辑）</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 PathAclEditor.tsx**

```typescript
// web-ui/src/components/PathAclEditor.tsx
import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth.js';
import { usePermission } from '../hooks/usePermission.js';

interface PathAclEntry {
  id: number;
  subjectType: 'role' | 'user';
  subjectId: string;
  storageId: string;
  path: string;
  permission: 'read' | 'write' | 'deny';
}

interface PathAclEditorProps {
  subjectType: 'role' | 'user';
  subjectId: string;
  subjectName: string;
  storageId?: string;
}

export function PathAclEditor({ subjectType, subjectId, subjectName, storageId = 'local' }: PathAclEditorProps) {
  const canManage = usePermission('manageUsers');
  const [entries, setEntries] = useState<PathAclEntry[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newPermission, setNewPermission] = useState<'read' | 'write' | 'deny'>('read');

  const load = async () => {
    const param = subjectType === 'role' ? `roleId=${subjectId}` : `userId=${subjectId}`;
    const res = await authFetch(`/api/path-acl?${param}&storageId=${storageId}`);
    setEntries(await res.json());
  };

  useEffect(() => { if (canManage) load(); }, [subjectId, storageId]);

  if (!canManage) return null;

  const handleAdd = async () => {
    if (!newPath.startsWith('/')) {
      alert('路径必须以 / 开头');
      return;
    }
    const endpoint = subjectType === 'role' ? '/api/path-acl/role' : '/api/path-acl/user';
    const body = subjectType === 'role'
      ? { roleId: subjectId, storageId, path: newPath, permission: newPermission }
      : { userId: subjectId, storageId, path: newPath, permission: newPermission };
    await authFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setNewPath('');
    await load();
  };

  const handleDelete = async (id: number) => {
    await authFetch(`/api/path-acl/${id}`, { method: 'DELETE' });
    await load();
  };

  const permLabel = { read: '只读', write: '读写', deny: '禁止' };
  const permClass = {
    read: 'bg-blue-100 text-blue-700',
    write: 'bg-green-100 text-green-700',
    deny: 'bg-red-100 text-red-700',
  };

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium mb-2">
        {subjectName} 的路径权限 <span className="text-gray-400">({storageId})</span>
      </h4>
      <div className="space-y-1 mb-3">
        {entries.length === 0 && (
          <p className="text-xs text-gray-400">无特殊路径规则（默认拒绝）</p>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
            <span className="font-mono">{entry.path}</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${permClass[entry.permission]}`}>
                {permLabel[entry.permission]}
              </span>
              <button onClick={() => handleDelete(entry.id)} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm font-mono"
          placeholder="/path/to/directory"
          value={newPath}
          onChange={e => setNewPath(e.target.value)}
        />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={newPermission}
          onChange={e => setNewPermission(e.target.value as 'read' | 'write' | 'deny')}
        >
          <option value="read">只读</option>
          <option value="write">读写</option>
          <option value="deny">禁止</option>
        </select>
        <button onClick={handleAdd} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">添加</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 编译检查**

```bash
cd web-ui && npx tsc --noEmit
```
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add web-ui/src/components/UserManagementSection.tsx \
        web-ui/src/components/RoleManagementSection.tsx \
        web-ui/src/components/PathAclEditor.tsx
git commit -m "feat(frontend): add user/role/path-acl management UI components

- UserManagementSection: CRUD, enable/disable, reset password (shows temp password once)
- RoleManagementSection: permission toggle UI per role
- PathAclEditor: add/delete path ACL rules per role or user, with storageId support

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```


---

## Chunk 6: 集成与迁移

### Task 19: 更新 HTTP/WS 服务器入口（集成新路由和中间件）

**Files:**
- Modify: `src/channels/http-ws/http-server.ts`
- Modify: `src/channels/http-ws/ws-server.ts`
- Modify: `src/entry.ts`

- [ ] **Step 1: 确认 http-server.ts 当前结构**

```bash
grep -n "auth\|router\|middleware\|cookie" src/channels/http-ws/http-server.ts
```

- [ ] **Step 2: 修改 http-server.ts**

在现有 `http-server.ts` 中：

1. 添加 `cookie-parser` 中间件
2. 替换旧 `createAuthMiddleware()` 为新版
3. 注册 `authRouter` 在 `/auth`
4. 注册 `usersRouter` 在 `/api`（加鉴权中间件）
5. 为文件管理相关路由添加 `fileAccessGuard`

```typescript
// 在 http-server.ts setupRoutes() 或等效初始化函数中添加/修改：

import cookieParser from 'cookie-parser';
import { createAuthMiddleware } from './middleware/authenticate.js';
import { authRouter } from './routes/auth-routes.js';
import { usersRouter } from './routes/users-routes.js';
import { initSystemDb } from '../../auth/db.js';
import { initBuiltinRoles } from '../../auth/roles-store.js';
import { validateJwtSecret } from '../../auth/jwt.js';

// 在 express app 初始化后、路由注册前：
app.use(cookieParser());
app.use(createAuthMiddleware());

// 公开路由（不需要鉴权）
app.use('/auth', authRouter);  // login/logout/refresh 本身不需要 AT

// 管理路由（需要鉴权，requirePermission 在路由内部处理）
app.use('/api', usersRouter);
```

- [ ] **Step 3: 修改 ws-server.ts（WS Token 鉴权）**

当前 WS 使用 `computeToken(username, password)` 验证。替换为 JWT AT：

```typescript
// 在 ws-server.ts 的 WS 升级处理中：
import { verifyAccessToken } from '../../auth/jwt.js';
import { getConfig } from '../../config/loader.js';

// 替换原来的 HMAC token 校验逻辑：
function authenticateWsConnection(req: IncomingMessage): boolean {
  const config = getConfig();
  if (!config.server?.auth?.enabled) return true;

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) return false;

  try {
    verifyAccessToken(token);
    return true;
  } catch {
    return false;
  }
}

// 若 token 过期，发送 {type: 'auth_expired'} 给客户端（在 catch TokenExpiredError 中）：
function handleWsToken(req: IncomingMessage, ws: WebSocket): boolean {
  const config = getConfig();
  if (!config.server?.auth?.enabled) return true;

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) {
    ws.close(4001, 'Unauthorized');
    return false;
  }

  try {
    verifyAccessToken(token);
    return true;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      ws.send(JSON.stringify({ type: 'auth_expired' }));
    }
    ws.close(4001, 'Unauthorized');
    return false;
  }
}
```

- [ ] **Step 4: 修改 src/entry.ts（初始化 system.db）**

在应用启动时初始化 system.db 和内置角色：

```typescript
// 在 src/entry.ts 的启动初始化逻辑中添加：
import { initSystemDb } from './auth/db.js';
import { initBuiltinRoles } from './auth/roles-store.js';
import { validateJwtSecret } from './auth/jwt.js';
import { getConfig } from './config/loader.js';

// 在现有 DB 初始化之后、服务器启动之前：
const config = getConfig();
if (config.server?.auth?.enabled) {
  validateJwtSecret(); // 启动时验证 JWT_SECRET，长度 < 32 bytes 则抛出
  initSystemDb();
  initBuiltinRoles();
  console.log('[Auth] System database initialized');
}
```

- [ ] **Step 5: 检查现有 /api/auth/check 端点**

确认有 `GET /api/auth/check` 返回 `{ enabled: boolean }` 供前端检测 auth 状态：

```typescript
// 在 http-server.ts 中添加（作为 http-server 级别的独立路由，不在 auth-routes.ts 中）：
// 前端 AuthContext.tsx 请求此路径检测 auth 是否启用
app.get('/api/auth/check', (req, res) => {
  const config = getConfig();
  const enabled = config.server?.auth?.enabled ?? false;
  res.json({ enabled });
});
```

- [ ] **Step 6: 添加用户自己修改密码的端点**

```typescript
// 在 users-routes.ts 末尾追加：
// POST /api/users/:id/change-password（用户自己修改密码）
usersRouter.post('/users/:id/change-password', async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // 只能修改自己的密码（或 admin 可修改任何人）
  if (user.userId !== req.params.id && !user.permissions.includes('*')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { newPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'BadRequest', message: '新密码至少 8 位' });
  }

  try {
    updateUser(req.params.id, {
      passwordHash: await hashPassword(newPassword),
      forcePasswordChange: 0,
      tempPasswordExpiresAt: null,
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 7: Commit**

```bash
git add src/channels/http-ws/http-server.ts \
        src/channels/http-ws/ws-server.ts \
        src/channels/http-ws/routes/users-routes.ts \
        src/entry.ts
git commit -m "feat(auth): integrate new auth system into HTTP/WS server

- Add cookie-parser, new JWT authenticate middleware
- Register /auth and /api/users routes
- WS auth: validate JWT AT via query param, send auth_expired on expiry
- Entry: initialize system.db and builtin roles at startup
- Add /api/users/:id/change-password for self-service password change

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 20: 向后兼容迁移 + CLI 工具

**Files:**
- Modify: `src/channels/http-ws/auth-middleware.ts` (兼容层)
- Create: `src/cli.ts`

- [ ] **Step 1: 更新旧 auth-middleware.ts 为兼容层**

旧 `auth-middleware.ts` 现在作为向后兼容层，内部调用新中间件，并提供迁移警告：

```typescript
// src/channels/http-ws/auth-middleware.ts
// 兼容层：保留旧版导出供现有代码使用，内部使用新鉴权逻辑
// Deprecated: 直接导入 src/channels/http-ws/middleware/authenticate.ts

import { createAuthMiddleware as _newAuthMiddleware } from './middleware/authenticate.js';

/**
 * @deprecated 使用 ./middleware/authenticate.ts 的 createAuthMiddleware
 */
export function createAuthMiddleware() {
  console.warn('[AuthMiddleware] auth-middleware.ts 已废弃，请迁移到 ./middleware/authenticate.ts');
  return _newAuthMiddleware();
}

// 以下函数仅保留 API 兼容性，不再提供实际功能
/** @deprecated 不再使用 HMAC token，请使用 JWT */
export function computeToken(_username: string, _password: string): string {
  throw new Error('computeToken is deprecated. Use JWT-based authentication instead.');
}

/** @deprecated 使用 argon2id，请使用 src/auth/password.ts 的 hashPassword */
export function hashPassword(plain: string): string {
  throw new Error('hashPassword is deprecated. Use src/auth/password.ts instead.');
}

/** @deprecated 使用 src/auth/password.ts 的 verifyPassword */
export function verifyPassword(_submitted: string, _stored: string): boolean {
  throw new Error('verifyPassword is deprecated. Use src/auth/password.ts instead.');
}
```

- [ ] **Step 2: 创建 reset-admin-password CLI**

```typescript
// src/cli.ts
// 命令行工具：重置 admin 用户密码
// 用法：node dist/cli.js reset-admin-password [--username admin]

import { parseArgs } from 'util';
import { initSystemDb, closeSystemDb } from './auth/db.js';
import { initBuiltinRoles } from './auth/roles-store.js';
import { getUserByUsername, createUser, updateUser, getAllUsers } from './auth/users-store.js';
import { hashPassword } from './auth/password.js';
import { randomBytes } from 'crypto';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    username: { type: 'string', short: 'u', default: 'admin' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help || positionals[0] === 'help') {
  console.log(`
MantisBot CLI

Usage:
  node dist/cli.js reset-admin-password [--username <username>]

Options:
  --username, -u  Admin username to reset (default: admin)
  --help, -h      Show this help
  `);
  process.exit(0);
}

if (positionals[0] === 'reset-admin-password') {
  (async () => {
  initSystemDb();
  initBuiltinRoles();

  const username = values.username as string;
  const tempPassword = randomBytes(9).toString('base64url');
  const existing = getUserByUsername(username);

  if (existing) {
    updateUser(existing.id, {
      passwordHash: await hashPassword(tempPassword),
      forcePasswordChange: 1,
      tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
      isEnabled: 1,
    });
    console.log(`✅ 已重置用户 '${username}' 的密码`);
  } else {
    // 用户不存在则创建
    createUser({
      username,
      passwordHash: await hashPassword(tempPassword),
      roleId: 'role_admin',
      forcePasswordChange: 1,
      tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    console.log(`✅ 已创建 admin 用户 '${username}'`);
  }

  console.log(`\n临时密码（24小时内有效，首次登录须修改）：`);
  console.log(`  ${tempPassword}\n`);

  closeSystemDb();
  process.exit(0);
  })();
} else {
  console.error(`未知命令: ${positionals[0]}`);
  console.error('运行 --help 查看帮助');
  process.exit(1);
}
```

- [ ] **Step 3: 在 package.json 中添加 CLI 命令**

```bash
# 在 package.json 的 scripts 中添加：
# "cli": "node --import tsx/esm src/cli.ts"
# 用法：npm run cli reset-admin-password --username admin
```

Manually edit `package.json`:
```json
{
  "scripts": {
    "cli": "node --import tsx/esm src/cli.ts"
  }
}
```

- [ ] **Step 4: 添加 JWT_SECRET 到环境变量文档**

在 `config/config.example.json` 中添加注释（或更新 README）说明需要设置：

```bash
# .env 文件（或 Docker 环境变量）：
# JWT_SECRET=<至少32字节的随机字符串>
# 生成方式：node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- [ ] **Step 5: 运行完整测试套件，确认无回归**

```bash
npm run test:run
```
Expected: All tests PASS, no failures

- [ ] **Step 6: 运行构建检查**

```bash
npm run build
```
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/channels/http-ws/auth-middleware.ts src/cli.ts package.json
git commit -m "feat(auth): add backward-compat layer and reset-admin-password CLI

- auth-middleware.ts now a deprecated wrapper calling new middleware
- CLI: reset-admin-password creates/resets admin user with 24h temp password
- JWT_SECRET: documented in config.example.json

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 21: 系统数据库 Schema 补全（db.ts 更新）

本 Task 确认 Chunk 1 中的 `db.ts` 包含所有 Chunk 2-6 所需的完整字段。

**Files:**
- Modify: `src/auth/db.ts`

- [ ] **Step 1: 确认 db.ts DDL 包含所有必需列**

检查 `src/auth/db.ts` 的 `initializeSchema()` 确保：

1. `users` 表包含：`last_login_at`, `is_enabled`（非 `enabled`）
2. `refresh_tokens` 表包含：`next_raw_token TEXT`
3. `path_acl` 表包含：`storage_id TEXT NOT NULL`
4. `path_acl` 唯一索引包含 `storage_id`：`UNIQUE(subject_type, subject_id, storage_id, path)`

Expected db.ts DDL summary:
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  force_password_change INTEGER NOT NULL DEFAULT 0,
  temp_password_expires_at INTEGER,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  rotated_at INTEGER,
  next_token_id TEXT,
  next_raw_token TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE path_acl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  path TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(subject_type, subject_id, storage_id, path)
);
```

- [ ] **Step 2: 如果 db.ts 缺少字段，修复 DDL**

对照上述 schema 修改 `src/auth/db.ts` 的 `initializeSchema()` 方法。

- [ ] **Step 3: 运行 db.test.ts 验证**

```bash
npm run test:run src/auth/__tests__/db.test.ts
```
Expected: PASS

- [ ] **Step 4: 运行所有 auth 测试**

```bash
npm run test:run src/auth/
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/db.ts
git commit -m "fix(auth): ensure db schema includes all required columns

- users: is_enabled, last_login_at
- refresh_tokens: next_raw_token
- path_acl: storage_id with unique index

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

