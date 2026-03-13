// src/channels/feishu/channel.ts

import { v4 as uuidv4 } from 'uuid';
import type { IChannel, FileAttachment, ChannelMessage, ChannelContext } from '../channel.interface.js';
import { FeishuClient } from './client.js';
import type { FeishuInstanceConfig } from '../../config/schema.js';
import type { SessionManager } from '../../session/manager.js';
import type { MemoryManager } from '../../memory/manager.js';
import { FeishuStreamCard } from './stream-card.js';

export class FeishuChannel implements IChannel {
  name: string;       // 'feishu:${instanceId}'
  platform = 'feishu';
  enabled: boolean;

  private client: FeishuClient;
  private instanceConfig: FeishuInstanceConfig;
  private sessionManager: SessionManager;
  private memoryManager?: MemoryManager;
  private onMessageHandler: (message: ChannelMessage, context: ChannelContext) => Promise<void>;
  private lastGroupMessageId = new Map<string, string>();

  constructor(
    instanceConfig: FeishuInstanceConfig,
    sessionManager: SessionManager,
    onMessageHandler: (message: ChannelMessage, context: ChannelContext) => Promise<void>,
    memoryManager?: MemoryManager,
  ) {
    this.instanceConfig = instanceConfig;
    this.name = `feishu:${instanceConfig.id}`;
    this.enabled = instanceConfig.enabled;
    this.client = new FeishuClient(instanceConfig);
    this.sessionManager = sessionManager;
    this.memoryManager = memoryManager;
    this.onMessageHandler = onMessageHandler;
    console.log(`[FeishuChannel:${instanceConfig.id}] Initialized, enabled=${this.enabled}`);
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      console.log(`[FeishuChannel:${this.instanceConfig.id}] Disabled, skipping start`);
      return;
    }
    const instanceId = this.instanceConfig.id;

    await this.client.start(async (message, chatId, userId, messageId, attachments) => {
      this.lastGroupMessageId.set(chatId, messageId);

      const channelMessage: ChannelMessage = {
        id: uuidv4(),
        content: message,
        chatId,
        userId,
        timestamp: Date.now(),
        platform: 'feishu',
        channel: this.name,
        attachments: attachments as FileAttachment[] | undefined,
      };

      const context: ChannelContext = {
        chatId,
        userId,
        platform: 'feishu',
        channel: this.name,
        agentProfile: this.instanceConfig.profile,
        agentTeam: this.instanceConfig.team,
        workingDirectory: this.instanceConfig.workingDirectory,
        feishuInstanceId: instanceId,
      };

      await this.onMessageHandler(channelMessage, context);
    });

    console.log(`[FeishuChannel:${instanceId}] Started`);
  }

  async stop(): Promise<void> {
    await this.client.stop();
    console.log(`[FeishuChannel:${this.instanceConfig.id}] Stopped`);
  }

  async sendMessage(chatId: string, message: string, attachments?: FileAttachment[]): Promise<void> {
    if (message && message.trim()) {
      const replyToId = this.lastGroupMessageId.get(chatId);
      if (replyToId) {
        this.lastGroupMessageId.delete(chatId);
        await this.client.replyMessage(replyToId, message);
        console.log(`[FeishuChannel:${this.instanceConfig.id}] Reply sent to ${chatId} (replyTo: ${replyToId})`);
      } else {
        await this.client.sendMessage(chatId, message);
        console.log(`[FeishuChannel:${this.instanceConfig.id}] Message sent to ${chatId}`);
      }
    }

    if (attachments && attachments.length > 0) {
      console.log(`[FeishuChannel:${this.instanceConfig.id}] Sending ${attachments.length} attachment(s) to ${chatId}`);
      for (const attachment of attachments) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await this.client.sendFile(chatId, attachment as any);
        } catch (err) {
          console.error(`[FeishuChannel:${this.instanceConfig.id}] Failed to send attachment ${attachment.name}:`, err);
        }
      }
    }
  }

  /**
   * 流式发送消息（飞书流式卡片）
   */
  async *sendWithStream(
    chatId: string,
    generator: AsyncGenerator<{ type: 'text' | 'done'; content?: string; files?: any[] }>,
    userId?: string
  ): AsyncGenerator<void> {
    const streaming = this.instanceConfig.streaming;

    // 检查是否启用流式卡片
    if (!streaming?.enabled) {
      // 流式未启用，降级为普通发送
      console.log(`[FeishuChannel:${this.instanceConfig.id}] Streaming disabled, falling back to regular send`);
      let fullContent = '';
      let files: any[] = [];
      for await (const chunk of generator) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
        } else if (chunk.type === 'done') {
          if (chunk.files) files = chunk.files;
        }
      }
      await this.sendMessage(chatId, fullContent, files);
      return;
    }

    console.log(`[FeishuChannel:${this.instanceConfig.id}] Using streaming card`);

    // 使用工具层客户端（已注册的实例级 FeishuClientManager）
    const feishuModule = await import('../../agents/tools/feishu/client.js');
    // TODO(Task 6): 传入 this.instanceConfig.id 以支持多实例工具客户端
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolClient = await (feishuModule.getFeishuClient as any)(userId, this.instanceConfig.id);

    const streamCard = new FeishuStreamCard({ chatId, userId }, toolClient);
    let collectedFiles: any[] = [];
    let collectedContent = '';

    try {
      await streamCard.initialize();

      let chunkCount = 0;

      console.log(`[FeishuChannel:${this.instanceConfig.id}] Starting to consume generator...`);
      for await (const chunk of generator) {
        if (chunk.type === 'text' && chunk.content) {
          chunkCount++;
          collectedContent += chunk.content;
          console.log(`[FeishuChannel:${this.instanceConfig.id}] Received chunk #${chunkCount}, length: ${chunk.content.length}`);
          await streamCard.append(chunk.content);
        } else if (chunk.type === 'done') {
          console.log(`[FeishuChannel:${this.instanceConfig.id}] Generator done, total chunks: ${chunkCount}, files: ${chunk.files?.length ?? 0}`);
          if (chunk.files && chunk.files.length > 0) {
            collectedFiles = chunk.files;
          }
          await streamCard.complete();
        }
      }
      console.log(`[FeishuChannel:${this.instanceConfig.id}] Streaming completed, total chunks: ${chunkCount}, files: ${collectedFiles.length}`);

      // 流式完成后发送文件附件
      if (collectedFiles.length > 0) {
        console.log(`[FeishuChannel:${this.instanceConfig.id}] Sending ${collectedFiles.length} file(s) after streaming`);
        for (const file of collectedFiles) {
          try {
            await this.client.sendFile(chatId, file);
          } catch (err) {
            console.error(`[FeishuChannel:${this.instanceConfig.id}] Failed to send file ${file.name}:`, err);
          }
        }
      }
    } catch (error: any) {
      console.error(`[FeishuChannel:${this.instanceConfig.id}] Streaming error:`, error);

      // 流式失败，降级为普通发送
      console.log(`[FeishuChannel:${this.instanceConfig.id}] Falling back to regular send due to error`);
      await this.sendMessage(chatId, collectedContent, collectedFiles);
    }
  }
}
