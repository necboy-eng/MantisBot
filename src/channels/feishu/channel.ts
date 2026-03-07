// src/channels/feishu/channel.ts

import { v4 as uuidv4 } from 'uuid';
import type { IChannel, FileAttachment, ChannelMessage } from '../channel.interface.js';
import { startFeishuWSClient, sendFeishuMessage, replyFeishuMessage, sendFeishuFile, stopFeishuWSClient, isFeishuEnabled } from './client.js';
import { FeishuStreamCard } from './stream-card.js';
import { getConfig } from '../../config/loader.js';

export interface FeishuChannelOptions {
  onMessage: (message: ChannelMessage) => Promise<void>;
}

export class FeishuChannel implements IChannel {
  name = 'feishu';
  platform = 'feishu';
  enabled = false;

  private onMessage: FeishuChannelOptions['onMessage'];
  // 记录每个群聊最后一条触发消息的 ID，用于回复引用
  private lastGroupMessageId = new Map<string, string>();

  constructor(options: FeishuChannelOptions) {
    this.onMessage = options.onMessage;
    this.enabled = isFeishuEnabled();
    console.log(`[FeishuChannel] Initialized, enabled=${this.enabled}`);
  }

  async start(): Promise<void> {
    console.log(`[FeishuChannel] start() called, enabled=${this.enabled}`);
    if (!this.enabled) {
      console.log('[FeishuChannel] Disabled, skipping start');
      return;
    }

    await startFeishuWSClient(async (message, chatId, userId, messageId) => {
      // 群聊时记录原消息 ID，回复时用于引用
      this.lastGroupMessageId.set(chatId, messageId);

      const channelMessage: ChannelMessage = {
        id: uuidv4(),
        content: message,
        chatId,
        userId,
        timestamp: Date.now(),
        platform: 'feishu'
      };

      await this.onMessage(channelMessage);
    });

    console.log('[FeishuChannel] Started');
  }

  async stop(): Promise<void> {
    stopFeishuWSClient();
    console.log('[FeishuChannel] Stopped');
  }

  async sendMessage(
    chatId: string,
    message: string,
    attachments?: FileAttachment[]
  ): Promise<void> {
    // 先发送文字消息
    if (message && message.trim()) {
      const replyToId = this.lastGroupMessageId.get(chatId);
      if (replyToId) {
        // 群聊：引用原消息回复
        this.lastGroupMessageId.delete(chatId);
        await replyFeishuMessage(replyToId, message);
        console.log(`[FeishuChannel] Reply sent to ${chatId} (replyTo: ${replyToId})`);
      } else {
        await sendFeishuMessage(chatId, message);
        console.log(`[FeishuChannel] Message sent to ${chatId}`);
      }
    }

    // 再逐个发送附件
    if (attachments && attachments.length > 0) {
      console.log(`[FeishuChannel] Sending ${attachments.length} attachment(s) to ${chatId}`);
      for (const attachment of attachments) {
        try {
          await sendFeishuFile(chatId, attachment as any);
        } catch (err) {
          console.error(`[FeishuChannel] Failed to send attachment ${attachment.name}:`, err);
        }
      }
    }
  }

  /**
   * 流式发送消息（新增）
   * 使用飞书流式卡片实现打字机效果
   */
  async *sendWithStream(
    chatId: string,
    userId?: string,
    generator: AsyncGenerator<{ type: 'text' | 'done', content?: string, files?: any[] }>
  ): AsyncGenerator<void> {
    const config = getConfig();
    const feishuConfig = (config.channels as any)?.feishu;

    // 检查是否启用流式卡片
    if (!feishuConfig?.streaming?.enabled) {
      // 流式未启用，降级为普通发送
      console.log('[FeishuChannel] Streaming disabled, falling back to regular send');
      let fullContent = '';
      let files: any[] = [];
      for await (const chunk of generator) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
        } else if (chunk.type === 'done' && chunk.files) {
          files = chunk.files;
        }
      }
      await this.sendMessage(chatId, fullContent, files);
      return;
    }

    console.log('[FeishuChannel] Using streaming card');

    // 获取客户端
    const feishuModule = await import('../../agents/tools/feishu/client.js');
    const client = await feishuModule.getFeishuClient(userId);

    // 创建流式卡片管理器
    const streamCard = new FeishuStreamCard({ chatId, userId }, client);

    try {
      // 初始化卡片
      await streamCard.initialize();

      let files: any[] = [];
      let chunkCount = 0;

      // 流式处理
      console.log('[FeishuChannel] Starting to consume generator...');
      for await (const chunk of generator) {
        if (chunk.type === 'text' && chunk.content) {
          chunkCount++;
          console.log(`[FeishuChannel] Received chunk #${chunkCount}, length: ${chunk.content.length}, content preview: "${chunk.content.substring(0, 50)}..."`);
          await streamCard.append(chunk.content);
        } else if (chunk.type === 'done') {
          console.log(`[FeishuChannel] Generator done, total chunks: ${chunkCount}`);
          await streamCard.complete();
          // 收集文件附件
          if (chunk.files && chunk.files.length > 0) {
            files = chunk.files;
          }
        }
      }
      console.log(`[FeishuChannel] Streaming completed, total chunks received: ${chunkCount}`);

      // 流式完成后发送文件附件
      if (files.length > 0) {
        console.log(`[FeishuChannel] Sending ${files.length} file(s) after streaming`);
        for (const file of files) {
          try {
            await sendFeishuFile(chatId, file);
          } catch (err) {
            console.error(`[FeishuChannel] Failed to send file ${file.name}:`, err);
          }
        }
      }
    } catch (error: any) {
      console.error('[FeishuChannel] Streaming error:', error);

      // 流式失败，降级为普通发送
      console.log('[FeishuChannel] Falling back to regular send due to error');
      let fullContent = '';
      let files: any[] = [];
      for await (const chunk of generator) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
        } else if (chunk.type === 'done' && chunk.files) {
          files = chunk.files;
        }
      }
      await this.sendMessage(chatId, fullContent, files);
    }
  }
}
