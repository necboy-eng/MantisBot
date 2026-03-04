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
import { AutoReply } from './auto-reply/index.js';
import { SessionManager } from './session/manager.js';
import { MemoryManager } from './memory/manager.js';
import { StorageManager, setStorageManager } from './storage/manager.js';
import { LocalStorage } from './storage/local-storage.js';
import { NasStorage } from './storage/nas-storage.js';
import { nasTools } from './agents/tools/nas-tools.js';
import { ToolRegistry } from './agents/tools/registry.js';
import { UnifiedAgentRunner, type IAgentRunner } from './agents/unified-runner.js';
import { SkillsLoader } from './agents/skills/loader.js';
import { setSkillsLoader } from './agents/tools/read-skill.js';
import { setSkillsPrompt } from './agents/llm-client.js';
import { CronService } from './cron/service.js';
import { CronExecutor } from './cron/executor.js';
import { createCronManageTool } from './agents/tools/cron-manage.js';
import { TunnelManager } from './tunnel/index.js';
import { PluginLoader } from './plugins/loader.js';
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

export async function main(): Promise<void> {
  console.log('[MantisBot] Starting...');

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
          storage = new LocalStorage(providerConfig);
        } else if (providerConfig.type === 'nas') {
          storage = new NasStorage(providerConfig);
        } else {
          console.warn(`[MantisBot] Unknown storage type: ${providerConfig.type}`);
          continue;
        }

        storageManager.registerStorage(providerConfig.id, storage);
        console.log(`[MantisBot] Registered ${providerConfig.type} storage: ${providerConfig.name}`);
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
    pluginLoader = new PluginLoader('./plugins');
    await pluginLoader.loadAll();
    console.log(`[MantisBot] Loaded ${pluginLoader.getAllPlugins().length} plugins`);
    console.log(`[MantisBot] Loaded ${pluginLoader.getSkills().length} plugin skills`);
  } catch (error) {
    console.warn('[MantisBot] Plugin loading failed, continuing without plugins:', error);
  }

  // Set skills prompt for LLM (include plugin skills)
  // 默认禁用所有 skills，只有在 enabledSkills 中列出的才会启用
  const enabledSkills = config.enabledSkills || [];
  const standaloneSkillsPrompt = skillsLoader.getPromptContent(enabledSkills);
  const pluginSkillsPrompt = pluginLoader?.getSkills().map(s => s.content).join('\n\n') || '';
  const combinedSkillsPrompt = standaloneSkillsPrompt + (pluginSkillsPrompt ? '\n\n' + pluginSkillsPrompt : '');
  setSkillsPrompt(combinedSkillsPrompt);
  console.log(`[MantisBot] Skills prompt length: ${combinedSkillsPrompt.length} chars`);

  // Set skills loader for read_skill tool
  setSkillsLoader(skillsLoader);

  // Initialize self-improving hooks (错误检测 & 学习提醒)
  await ensureLearningsDir();
  const hooksLoader = getHooksLoader();
  registerSelfImprovingHooks((event, handler) => {
    hooksLoader.register(event, handler);
  });
  console.log('[MantisBot] Self-improving hooks registered');

  // Create UnifiedAgentRunner (shared by AutoReply and CronExecutor)
  // 使用统一入口，根据模型类型自动选择 ClaudeAgentRunner 或 OpenAICompatRunner
  // 注意：pluginSkillsPrompt 已在上面定义，用于同时传递给 LLMClient 和 ClaudeAgentRunner
  const agentRunner = new UnifiedAgentRunner(toolRegistry, {
    maxIterations: 50,           // 保留迭代上限（防止无限循环）
    skillsLoader,                // 传递 skillsLoader 以支持 Skills
    pluginSkillsPrompt,          // 传递 plugin skills 提示词
  });

  // Initialize CronService
  console.log('[Entry] Initializing CronService...');
  const cronExecutor = new CronExecutor({
    channelRegistry: getChannelRegistry(),
    sessionManager,
    toolRegistry,
    skillsLoader,
    pluginSkillsPrompt,
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

  // Initialize auto-reply (with shared AgentRunner)
  const autoReply = new AutoReply(toolRegistry, sessionManager, memoryManager, agentRunner);

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
    async (message) => {
      const result = await autoReply.handleMessage(message.content, {
        platform: message.platform,
        chatId: message.chatId,
        userId: message.userId || ''
      });

      if (result) {
        const channel = getChannelRegistry().getByPlatform(message.platform);
        if (channel) {
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
