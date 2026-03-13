// src/channels/initializer.ts

import { getChannelRegistry } from './registry.js';
import type { ChannelRegistry } from './registry.js';
import { HTTPWSChannel } from './http-ws/channel.js';
import { FeishuChannel } from './feishu/channel.js';
import { SlackChannel } from './slack/index.js';
import { WhatsAppChannel } from './whatsapp/index.js';
import { DingTalkChannel } from './dingtalk/index.js';
import { WeComChannel } from './wecom/index.js';
import { WeChatChannel } from './wechat/index.js';
import { SessionManager } from '../session/manager.js';
import { MemoryManager } from '../memory/manager.js';
import type { ToolRegistry } from '../agents/tools/registry.js';
import { getConfig, saveConfig } from '../config/loader.js';
import type { CronService } from '../cron/service.js';
import type { TunnelManager } from '../tunnel/index.js';
import type { SkillsLoader } from '../agents/skills/loader.js';
import type { PluginLoader } from '../plugins/loader.js';
import type { GlobalErrorHandler } from '../reliability/global-error-handler.js';
import type { ChannelMessage, ChannelContext } from './channel.interface.js';
import type { FeishuInstanceConfig, FeishuConfig } from '../config/schema.js';
import path from 'node:path';

// 存储初始化依赖，用于后续热加载
export interface ChannelDependencies {
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;
  skillsLoader: SkillsLoader;
  pluginLoader: PluginLoader | undefined;
  onMessage: (message: ChannelMessage, context?: ChannelContext) => Promise<void>;
  memoryManager?: MemoryManager;
  cronService?: CronService;
  tunnelManager?: TunnelManager;
  errorHandler?: GlobalErrorHandler;
  maxMessages?: number;
}

let channelDeps: ChannelDependencies | null = null;

/**
 * 将旧版 channels.feishu 配置转换为 FeishuInstanceConfig 格式
 */
function convertLegacyFeishuConfig(feishuConfig: FeishuConfig): FeishuInstanceConfig {
  return {
    id: 'default',
    enabled: feishuConfig.enabled ?? true,
    appId: feishuConfig.appId ?? '',
    appSecret: feishuConfig.appSecret ?? '',
    verificationToken: feishuConfig.verificationToken,
    encryptKey: feishuConfig.encryptKey,
    domain: feishuConfig.domain ?? 'feishu',
    connectionMode: feishuConfig.connectionMode ?? 'websocket',
    workingDirectory: undefined,
    profile: 'default',
    team: undefined,
    streaming: feishuConfig.streaming ?? { enabled: true, updateInterval: 500, showThinking: true },
    permissions: feishuConfig.permissions ?? {
      im: { enabled: true, requireUAT: true },
      doc: { enabled: true, requireUAT: true },
      bitable: { enabled: true, requireUAT: false },
      task: { enabled: true, requireUAT: false },
      calendar: { enabled: true, requireUAT: true },
    },
    oauth: feishuConfig.oauth ?? { enabled: true, deviceCodeTTL: 300, pollInterval: 3000, maxPollAttempts: 60 },
    debug: feishuConfig.debug ?? false,
  };
}

/**
 * 初始化单个飞书实例，创建独立的 SessionManager 和 MemoryManager
 */
async function initFeishuInstance(
  instance: FeishuInstanceConfig,
  deps: ChannelDependencies,
  registry: ChannelRegistry
): Promise<void> {
  const config = getConfig();
  const workspace = config.workspace || './data';
  const maxMessages = deps.maxMessages ?? config.session?.maxMessages ?? 100;

  const sessionManager = new SessionManager(
    maxMessages,
    instance.workingDirectory
      ? path.join(instance.workingDirectory, 'sessions')
      : undefined
  );

  const memoryManager = instance.workingDirectory
    ? new MemoryManager(path.join(instance.workingDirectory, 'memory'))
    : deps.memoryManager;

  const channel = new FeishuChannel(
    instance,
    sessionManager,
    deps.onMessage,
    memoryManager
  );

  // 注册工具层实例（Task 6 实现，此处提前调用以在 Task 6 完成后自动生效）
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientModule = await import('../agents/tools/feishu/client.js') as any;
    if (typeof clientModule.registerFeishuInstance === 'function') {
      clientModule.registerFeishuInstance(instance.id, instance);
    }
  } catch {
    // Task 6 尚未实现时静默忽略
  }

  // 如果同名渠道已注册（旧版 default），先注销再注册（支持覆盖）
  if (registry.get(channel.name)) {
    registry.unregister(channel.name);
  }

  registry.register(channel);
  console.log(`[Initializer] Feishu instance registered: ${instance.id}`);
}

