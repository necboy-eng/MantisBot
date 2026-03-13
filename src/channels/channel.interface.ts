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
  agentProfile?: string;       // 实例指定的 Agent 人格
  agentTeam?: string;          // 实例指定的 Agent team ID
  workingDirectory?: string;   // 实例工作主目录
  feishuInstanceId?: string;   // 飞书实例 ID（工具层路由用）
  attachments?: FileAttachment[];  // 消息附件（飞书等渠道传递）
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
