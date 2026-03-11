// src/channels/channel.interface.ts

// 复用 types.ts 中统一的 FileAttachment 定义，消除重复
import type { FileAttachment } from '../types.js';
export type { FileAttachment };

export interface ChannelMessage {
  id: string;
  content: string;
  chatId: string;
  userId?: string;
  timestamp: number;
  platform: string;
  channel?: string;  // 渠道标识
  attachments?: FileAttachment[];
}

export interface ChannelContext {
  chatId: string;
  userId?: string;
  platform: string;
  channel?: string;
  [key: string]: unknown;
}

export type ChannelStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export type MessageHandler = (message: ChannelMessage, context: ChannelContext) => Promise<void>;

export interface IChannel {
  name: string;
  platform: string;
  enabled: boolean;

  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(
    chatId: string,
    message: string,
    attachments?: FileAttachment[]
  ): Promise<void>;

  isReady?(): boolean;
}