export async function initializeChannels(
  sessionManager: SessionManager,
  toolRegistry: ToolRegistry,
  skillsLoader: SkillsLoader,
  pluginLoader: PluginLoader | undefined,
  onMessage: (message: ChannelMessage, context?: ChannelContext) => Promise<void>,
  memoryManager?: MemoryManager,
  cronService?: CronService,
  tunnelManager?: TunnelManager,
  errorHandler?: GlobalErrorHandler
): Promise<void> {
  // 存储依赖用于后续热加载
  channelDeps = {
    sessionManager,
    toolRegistry,
    skillsLoader,
    pluginLoader,
    onMessage,
    memoryManager,
    cronService,
    tunnelManager,
    errorHandler
  };

  const config = getConfig();
  const registry = getChannelRegistry();

  // Initialize HTTP/WS channel
  if (config.channels?.httpWs?.enabled !== false) {
    const httpWsChannel = new HTTPWSChannel(
      sessionManager,
      toolRegistry,
      skillsLoader,
      pluginLoader,
      onMessage,
      memoryManager,
      cronService,
      tunnelManager,
      errorHandler
    );
    registry.register(httpWsChannel);
  }

  // 飞书多实例初始化
  const feishuInstances = config.feishuInstances ?? [];
  const hasNewInstances = feishuInstances.length > 0;

  // 兼容旧配置：channels.feishu -> 自动转换为 id="default" 的实例
  // 但如果已有新的 feishuInstances 配置，说明用户已完成迁移，跳过 legacy 以避免产生多余的 default 实例
  if (config.channels?.feishu?.enabled && !hasNewInstances) {
    const legacyInstance = convertLegacyFeishuConfig(config.channels.feishu);
    await initFeishuInstance(legacyInstance, channelDeps, registry);
    console.log('[Initializer] Legacy feishu config converted to feishu:default');
  } else if (config.channels?.feishu?.enabled && hasNewInstances) {
    console.log('[Initializer] Skipping legacy channels.feishu — feishuInstances[] is active. Consider removing channels.feishu from config.');
  }

  // 新配置：feishuInstances[]
  for (const instance of feishuInstances) {
    if (!instance.enabled) continue;
    await initFeishuInstance(instance, channelDeps, registry);
  }

  // Initialize Slack channel
  if (config.channels?.slack?.enabled) {
    const slackChannel = new SlackChannel();
    slackChannel.onMessage(async (message) => {
      await onMessage(message);
    });
    registry.register(slackChannel);
  }

  // Initialize WhatsApp channel
  if (config.channels?.whatsapp?.enabled) {
    const whatsappChannel = new WhatsAppChannel({ enabled: true });
    whatsappChannel.onMessage(async (message) => {
      await onMessage(message);
    });
    registry.register(whatsappChannel);
  }

  // Initialize DingTalk channel
  if (config.channels?.dingtalk?.enabled) {
    const dingtalkChannel = new DingTalkChannel({ enabled: true });
    dingtalkChannel.onMessage(async (message) => {
      await onMessage(message);
    });
    registry.register(dingtalkChannel);
  }

  // Initialize WeCom channel
  if (config.channels?.wecom?.enabled) {
    const wecomChannel = new WeComChannel({ enabled: true });
    wecomChannel.onMessage(async (message) => {
      await onMessage(message);
    });
    registry.register(wecomChannel);
  }

  // Initialize WeChat channel
  if (config.channels?.wechat?.enabled) {
    const wechatChannel = new WeChatChannel({ enabled: true });
    wechatChannel.onMessage(async (message) => {
      await onMessage(message);
    });
    registry.register(wechatChannel);
  }

  console.log(`[Channels] Initialized ${registry.getAll().length} channels`);
}

