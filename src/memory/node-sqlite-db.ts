// src/memory/node-sqlite-db.ts
// Node.js 内置 sqlite 数据库包装器

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '../../data');

// ES模块中使用require
const require = createRequire(import.meta.url);

export interface SqliteStatement {
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface SqliteTransaction {
  (...params: any[]): any;
}

/**
 * Node.js 内置 sqlite 数据库包装器
 * 提供与 better-sqlite3 兼容的接口
 */
export class NodeSqliteDatabase {
  private db: DatabaseSync;
  private vecExtensionLoaded = false;
  private _path: string;

  constructor(dbPath: string) {
    this._path = dbPath;

    // 确保数据库目录存在
    const dataDir = dirname(dbPath);
    try {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      // 预检目录写权限
      const testFile = join(dataDir, `.write_test_vec_${Date.now()}`);
      try {
        writeFileSync(testFile, 'test');
        unlinkSync(testFile);
      } catch (e: any) {
        console.error(`[NodeSqlite] CRITICAL: Directory "${dataDir}" is NOT writable! Error: ${e.message}`);
        console.error(`[NodeSqlite] Current process UID: ${process.getuid?.()}, GID: ${process.getgid?.()}`);
        console.error(`[NodeSqlite] Please ensure host directory permissions are correct (e.g., sudo chown -R 1000:1000 ./data)`);
      }

      // 创建数据库连接，启用扩展加载
      this.db = new DatabaseSync(dbPath, {
        allowExtension: true
      });

      console.log('[NodeSqlite] Database opened:', dbPath);

      // 同步加载向量扩展（不使用 async）
      this.loadVectorExtensionSync();

      // 初始化数据库模式
      this.initializeSchema();
    } catch (error: any) {
      console.error(`[NodeSqlite] Failed to initialize database at ${dbPath}:`, error.message);
      if (error.code === 'ERR_SQLITE_ERROR' || error.message.includes('unable to open database file')) {
        console.error(`[NodeSqlite] This is likely a permission issue. UID: ${process.getuid?.()}, path: ${dbPath}`);
      }
      throw error;
    }
  }

  /**
   * 同步加载 sqlite-vec 扩展
   */
  private loadVectorExtensionSync(): void {
    try {
      // 使用createRequire在ES模块中导入sqlite-vec
      const sqliteVec = require('sqlite-vec');

      // 加载 sqlite-vec 扩展（扩展加载已在构造函数中启用）
      const extensionPath = sqliteVec.getLoadablePath();
      this.db.loadExtension(extensionPath);

      this.vecExtensionLoaded = true;
      console.log('[NodeSqlite] sqlite-vec extension loaded successfully:', extensionPath);

      // 测试扩展功能
      try {
        const testResult = this.db.prepare('SELECT vec_version()').get();
        console.log('[NodeSqlite] sqlite-vec version:', testResult);
      } catch (error) {
        console.warn('[NodeSqlite] Vector extension test failed:', error);
        this.vecExtensionLoaded = false;
      }

    } catch (error) {
      this.vecExtensionLoaded = false;
      console.warn('[NodeSqlite] sqlite-vec extension loading failed, using JS fallback:', error);
    } finally {
      // 禁用扩展加载以提高安全性
      try {
        this.db.enableLoadExtension(false);
      } catch (error) {
        console.warn('[NodeSqlite] Failed to disable extension loading:', error);
      }
    }
  }

