/**
 * 邮件本地缓存服务
 * 将邮件内容缓存到本地 JSON 文件，减少重复的 IMAP 拉取
 *
 * 目录结构：
 *   {cacheDir}/{accountId}/{mailbox}/{uid}.json  — 单封邮件内容
 *   {cacheDir}/{accountId}/{mailbox}/index.json  — 索引（已知uid列表、maxUid）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { EmailMessage } from './email-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 缓存根目录：项目根/data/email-cache
const CACHE_ROOT = path.resolve(__dirname, '../../data/email-cache');

// 每个 mailbox 的索引结构
export interface MailboxIndex {
  accountId: string;
  mailbox: string;
  uids: number[];          // 已缓存的 uid 列表（升序）
  maxUid: number;          // 已知最大 uid（用于轮询时快速比较）
  updatedAt: number;       // 上次更新时间戳
}

function safeMailboxName(mailbox: string): string {
  // 将文件夹名中的路径分隔符替换掉，避免目录层级问题
  return mailbox.replace(/[/\\]/g, '_');
}

function mailboxDir(accountId: string, mailbox: string): string {
  return path.join(CACHE_ROOT, accountId, safeMailboxName(mailbox));
}

function indexPath(accountId: string, mailbox: string): string {
  return path.join(mailboxDir(accountId, mailbox), 'index.json');
}

function emailPath(accountId: string, mailbox: string, uid: number): string {
  return path.join(mailboxDir(accountId, mailbox), `${uid}.json`);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 读取索引
export function readIndex(accountId: string, mailbox: string): MailboxIndex {
  const p = indexPath(accountId, mailbox);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // 损坏时重建
    }
  }
  return { accountId, mailbox, uids: [], maxUid: 0, updatedAt: 0 };
}

// 写入索引
function writeIndex(index: MailboxIndex) {
  ensureDir(mailboxDir(index.accountId, index.mailbox));
  fs.writeFileSync(indexPath(index.accountId, index.mailbox), JSON.stringify(index, null, 2));
}

// 检查某封邮件是否已缓存
export function isCached(accountId: string, mailbox: string, uid: number): boolean {
  return fs.existsSync(emailPath(accountId, mailbox, uid));
}

// 从缓存读取单封邮件
export function getFromCache(accountId: string, mailbox: string, uid: number): EmailMessage | null {
  const p = emailPath(accountId, mailbox, uid);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // date 字段从 JSON 反序列化后是字符串，需转回 Date
    return { ...data, date: new Date(data.date) } as EmailMessage;
  } catch {
    return null;
  }
}

// 写入单封邮件到缓存，并更新索引
export function putToCache(accountId: string, mailbox: string, email: EmailMessage) {
  ensureDir(mailboxDir(accountId, mailbox));
  fs.writeFileSync(emailPath(accountId, mailbox, email.uid), JSON.stringify(email, null, 2));

  const index = readIndex(accountId, mailbox);
  if (!index.uids.includes(email.uid)) {
    index.uids.push(email.uid);
    index.uids.sort((a, b) => a - b);
  }
  if (email.uid > index.maxUid) {
    index.maxUid = email.uid;
  }
  index.updatedAt = Date.now();
  writeIndex(index);
}

// 批量写入邮件（listEmails 返回结果后调用）
export function putBatchToCache(accountId: string, mailbox: string, emails: EmailMessage[]) {
  if (emails.length === 0) return;
  ensureDir(mailboxDir(accountId, mailbox));
  const index = readIndex(accountId, mailbox);
  for (const email of emails) {
    fs.writeFileSync(emailPath(accountId, mailbox, email.uid), JSON.stringify(email, null, 2));
    if (!index.uids.includes(email.uid)) {
      index.uids.push(email.uid);
    }
    if (email.uid > index.maxUid) {
      index.maxUid = email.uid;
    }
  }
  index.uids.sort((a, b) => a - b);
  index.updatedAt = Date.now();
  writeIndex(index);
}

// 更新邮件的 flags（标记已读/未读时调用，不重新拉取全文）
export function updateCachedFlags(accountId: string, mailbox: string, uid: number, flags: string[]) {
  const email = getFromCache(accountId, mailbox, uid);
  if (!email) return;
  email.flags = flags;
  fs.writeFileSync(emailPath(accountId, mailbox, uid), JSON.stringify(email, null, 2));
}

// 从缓存批量读取邮件列表（按 uid 降序，支持分页）
export function listFromCache(
  accountId: string,
  mailbox: string,
  limit: number,
  offset: number
): { emails: EmailMessage[]; total: number } {
  const index = readIndex(accountId, mailbox);
  // uid 降序（最新在前）
  const sortedUids = [...index.uids].sort((a, b) => b - a);
  const total = sortedUids.length;
  const pageUids = sortedUids.slice(offset, offset + limit);
  const emails: EmailMessage[] = [];
  for (const uid of pageUids) {
    const email = getFromCache(accountId, mailbox, uid);
    if (email) emails.push(email);
  }
  return { emails, total };
}

// 清理过旧缓存（保留最近 maxCount 封）
export function pruneCache(accountId: string, mailbox: string, maxCount = 500) {
  const index = readIndex(accountId, mailbox);
  if (index.uids.length <= maxCount) return;
  // 删除最旧的部分
  const toDelete = index.uids.slice(0, index.uids.length - maxCount);
  for (const uid of toDelete) {
    const p = emailPath(accountId, mailbox, uid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  index.uids = index.uids.slice(index.uids.length - maxCount);
  index.updatedAt = Date.now();
  writeIndex(index);
}
