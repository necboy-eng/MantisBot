/**
 * 邮件轮询服务
 * 定期检查各邮箱账户的 INBOX，发现新邮件时通过 WebSocket 广播通知前端
 */

import { getAccounts, connect, openBox } from './email-service.js';
import { readIndex, putBatchToCache } from './email-cache.js';
import { simpleParser } from 'mailparser';
import type { EmailMessage } from './email-service.js';
import { broadcastToClients } from '../channels/http-ws/ws-server.js';

// 默认轮询间隔：5 分钟
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// 每次轮询仅检查 INBOX
const POLL_MAILBOX = 'INBOX';

let pollTimer: NodeJS.Timeout | null = null;

// 拉取所有 uid（复用已带 IMAP ID 的 connect）
async function fetchAllUids(account: any): Promise<number[]> {
  const imap = await connect(account);
  return new Promise((resolve, reject) => {
    openBox(imap, POLL_MAILBOX, true)
      .then(() => {
        imap.search(['ALL'], (err, results) => {
          imap.end();
          if (err) return reject(err);
          resolve(results || []);
        });
      })
      .catch((err) => {
        imap.end();
        reject(err);
      });
  });
}

// 拉取指定 uid 列表的邮件正文（复用已带 IMAP ID 的 connect）
async function fetchEmailsByUids(account: any, uids: number[]): Promise<EmailMessage[]> {
  if (uids.length === 0) return [];

  const imap = await connect(account);
  return new Promise((resolve, reject) => {
    openBox(imap, POLL_MAILBOX, true)
      .then(() => {
        const fetch = imap.fetch(uids, { bodies: [''], markSeen: false });
        const rawMessages: any[] = [];

        fetch.on('message', (msg) => {
          let body = '';
          let attrs: any = {};
          msg.on('body', (stream: any) => {
            stream.on('data', (chunk: any) => { body += chunk.toString('utf8'); });
          });
          msg.once('attributes', (a) => { attrs = a; });
          msg.once('end', () => rawMessages.push({ body, attrs }));
        });

        fetch.once('error', (e: Error) => { imap.end(); reject(e); });
        fetch.once('end', async () => {
          imap.end();
          const parsed: EmailMessage[] = [];
          for (const { body, attrs } of rawMessages) {
            try {
              const p: any = await simpleParser(body);
              parsed.push({
                uid: attrs.uid,
                from: p.from?.text || 'Unknown',
                to: p.to?.text,
                subject: p.subject || '(no subject)',
                date: p.date || new Date(),
                text: p.text,
                html: p.html,
                snippet: p.text ? p.text.slice(0, 200) : (p.html ? p.html.slice(0, 200).replace(/<[^>]*>/g, '') : ''),
                flags: attrs.flags,
                attachments: p.attachments?.map((a: any) => ({
                  filename: a.filename,
                  contentType: a.contentType,
                  size: a.size,
                  cid: a.cid,
                })),
              });
            } catch { /* 单封解析失败时跳过 */ }
          }
          resolve(parsed);
        });
      })
      .catch((err) => {
        imap.end();
        reject(err);
      });
  });
}

// 执行一次轮询
async function poll() {
  const accounts = getAccounts();
  if (accounts.length === 0) return;

  for (const account of accounts) {
    try {
      const allUids = await fetchAllUids(account);
      const index = readIndex(account.id, POLL_MAILBOX);
      const cachedUidSet = new Set(index.uids);

      // 找出新邮件（缓存中没有的 uid）
      const newUids = allUids.filter(uid => !cachedUidSet.has(uid));
      if (newUids.length === 0) continue;

      // 拉取新邮件正文
      const newEmails = await fetchEmailsByUids(account, newUids);
      if (newEmails.length === 0) continue;

      // 写入缓存
      putBatchToCache(account.id, POLL_MAILBOX, newEmails);

      // 统计未读数（新邮件中未含 \Seen flag 的）
      const unreadEmails = newEmails.filter(e => !e.flags?.includes('\\Seen'));
      const unreadCount = unreadEmails.length;

      // 广播新邮件通知
      broadcastToClients('email-new-messages', {
        accountId: account.id,
        accountEmail: account.email,
        mailbox: POLL_MAILBOX,
        newCount: newEmails.length,
        unreadCount,
        // 发送摘要信息（不含完整正文，节省带宽）
        emails: newEmails.map(e => ({
          uid: e.uid,
          from: e.from,
          subject: e.subject,
          date: e.date,
          snippet: e.snippet,
          flags: e.flags,
          hasAttachments: !!(e.attachments && e.attachments.length > 0),
        })),
      });

      console.log(`[EmailPoller] ${account.email}: ${newEmails.length} new email(s), ${unreadCount} unread`);
    } catch (err) {
      console.error(`[EmailPoller] Failed to poll ${account.email}:`, err);
    }
  }
}

// 启动轮询服务
export function startEmailPoller(intervalMs = DEFAULT_INTERVAL_MS) {
  if (pollTimer) return; // 已在运行

  // 启动后立即执行一次，填充初始缓存
  poll().catch(err => console.error('[EmailPoller] Initial poll failed:', err));

  pollTimer = setInterval(() => {
    poll().catch(err => console.error('[EmailPoller] Poll failed:', err));
  }, intervalMs);

  console.log(`[EmailPoller] Started, interval: ${intervalMs / 1000}s`);
}

// 停止轮询服务
export function stopEmailPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[EmailPoller] Stopped');
  }
}

// 立即触发一次轮询（供 HTTP API 调用）
export function triggerPoll(): Promise<void> {
  return poll();
}
