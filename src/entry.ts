// src/entry.ts

// 加载 .env 环境变量文件
import dotenv from 'dotenv';
dotenv.config();

import { loadConfig, getConfig } from './config/loader.js';
import {
  initializeChannels,
  startChannels,
  stopChannels,
  getChannelRegistry
} from './channels/index.js';
import type { ChannelContext } from './channels/channel.interface.js';
import { AutoReply } from './auto-reply/index.js';
import { SessionManager } from './session/manager.js';
import { MemoryManager } from './memory/manager.js';
import { StorageManager, setStorageManager } from './storage/manager.js';
import { LocalStorage } from './storage/local-storage.js';
import { NasStorage } from './storage/nas-storage.js';
import { SmbStorage } from './storage/smb-storage.js';
import type { StorageConfig } from './storage/storage.interface.js';
import { nasTools } from './agents/tools/nas-tools.js';
import { ToolRegistry } from './agents/tools/registry.js';
import { UnifiedAgentRunner, type IAgentRunner } from './agents/unified-runner.js';
import { SkillsLoader } from './agents/skills/loader.js';
import { setSkillsLoader } from './agents/tools/read-skill.js';
import { refreshSkillsPrompt } from './agents/llm-client.js';
import { CronService } from './cron/service.js';
import { CronExecutor } from './cron/executor.js';
import { createCronManageTool } from './agents/tools/cron-manage.js';
import { TunnelManager } from './tunnel/index.js';
import { PluginLoader, setGlobalPluginLoader } from './plugins/loader.js';
// 错误处理组件导入
import { GlobalErrorHandler } from './reliability/global-error-handler.js';
import { CircuitBreaker } from './reliability/circuit-breaker.js';
import { ErrorClassifier } from './reliability/error-classifier.js';
import { RetryManager } from './reliability/retry-manager.js';
// import { RetryService } from './reliability/retry-service.js';
// import { ErrorMetrics } from './reliability/error-metrics.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLogInterceptor } from './utils/log-interceptor.js';
import { getHooksLoader } from './hooks/loader.js';
import { registerSelfImprovingHooks, ensureLearningsDir } from './hooks/self-improving.js';
import { startProxy, stopProxy } from './agents/openai-proxy.js';