  /**
   * 初始化数据库 schema
   */
  private initializeSchema(): void {
    // Create chunks_vec table (主表)
    this.exec(`
      CREATE TABLE IF NOT EXISTS chunks_vec (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_key TEXT,
        content TEXT NOT NULL,
        embedding BLOB,
        source TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Create FTS5 全文搜索表（添加 id 列以便关联查询）
    this.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        id UNINDEXED,
        content,
        content_agent_id UNINDEXED,
        content_session_key UNINDEXED
      )
    `);

    // 如果 sqlite-vec 扩展可用，创建向量表
    if (this.vecExtensionLoaded) {
      try {
        // 创建向量虚拟表（动态维度，从 embeddings 中检测）
        // 默认1536维（OpenAI embeddings），如果不适用会在运行时调整
        this.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec_search USING vec0(
            id TEXT PRIMARY KEY,
            embedding FLOAT[1536]
          )
        `);
        console.log('[NodeSqlite] Vector table initialized');
      } catch (error) {
        console.warn('[NodeSqlite] Vector table creation failed:', error);
        this.vecExtensionLoaded = false;
      }
    }

    // Create indexes
    this.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_agent ON chunks_vec(agent_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks_vec(session_key);
      CREATE INDEX IF NOT EXISTS idx_chunks_agent_session ON chunks_vec(agent_id, session_key, created_at DESC);
    `);

    console.log('[NodeSqlite] Database schema initialized');
  }

  /**
   * 执行 SQL 语句（无返回值）
   */
  exec(sql: string): void {
    return this.db.exec(sql);
  }

  /**
   * 准备 SQL 语句
   */
  prepare(sql: string): SqliteStatement {
    const stmt = this.db.prepare(sql);

    // 包装返回对象以提供 better-sqlite3 兼容接口
    return {
      run: (...params: any[]) => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid
        };
      },
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params)
    };
  }

  /**
   * 事务支持
   */
  transaction<T extends any[], R>(fn: (...args: T) => R): (...args: T) => R {
    return (...args: T): R => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      console.log('[NodeSqlite] Database closed');
    }
  }

  /**
   * 获取数据库路径
   */
  get path(): string {
    return this._path;
  }

  /**
   * 启用扩展加载（node:sqlite 兼容方法）
   */
  enableLoadExtension(enable: boolean): void {
    try {
      this.db.enableLoadExtension(enable);
    } catch (error) {
      console.warn('[NodeSqlite] enableLoadExtension failed:', error);
      throw error;
    }
  }

  /**
   * 加载扩展（node:sqlite 兼容方法）
   */
  loadExtension(path: string): void {
    try {
      this.db.loadExtension(path);
    } catch (error) {
      console.error('[NodeSqlite] loadExtension failed:', error);
      throw error;
    }
  }

  /**
   * 检查向量扩展是否可用
   */
  isVectorExtensionLoaded(): boolean {
    return this.vecExtensionLoaded;
  }

  /**
   * 获取数据库状态信息
   */
  getStatus(): {
    path: string;
    vectorExtension: boolean;
    tablesCount: number;
  } {
    const tables = this.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get();

    return {
      path: this._path,
      vectorExtension: this.vecExtensionLoaded,
      tablesCount: tables.count
    };
  }

  /**
   * 执行向量搜索（如果扩展可用）
   */
  vectorSearch(embedding: Float32Array, limit: number = 50): any[] {
    if (!this.vecExtensionLoaded) {
      throw new Error('Vector extension not loaded. Use fallback search instead.');
    }

    const stmt = this.prepare(`
      SELECT v.id, c.agent_id, c.content, c.source, c.created_at,
             vec_distance_cosine(v.embedding, ?) AS distance
      FROM chunks_vec_search v
      JOIN chunks_vec c ON c.id = v.id
      ORDER BY distance ASC
      LIMIT ?
    `);

    return stmt.all(Buffer.from(embedding.buffer), limit);
  }
}

// 全局数据库实例管理
let globalDb: NodeSqliteDatabase | null = null;
let globalDbPath: string | null = null;

/**
 * 初始化内存数据库
 */
export function initMemoryDb(workspace?: string): NodeSqliteDatabase {
  const dataDir = workspace || DEFAULT_DATA_DIR;
  const dbPath = join(dataDir, 'memory.db');

  if (globalDb && globalDbPath === dbPath) {
    return globalDb;
  }

  // 关闭之前的连接
  if (globalDb) {
    globalDb.close();
  }

  globalDb = new NodeSqliteDatabase(dbPath);
  globalDbPath = dbPath;

  return globalDb;
}

/**
 * 获取当前内存数据库实例
 */
export function getMemoryDb(): NodeSqliteDatabase {
  if (!globalDb) {
    return initMemoryDb();
  }
  return globalDb;
}

/**
 * 关闭内存数据库
 */
export function closeMemoryDb(): void {
  if (globalDb) {
    globalDb.close();
    globalDb = null;
    globalDbPath = null;
  }
}