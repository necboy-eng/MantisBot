/**
 * Email Service - IMAP 操作封装
 * 提供邮件收取、读取、标记等功能的 API
 */

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置文件路径
const CONFIG_PATH = path.resolve(__dirname, '../../config/config.json');

export interface EmailAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  provider: string;
  imap: {
    host: string;
    port: number;
    tls: boolean;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
  enabled: boolean;
  isDefault: boolean;
}

export interface Mailbox {
  name: string;
  delimiter: string;
  attributes: string[];
}

export interface EmailMessage {
  uid: number;
  from: string;
  to?: string;
  subject: string;
  date: Date;
  text?: string;
  html?: string;
  snippet: string;
  flags?: string[];
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
}

// IMAP ID 信息（用于 163.com 等兼容）
const IMAP_ID = {
  name: 'mantisbot',
  version: '1.0.0',
  vendor: 'mantisbot',
  'support-email': 'support@mantisbot.local'
};

// 读取配置
function loadConfig() {
  try {
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);
    return config.email || { enabled: false, accounts: [] };
  } catch (err) {
    console.error('Error loading config:', err);
    return { enabled: false, accounts: [] };
  }
}

// 获取账户配置
export function getAccount(accountId?: string): EmailAccount | null {
  const emailConfig = loadConfig();

  if (!emailConfig.enabled || !emailConfig.accounts || emailConfig.accounts.length === 0) {
    return null;
  }

  // 如果指定了账户 ID，查找该账户
  if (accountId) {
    return emailConfig.accounts.find((a: EmailAccount) => a.id === accountId && a.enabled) || null;
  }

  // 否则使用默认账户
  const defaultAccount = emailConfig.accounts.find((a: EmailAccount) => a.isDefault && a.enabled);
  if (defaultAccount) return defaultAccount;

  // 如果没有默认账户，使用第一个启用的账户
  return emailConfig.accounts.find((a: EmailAccount) => a.enabled) || null;
}

// 获取所有启用的账户列表
export function getAccounts(): EmailAccount[] {
  const emailConfig = loadConfig();
  if (!emailConfig.enabled || !emailConfig.accounts) {
    return [];
  }
  return emailConfig.accounts.filter((a: EmailAccount) => a.enabled);
}

// 创建 IMAP 配置
function createImapConfig(account: EmailAccount): Imap.Config {
  return {
    user: account.email,
    password: account.password,
    host: account.imap.host,
    port: account.imap.port,
    tls: account.imap.tls,
    tlsOptions: {
      rejectUnauthorized: true,
    },
    connTimeout: 10000,
    authTimeout: 10000,
  };
}

// 连接 IMAP 服务器
async function connect(account: EmailAccount): Promise<Imap> {
  const config = createImapConfig(account);

  if (!config.user || !config.password) {
    throw new Error('Missing email or password in account configuration');
  }

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    imap.once('ready', () => {
      // 发送 IMAP ID 命令（用于兼容性）
      const imapAny = imap as any;
      if (typeof imapAny.id === 'function') {
        imapAny.id(IMAP_ID, (err: any) => {
          if (err) {
            console.warn('Warning: IMAP ID command failed:', err.message);
          }
          resolve(imap);
        });
      } else {
        resolve(imap);
      }
    });

    imap.once('error', (err) => {
      reject(new Error(`IMAP connection failed: ${err.message}`));
    });

    imap.connect();
  });
}

// 打开邮箱文件夹
function openBox(imap: Imap, mailbox: string, readOnly = false): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, readOnly, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
}

// 搜索邮件
function searchMessages(imap: Imap, criteria: any[], fetchOptions: Imap.FetchOptions): Promise<any[]> {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      if (!results || results.length === 0) {
        resolve([]);
        return;
      }

      const fetch = imap.fetch(results, fetchOptions);
      const messages: any[] = [];

      fetch.on('message', (msg) => {
        const parts: any[] = [];

        msg.on('body', (stream: any, info: any) => {
          let buffer = '';

          stream.on('data', (chunk: any) => {
            buffer += chunk.toString('utf8');
          });

          stream.once('end', () => {
            parts.push({ which: info.which, body: buffer });
          });
        });

        msg.once('attributes', (attrs) => {
          parts.forEach((part) => {
            part.attributes = attrs;
          });
        });

        msg.once('end', () => {
          if (parts.length > 0) {
            messages.push(parts[0]);
          }
        });
      });

      fetch.once('error', (err) => {
        reject(err);
      });

      fetch.once('end', () => {
        resolve(messages);
      });
    });
  });
}

