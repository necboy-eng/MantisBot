// src/channels/http-ws/channel.ts

import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import type { IChannel, FileAttachment } from '../channel.interface.js';
import { createHTTPServer } from './http-server.js';
import { createWSServer, broadcastToClients, broadcastToClientsWithAttachments, closeWSServer } from './ws-server.js';
import type { SessionManager } from '../../session/manager.js';
import type { ToolRegistry } from '../../agents/tools/registry.js';
import { getConfig } from '../../config/loader.js';
import type { CronService } from '../../cron/service.js';
import type { TunnelManager } from '../../tunnel/index.js';
import type { SkillsLoader } from '../../agents/skills/loader.js';
import type { PluginLoader } from '../../plugins/loader.js';
import type { GlobalErrorHandler } from '../../reliability/global-error-handler.js';
import type { MemoryManager } from '../../memory/manager.js';

export class HTTPWSChannel implements IChannel {
  name = 'http-ws';
  platform = 'web';
  enabled = true;

  private server: ReturnType<typeof createServer> | null = null;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private skillsLoader: SkillsLoader;
  private pluginLoader?: PluginLoader;
  private onMessage: (message: any) => Promise<void>;
  private memoryManager?: MemoryManager;
  private cronService?: CronService;
  private tunnelManager?: TunnelManager;
  private errorHandler?: GlobalErrorHandler;

  constructor(
    sessionManager: SessionManager,
    toolRegistry: ToolRegistry,
    skillsLoader: SkillsLoader,
    pluginLoader: PluginLoader | undefined,
    onMessage: (message: any) => Promise<void>,
    memoryManager?: MemoryManager,
    cronService?: CronService,
    tunnelManager?: TunnelManager,
    errorHandler?: GlobalErrorHandler
  ) {
    this.sessionManager = sessionManager;
    this.toolRegistry = toolRegistry;
    this.skillsLoader = skillsLoader;
    this.pluginLoader = pluginLoader;
    this.onMessage = onMessage;
    this.memoryManager = memoryManager;
    this.cronService = cronService;
    this.tunnelManager = tunnelManager;
    this.errorHandler = errorHandler;
  }

  async start(): Promise<void> {
    const config = getConfig();

    const app = await createHTTPServer({
      sessionManager: this.sessionManager,
      toolRegistry: this.toolRegistry,
      skillsLoader: this.skillsLoader,
      pluginLoader: this.pluginLoader,
      onMessage: this.onMessage,
      memoryManager: this.memoryManager,
      cronService: this.cronService,
      tunnelManager: this.tunnelManager
    });

    this.server = createServer(app);

    // Create WebSocket server
    createWSServer(this.server, {
      onMessage: async (ws, message) => {
        const config = getConfig();

        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', payload: {} }));
            break;

          case 'chat':
          case 'chat-stream': {
            const payload = message.payload as {
              sessionId?: string;
              message: string;
              model?: string;
            };

            const sessionId = payload.sessionId || uuidv4();

            try {
              // Use onMessage callback to process through MessageDispatcher
              await this.onMessage({
                id: uuidv4(),
                content: payload.message,
                chatId: sessionId,
                userId: 'web-user',
                platform: 'web',
                timestamp: Date.now()
              });

              // Get updated session
              const session = this.sessionManager.getSession(sessionId);
              if (!session) {
                throw new Error('Session not found after processing');
              }

              // Get last assistant message
              const lastMessage = session.messages[session.messages.length - 1];
              if (!lastMessage || lastMessage.role !== 'assistant') {
                throw new Error('No assistant response found');
              }

              // Send response
              ws.send(JSON.stringify({
                type: 'chat-response',
                payload: {
                  sessionId,
                  message: {
                    id: lastMessage.id || uuidv4(),
                    role: 'assistant',
                    content: lastMessage.content,
                    timestamp: lastMessage.timestamp,
                    attachments: lastMessage.attachments
                  }
                }
              }));
            } catch (error) {
              console.error('[HTTPWSChannel] Agent error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Failed to process message' }
              }));
            }
            break;
          }

          default:
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: 'Unknown message type' }
            }));
        }
      },
      errorHandler: this.errorHandler
    });

    return new Promise((resolve) => {
      this.server!.listen(config.server.port, () => {
        console.log(`[HTTPWSChannel] Started on port ${config.server.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // 先关闭 WebSocket 服务器
    await closeWSServer();

    // 再关闭 HTTP 服务器
    return new Promise((resolve) => {
      if (this.server) {
        // 强制关闭所有现有连接（Node.js 18.2.0+）
        if (typeof this.server.closeAllConnections === 'function') {
          this.server.closeAllConnections();
        }
        this.server.close(() => {
          console.log('[HTTPWSChannel] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async sendMessage(
    chatId: string,
    message: string,
    attachments?: FileAttachment[]
  ): Promise<void> {
    // 定时任务等服务器主动推送场景：chatId 以 'cron:' 开头
    // 需要通过 WebSocket 广播给所有客户端
    if (chatId.startsWith('cron:')) {
      console.log(`[HTTPWSChannel] Broadcasting cron message to all clients for ${chatId}`);
      const formattedAttachments = attachments
        ?.filter(a => a.url)
        .map(a => ({
          name: a.name,
          url: a.url!
        }));
      broadcastToClientsWithAttachments(chatId, message, formattedAttachments);
      return;
    }

    // 普通请求-响应场景：HTTP SSE 会直接返回，无需广播
    console.log(`[HTTPWSChannel] sendMessage called for chat ${chatId} - skipping broadcast (HTTP SSE handles response)`);
  }

  isReady(): boolean {
    return this.server !== null && this.server.listening;
  }
}
