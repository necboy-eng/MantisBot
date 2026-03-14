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
