// src/session/manager.ts

import { v4 as uuidv4 } from 'uuid';
import type { Session, Message } from '../types.js';
import { SessionStorage } from './storage.js';

export class SessionManager {
  private storage: SessionStorage;
  private maxMessages: number;

  constructor(maxMessages: number = 100, workspace?: string) {
    this.storage = new SessionStorage(workspace);
    this.maxMessages = maxMessages;
  }

  createSession(id: string, model: string, name?: string, ownerId?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: id || uuidv4(),
      name,
      model,
      messages: [],
      createdAt: now,
      updatedAt: now,
      ...(ownerId ? { ownerId } : {}),
    };
    this.storage.set(session);
    return session;
  }

  /**
   * 列出指定归属者的会话。
   * - 传入 ownerId：只返回该用户的会话
   * - 传入 undefined：返回所有无 ownerId 的会话（外部渠道 / auth 未开启时）
   * - 传入 null：返回全部会话（管理员场景备用）
   */
  listByOwner(ownerId: string | undefined | null): Session[] {
    const all = this.storage.list();
    if (ownerId === null) {
      // null 表示不过滤，返回全部
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return all
      .filter(s => s.ownerId === ownerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(id: string): Session | undefined {
    return this.storage.get(id);
  }

  updateSession(session: Session): void {
    session.updatedAt = Date.now();
    this.storage.set(session);
  }

  deleteSession(id: string): boolean {
    return this.storage.delete(id);
  }

  listSessions(): Session[] {
    return this.storage.list().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message | undefined {
    const session = this.storage.get(sessionId);
    if (!session) return undefined;

    const messageWithMeta: Message = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    session.messages.push(messageWithMeta);

    // Trim old messages if needed
    if (session.messages.length > this.maxMessages) {
      session.messages = session.messages.slice(-this.maxMessages);
    }

    this.updateSession(session);
    return messageWithMeta;
  }

  getHistory(sessionId: string, limit?: number): Message[] {
    const session = this.storage.get(sessionId);
    if (!session) return [];

    if (limit) {
      return session.messages.slice(-limit);
    }
    return session.messages;
  }

  clearSession(sessionId: string): boolean {
    const session = this.storage.get(sessionId);
    if (!session) return false;

    session.messages = [];
    this.updateSession(session);
    return true;
  }

  /**
   * 删除单条消息
   * @returns true 删除成功，false 会话或消息不存在
   */
  deleteMessage(sessionId: string, messageId: string): boolean {
    const session = this.storage.get(sessionId);
    if (!session) return false;

    const index = session.messages.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    session.messages.splice(index, 1);
    this.updateSession(session);
    return true;
  }

  /**
   * 截断消息：删除指定消息及其之后的所有消息（用于重发场景）
   * @param messageId 从该条消息开始截断（包含该条）
   * @returns 被删除的消息数量，-1 表示会话或消息不存在
   */
  truncateFrom(sessionId: string, messageId: string): number {
    const session = this.storage.get(sessionId);
    if (!session) return -1;

    const index = session.messages.findIndex(m => m.id === messageId);
    if (index === -1) return -1;

    const removedCount = session.messages.length - index;
    session.messages = session.messages.slice(0, index);
    this.updateSession(session);
    return removedCount;
  }

  /**
   * 归档过期会话：清空消息但保留会话元数据
   *
   * 策略说明：
   * - 保留 session ID，避免频道渠道（如飞书群聊）再次发消息时 404
   * - 只清空 messages，让下一条消息自然开启新的上下文
   * - 比完全删除更安全，不破坏渠道的 chatId 映射关系
   *
   * @param ttlDays 不活跃超过多少天的会话会被归档（0 = 禁用）
   * @returns 已归档的会话数量
   */
  /**
   * 立即将内存数据写入磁盘（进程退出前调用，防止防抖 timer 尚未触发导致数据丢失）
   */
  flushSync(): void {
    this.storage.flushSync();
  }

  archiveInactiveSessions(ttlDays: number): number {
    if (ttlDays <= 0) return 0;

    const now = Date.now();
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const sessions = this.storage.list();
    let archived = 0;

    for (const session of sessions) {
      const inactiveMs = now - session.updatedAt;
      if (inactiveMs > ttlMs && session.messages.length > 0) {
        console.log(
          `[SessionManager] 归档过期会话 ${session.id}` +
          `（最后活跃：${Math.floor(inactiveMs / 86400000)} 天前，` +
          `清除 ${session.messages.length} 条消息）`
        );
        session.messages = [];
        this.storage.set(session);
        archived++;
      }
    }

    if (archived > 0) {
      console.log(`[SessionManager] 本次共归档 ${archived} 个过期会话（TTL=${ttlDays} 天）`);
    }

    return archived;
  }
}
