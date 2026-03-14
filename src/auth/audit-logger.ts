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
  | 'password_changed'
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