export async function startChannels(): Promise<void> {
  const registry = getChannelRegistry();
  const allChannels = registry.getAll();
  const enabledChannels = registry.getEnabled();

  console.log(`[Channels] Total registered channels: ${allChannels.length}`);
  for (const ch of allChannels) {
    console.log(`[Channels]   - ${ch.name} (platform: ${ch.platform}, enabled: ${ch.enabled})`);
  }
  console.log(`[Channels] Starting ${enabledChannels.length} enabled channel(s)...`);

  for (const channel of enabledChannels) {
    try {
      console.log(`[Channels] Starting channel: ${channel.name}...`);
      await channel.start();
      console.log(`[Channels] Started channel: ${channel.name}`);
    } catch (error) {
      console.error(`[Channels] Failed to start channel ${channel.name}:`, error);
    }
  }
}

export async function stopChannels(): Promise<void> {
  const registry = getChannelRegistry();
  const allChannels = registry.getAll();

  for (const channel of allChannels) {
    try {
      await channel.stop();
      console.log(`[Channels] Stopped channel: ${channel.name}`);
    } catch (error) {
      console.error(`[Channels] Failed to stop channel ${channel.name}:`, error);
    }
  }
}

/**
 * 动态启动一个频道（热加载）
 * @param channelId 频道 ID（如 'feishu', 'feishu:mybot', 'slack' 等）
 * @returns 是否成功启动
 */