export async function main(): Promise<void> {
  console.log('[MantisBot] Starting...');

  // 启动 OpenAI 兼容代理（用于将 Claude SDK 请求转发到 OpenAI 兼容后端）
  await startProxy();

  // Load config
  loadConfig();
  const config = getConfig();
  console.log('[MantisBot] Config loaded');

  // Initialize reliability and error handling components
  let globalErrorHandler: GlobalErrorHandler | undefined;
  let circuitBreaker: CircuitBreaker | undefined;
  let errorClassifier: ErrorClassifier | undefined;
  let retryManager: RetryManager | undefined;

  if (config.reliability?.enabled) {
    console.log('[MantisBot] Initializing error handling components...');

    // Initialize error classifier
    errorClassifier = new ErrorClassifier();

    // Initialize circuit breaker service
    if (config.reliability.circuitBreaker?.enabled) {
      circuitBreaker = new CircuitBreaker({
        failureThreshold: config.reliability.circuitBreaker.failureThreshold || 5,
        resetTimeoutMs: config.reliability.circuitBreaker.resetTimeoutMs || 60000,
        // 移除不支持的配置项
      });
    }

    // Initialize retry manager
    if (config.reliability.retry?.enabled) {
      retryManager = new RetryManager();
    }

    // Initialize global error handler
    if (errorClassifier && circuitBreaker && retryManager) {
      globalErrorHandler = new GlobalErrorHandler(
        errorClassifier,
        circuitBreaker,
        retryManager,
        {
          retryEnabled: config.reliability.retry?.enabled || true,
          circuitBreakerEnabled: config.reliability.circuitBreaker?.enabled || true,
          reportingEnabled: config.reliability.errorReporting?.enabled || true,
        }
      );
    }

    console.log('[MantisBot] Error handling components initialized');
  }

  // Initialize components
  const workspace = config.workspace || './data';
  const maxMessages = config.session?.maxMessages ?? 100;
  const sessionManager = new SessionManager(maxMessages, workspace);
  const toolRegistry = new ToolRegistry({
    enabledPlugins: config.plugins.map(p => p.name),
    firecrawlApiKey: config.firecrawlApiKey
  });
  const memoryManager = new MemoryManager(workspace);

  // Initialize Storage Manager
  if (config.storage?.providers?.length) {
    console.log('[MantisBot] Initializing storage system...');

    const storageManager = new StorageManager(config.storage);

    // Register storage providers
    for (const providerConfig of config.storage.providers) {
      try {
        let storage;
        if (providerConfig.type === 'local') {
          storage = new LocalStorage(providerConfig as StorageConfig);
        } else if (providerConfig.type === 'nas') {
          if ((providerConfig as StorageConfig).protocol === 'smb') {
            storage = new SmbStorage(providerConfig as StorageConfig);
          } else {
            storage = new NasStorage(providerConfig as StorageConfig);
          }
        } else {
          console.warn(`[MantisBot] Unknown storage type: ${providerConfig.type}`);
          continue;
        }

        storageManager.registerStorage(providerConfig.id, storage);
        console.log(`[MantisBot] Registered ${providerConfig.type}/${(providerConfig as StorageConfig).protocol || 'local'} storage: ${providerConfig.name}`);
      } catch (error) {
        console.error(`[MantisBot] Failed to initialize storage ${providerConfig.id}:`, error);
      }
    }

    // Initialize the storage manager
    try {
      await storageManager.initialize();
      setStorageManager(storageManager);
      console.log(`[MantisBot] Storage system initialized with ${storageManager.listStorages().length} providers`);
    } catch (error) {
      console.error('[MantisBot] Failed to initialize storage system:', error);
    }
  } else {
    console.log('[MantisBot] No storage providers configured, using local filesystem only');
  }

  // Load skills
  const skillsLoader = new SkillsLoader();
  await skillsLoader.load();
  console.log(`[MantisBot] Loaded ${skillsLoader.list().length} skills`);

  // Load plugins
  let pluginLoader: PluginLoader | undefined;
  try {
    pluginLoader = new PluginLoader('./plugins', config.disabledPlugins || []);
    await pluginLoader.loadAll();
    console.log(`[MantisBot] Loaded ${pluginLoader.getAllPlugins().length} plugins`);
    console.log(`[MantisBot] Loaded ${pluginLoader.getSkills().length} plugin skills`);
    // 设置全局 PluginLoader 引用（供 toggle 后刷新 skills prompt 使用）
    setGlobalPluginLoader(pluginLoader);
  } catch (error) {
    console.warn('[MantisBot] Plugin loading failed, continuing without plugins:', error);
  }

  // Set skills loader for read_skill tool (必须在 refreshSkillsPrompt 之前)
  setSkillsLoader(skillsLoader);

  // Set skills prompt for LLM (include plugin skills)
  // 使用 refreshSkillsPrompt 统一处理 standalone 和 plugin skills
  refreshSkillsPrompt();
  console.log(`[MantisBot] Skills prompt refreshed (${pluginLoader?.getSkills().length || 0} plugin skills)`);

  // Initialize self-improving hooks (错误检测 & 学习提醒)
  await ensureLearningsDir();
  const hooksLoader = getHooksLoader();
  registerSelfImprovingHooks((event, handler) => {
    hooksLoader.register(event, handler);
  });
  console.log('[MantisBot] Self-improving hooks registered');

  // Create UnifiedAgentRunner (shared by AutoReply and CronExecutor)
  const agentRunner = new UnifiedAgentRunner(toolRegistry, {
    maxIterations: 50,
    skillsLoader,
  });

  // Initialize CronService
  console.log('[Entry] Initializing CronService...');
  const cronExecutor = new CronExecutor({
    channelRegistry: getChannelRegistry(),
    sessionManager,
    toolRegistry,
    skillsLoader,
    defaultModel: config.defaultModel || config.models[0]?.name,
  });

  const cronService = new CronService({
    storePath: path.join(workspace, 'cron', 'jobs.json'),
    executor: cronExecutor,
    workspace
  });

  await cronService.start();
  console.log('[Entry] CronService started');

  // 启动会话 TTL 定期清理（每 6 小时检查一次）
  const ttlDays = config.session?.ttlDays ?? 30;
  if (ttlDays > 0) {
    const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
    // 启动时立即执行一次
    sessionManager.archiveInactiveSessions(ttlDays);
    // 后续定期执行
    setInterval(() => {
      sessionManager.archiveInactiveSessions(ttlDays);
    }, SESSION_CLEANUP_INTERVAL_MS);
    console.log(`[Entry] Session TTL cleanup started (TTL=${ttlDays} 天，每 6 小时检查一次)`);
  }

  // Register cron_manage tool
  toolRegistry.registerTool(createCronManageTool(cronService));

  // Register NAS tools
  for (const nasTool of nasTools) {
    toolRegistry.registerTool(nasTool);
  }
  console.log(`[MantisBot] Registered ${nasTools.length} NAS tools`);

  // Initialize auto-reply (with shared AgentRunner and PluginLoader)
  const autoReply = new AutoReply(toolRegistry, sessionManager, memoryManager, agentRunner, pluginLoader);

  // Initialize tunnel services (内网穿透)
  let tunnelManager: TunnelManager | undefined;
  if (config.server.tunnel?.enabled) {
    console.log('[Entry] Initializing tunnel services...');
    tunnelManager = new TunnelManager(config.server.tunnel);
    await tunnelManager.startAll();
    console.log('[Entry] Tunnel services initialized');
  }

  // Initialize channels (with cronService and errorHandler)
  await initializeChannels(
    sessionManager,
    toolRegistry,
    skillsLoader,
    pluginLoader,
    async (message, context?: ChannelContext) => {
      // 优先用 message.channel 精确路由，回退到 getByPlatform
      const channel = message.channel
        ? getChannelRegistry().get(message.channel)
        : getChannelRegistry().getByPlatform(message.platform);

      if (!channel) {
        return;
      }

      // 检查是否支持流式输出
      const supportsStreaming = typeof (channel as any).sendWithStream === 'function';

      if (supportsStreaming) {
        // 使用流式输出
        console.log(`[Entry] Using streaming for platform: ${message.platform}`);
        try {
          const generator = autoReply.handleMessageStream(message.content, {
            platform: context?.platform ?? message.platform,
            chatId: context?.chatId ?? message.chatId,
            userId: context?.userId ?? message.userId ?? '',
            attachments: context?.attachments ?? message.attachments,
            // 传递多实例相关的额外字段（Task 7 会完善 handleMessageStream 对这些字段的处理）
            ...(context && {
              agentProfile: context.agentProfile,
              agentTeam: context.agentTeam,
              workingDirectory: context.workingDirectory,
              feishuInstanceId: context.feishuInstanceId,
              channel: context.channel,
            }),
          } as any);

          // 调用 channel 的流式发送方法
          for await (const _ of (channel as any).sendWithStream(
            message.chatId,
            generator,
            message.userId
          )) {
            // 消费 generator
          }
        } catch (streamError) {
          console.error('[Entry] Streaming failed, falling back to regular send:', streamError);
          // 流式失败，降级到普通发送
          const result = await autoReply.handleMessage(message.content, {
            platform: message.platform,
            chatId: message.chatId,
            userId: message.userId || ''
          });
          if (result) {
            await channel.sendMessage(message.chatId, result.response, result.files);
          }
        }
      } else {
        // 不支持流式，使用普通发送
        const result = await autoReply.handleMessage(message.content, {
          platform: message.platform,
          chatId: message.chatId,
          userId: message.userId || ''
        });

        if (result) {
          await channel.sendMessage(
            message.chatId,
            result.response,
            result.files
          );
        }
      }
    },
    memoryManager,
    cronService,
    tunnelManager,
    globalErrorHandler
  );

  // Start channels
  await startChannels();

  // Register plugin tools (启动时一次性注册)
  if (pluginLoader) {
    try {
      await pluginLoader.registerPluginTools(toolRegistry, config);
      console.log('[MantisBot] Plugin tools registered');
    } catch (error) {
      console.error('[MantisBot] Failed to register plugin tools:', error);
    }
  }

  // 在 WebSocket 服务器启动后安装日志拦截器，将后续 console 输出实时推送到前端
  installLogInterceptor();

  console.log('[MantisBot] Started successfully');

  // Setup shutdown handlers
  process.on('SIGINT', async () => {
    console.log('[MantisBot] Shutting down...');
    sessionManager.flushSync();
    cronService.stop();
    if (tunnelManager) {
      await tunnelManager.stopAll();
    }
    await stopChannels();
    await stopProxy();
    // Clean up error handling components (if needed)
    if (globalErrorHandler) {
      // globalErrorHandler.destroy(); // Not implemented yet
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[MantisBot] Shutting down...');
    sessionManager.flushSync();
    cronService.stop();
    if (tunnelManager) {
      await tunnelManager.stopAll();
    }
    await stopChannels();
    await stopProxy();
    // Clean up error handling components (if needed)
    if (globalErrorHandler) {
      // globalErrorHandler.destroy(); // Not implemented yet
    }
    process.exit(0);
  });
}

// Run if called directly
const __filename = fileURLToPath(import.meta.url);
if (path.resolve(__filename) === path.resolve(process.argv[1])) {
  main().catch(console.error);
}