// 解析邮件
async function parseEmail(bodyStr: string): Promise<Omit<EmailMessage, 'uid' | 'flags'>> {
  const parsed: any = await simpleParser(bodyStr);

  // 处理地址对象
  const fromText = parsed.from?.text || 'Unknown';
  const toText = parsed.to?.text || undefined;

  return {
    from: fromText,
    to: toText,
    subject: parsed.subject || '(no subject)',
    date: parsed.date || new Date(),
    text: parsed.text,
    html: parsed.html,
    snippet: parsed.text
      ? parsed.text.slice(0, 200)
      : (parsed.html ? parsed.html.slice(0, 200).replace(/<[^>]*>/g, '') : ''),
    attachments: parsed.attachments?.map((a: any) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      cid: a.cid,
    })),
  };
}

// 获取邮箱文件夹列表
export async function listMailboxes(accountId?: string): Promise<Mailbox[]> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    return new Promise((resolve, reject) => {
      imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(formatMailboxTree(boxes));
      });
    });
  } finally {
    imap.end();
  }
}

// 格式化邮箱文件夹树
function formatMailboxTree(boxes: any, prefix = ''): Mailbox[] {
  const result: Mailbox[] = [];
  const entries = Object.entries(boxes) as [string, any][];
  for (const [name, info] of entries) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    result.push({
      name: fullName,
      delimiter: info.delimiter,
      attributes: info.attribs,
    });

    if (info.children) {
      result.push(...formatMailboxTree(info.children, fullName));
    }
  }
  return result;
}

// 获取邮件列表
export async function listEmails(
  accountId: string | undefined,
  mailbox: string = 'INBOX',
  limit: number = 50,
  offset: number = 0
): Promise<EmailMessage[]> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    await openBox(imap, mailbox);

    // 搜索所有邮件
    const messages = await searchMessages(imap, ['ALL'], {
      bodies: [''],
      markSeen: false,
    });

    // 按日期排序（最新在前）
    const sortedMessages = messages.sort((a, b) => {
      const dateA = a.attributes?.date ? new Date(a.attributes.date).getTime() : 0;
      const dateB = b.attributes?.date ? new Date(b.attributes.date).getTime() : 0;
      return dateB - dateA;
    });

    // 分页
    const paginatedMessages = sortedMessages.slice(offset, offset + limit);

    const results: EmailMessage[] = [];

    for (const item of paginatedMessages) {
      const bodyStr = item.body;
      const parsed = await parseEmail(bodyStr);

      results.push({
        uid: item.attributes.uid,
        ...parsed,
        flags: item.attributes.flags,
      });
    }

    return results;
  } finally {
    imap.end();
  }
}

// 获取邮件详情
export async function getEmail(accountId: string | undefined, uid: number, mailbox: string = 'INBOX'): Promise<EmailMessage> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`Message UID ${uid} not found`);
    }

    const item = messages[0];
    const parsed = await parseEmail(item.body);

    return {
      uid: item.attributes.uid,
      ...parsed,
      flags: item.attributes.flags,
    };
  } finally {
    imap.end();
  }
}

// 获取附件内容
export async function getAttachment(
  accountId: string | undefined,
  uid: number,
  filename: string,
  mailbox: string = 'INBOX'
): Promise<{ content: Buffer; contentType: string; filename: string }> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`Message UID ${uid} not found`);
    }

    const item = messages[0];
    const parsed = await simpleParser(item.body);

    // 查找匹配的附件
    const attachment = parsed.attachments?.find((a) => a.filename === filename);

    if (!attachment || !attachment.content) {
      throw new Error(`Attachment "${filename}" not found`);
    }

    return {
      content: attachment.content,
      contentType: attachment.contentType,
      filename: attachment.filename || '',
    };
  } finally {
    imap.end();
  }
}

// 标记邮件为已读
export async function markAsRead(accountId: string | undefined, uid: number, mailbox: string = 'INBOX'): Promise<void> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    await openBox(imap, mailbox, false);

    return new Promise((resolve, reject) => {
      imap.addFlags([uid], '\\Seen', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    imap.end();
  }
}

// 标记邮件为未读
export async function markAsUnread(accountId: string | undefined, uid: number, mailbox: string = 'INBOX'): Promise<void> {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('No email account available');
  }

  const imap = await connect(account);

  try {
    await openBox(imap, mailbox, false);

    return new Promise((resolve, reject) => {
      imap.delFlags([uid], '\\Seen', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    imap.end();
  }
}