export async function hotStartChannel(channelId: string): Promise<{ success: boolean; message: string }> {
  if (!channelDeps) {
    return { success: false, message: 'Channel dependencies not initialized' };
  }

  const registry = getChannelRegistry();
  const config = getConfig();

  try {
    let channel;

    if (channelId === 'feishu' || channelId.startsWith('feishu:')) {
      // 解析实例 ID
      const instanceId = channelId.includes(':') ? channelId.split(':')[1] : 'default';
      const channelName = `feishu:${instanceId}`;

      // 检查是否已经注册
      if (registry.get(channelName)) {
        return { success: false, message: `Channel ${channelName} is already running` };
      }

      // 从 feishuInstances 中查找对应配置
      const instanceConfig = config.feishuInstances?.find(i => i.id === instanceId);
      if (instanceConfig) {
        await initFeishuInstance(instanceConfig, channelDeps, registry);
        channel = registry.get(channelName);
      } else if (instanceId === 'default' && config.channels?.feishu) {
        // 回退到旧版 channels.feishu 配置
        const legacyInstance = convertLegacyFeishuConfig(config.channels.feishu);
        await initFeishuInstance(legacyInstance, channelDeps, registry);
        channel = registry.get(channelName);
      } else {
        return { success: false, message: `Feishu instance config not found for id: ${instanceId}` };
      }

      if (!channel) {
        return { success: false, message: `Failed to create feishu channel: ${channelName}` };
      }

      await channel.start();
      console.log(`[Channels] Hot-started channel: ${channelName}`);

      // 持久化配置（使实例在重启后自动启动）
      const existingInstance = (config.feishuInstances ?? []).find((i) => i.id === instanceId);
      if (existingInstance) {
        existingInstance.enabled = true;
      } else if (instanceId === 'default' && config.channels?.feishu) {
        (config.channels.feishu as { enabled?: boolean }).enabled = true;
      }
      saveConfig(config);

      return { success: true, message: `Channel ${channelName} started successfully` };

    } else {
      // 非飞书渠道：检查是否已注册
      const existingChannel = registry.getByPlatform(channelId);
      if (existingChannel) {
        return { success: false, message: `Channel ${channelId} is already running` };
      }

      switch (channelId) {
        case 'slack':
          channel = new SlackChannel();
          channel.onMessage(async (message) => {
            await channelDeps!.onMessage(message);
          });
          break;

        case 'whatsapp':
          channel = new WhatsAppChannel({ enabled: true });
          channel.onMessage(async (message) => {
            await channelDeps!.onMessage(message);
          });
          break;

        case 'dingtalk':
          channel = new DingTalkChannel({ enabled: true });
          channel.onMessage(async (message) => {
            await channelDeps!.onMessage(message);
          });
          break;

        case 'wecom':
          channel = new WeComChannel({ enabled: true });
          channel.onMessage(async (message) => {
            await channelDeps!.onMessage(message);
          });
          break;

        case 'wechat':
          channel = new WeChatChannel({ enabled: true });
          channel.onMessage(async (message) => {
            await channelDeps!.onMessage(message);
          });
          break;

        case 'httpWs':
          return { success: false, message: 'httpWs channel cannot be hot-reloaded' };

        default:
          return { success: false, message: `Unknown channel: ${channelId}` };
      }

      // 注册并启动
      registry.register(channel);
      await channel.start();

      // 更新配置文件
      if (!config.channels) {
        config.channels = {};
      }
      if (!config.channels[channelId as keyof typeof config.channels]) {
        (config.channels as Record<string, unknown>)[channelId] = {};
      }
      (config.channels as Record<string, { enabled?: boolean }>)[channelId].enabled = true;
      saveConfig(config);

      console.log(`[Channels] Hot-started channel: ${channelId}`);
      return { success: true, message: `Channel ${channelId} started successfully` };
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Channels] Failed to hot-start channel ${channelId}:`, error);
    return { success: false, message: `Failed to start channel: ${errorMsg}` };
  }
}

/**
 * 动态停止一个频道（热卸载）
 * @param channelId 频道 ID（支持 'feishu', 'feishu:instanceId', 'slack' 等）
 * @returns 是否成功停止
 */
export async function hotStopChannel(channelId: string): Promise<{ success: boolean; message: string }> {
  const registry = getChannelRegistry();

  // httpWs 不允许热停止
  if (channelId === 'httpWs') {
    return { success: false, message: 'httpWs channel cannot be stopped' };
  }

  // 支持 'feishu' 或 'feishu:instanceId' 格式
  let channel;
  if (channelId === 'feishu' || channelId.startsWith('feishu:')) {
    const channelName = channelId.includes(':') ? channelId : `feishu:default`;
    channel = registry.get(channelName);
  } else {
    channel = registry.get(channelId) ?? registry.getByPlatform(channelId);
  }

  if (!channel) {
    return { success: false, message: `Channel ${channelId} is not running` };
  }

  try {
    // 停止并注销
    await channel.stop();
    registry.unregister(channel.name);

    // 清理工具层飞书实例（Task 6 实现，此处提前调用以在 Task 6 完成后自动生效）
    if (channel.name.startsWith('feishu:')) {
      const instanceId = channel.name.split(':')[1];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientModule = await import('../agents/tools/feishu/client.js') as any;
        if (typeof clientModule.unregisterFeishuInstance === 'function') {
          clientModule.unregisterFeishuInstance(instanceId);
        }
      } catch {
        // Task 6 尚未实现时静默忽略
      }
    }

    // 更新配置文件（仅限旧版 channels.feishu 格式）
    const config = getConfig();
    if (!channelId.startsWith('feishu')) {
      if (config.channels?.[channelId as keyof typeof config.channels]) {
        (config.channels as Record<string, { enabled?: boolean }>)[channelId].enabled = false;
        saveConfig(config);
      }
    }

    console.log(`[Channels] Hot-stopped channel: ${channel.name}`);
    return { success: true, message: `Channel ${channel.name} stopped successfully` };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Channels] Failed to hot-stop channel ${channelId}:`, error);
    return { success: false, message: `Failed to stop channel: ${errorMsg}` };
  }
}
