import type { ChannelRegistry } from '../channels/registry.js';
import type { SessionManager } from '../session/manager.js';
import type { CronJob } from './service.js';
import type { FileAttachment } from '../types.js';
import type { ToolRegistry } from '../agents/tools/registry.js';
import type { SkillsLoader } from '../agents/skills/loader.js';
import type { IChannel } from '../channels/channel.interface.js';
import { UnifiedAgentRunner } from '../agents/unified-runner.js';

export interface CronExecutorDeps {
  channelRegistry: ChannelRegistry;
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;
  skillsLoader: SkillsLoader;
  defaultModel?: string;
}

export class CronExecutor {
  constructor(private deps: CronExecutorDeps) {}

  /**
   * 执行任务 payload
   */
  async executePayload(job: CronJob): Promise<void> {
    const { payload, delivery } = job;

    try {
      if (payload.kind === 'systemEvent') {
        const sessionId = this.getOrCreateSession(job);
        this.deps.sessionManager.addMessage(sessionId, {
          role: 'assistant',
          content: payload.text
        });
        await this.deliverMessage(payload.text, delivery);
      } else if (payload.kind === 'agentTurn') {
        const sessionId = this.getOrCreateSession(job);

        const enabledSkills = payload.skills ?? [];
        console.log(`[CronExecutor] Job ${job.id}: model=${payload.model || this.deps.defaultModel}, skills=${enabledSkills.join(',') || 'none'}`);

        // 为每次执行创建独立 runner，使用任务指定的模型
        const runner = new UnifiedAgentRunner(this.deps.toolRegistry, {
          model: payload.model || this.deps.defaultModel,
          maxIterations: 50,
          skillsLoader: this.deps.skillsLoader,
          enabledSkills,
        });

        const response = await runner.run(payload.message, []);
        console.log(`[CronExecutor] Agent response received, length: ${response.response?.length || 0}`);

        if (delivery && delivery.mode !== 'none' && response.response) {
          this.deps.sessionManager.addMessage(sessionId, {
            role: 'assistant',
            content: response.response,
            attachments: response.attachments
          });
          await this.deliverMessage(response.response, delivery, sessionId, response.attachments);
        }

        runner.dispose?.();
      }
    } catch (error) {
      console.error(`[CronExecutor] Job ${job.id} execution failed:`, error);
      throw error;
    }
  }

  /**
   * 投递消息到渠道
   */
  private async deliverMessage(
    message: string,
    delivery?: CronJob['delivery'],
    sessionIdForDelivery?: string,
    attachments?: FileAttachment[]
  ): Promise<void> {
    if (!delivery || delivery.mode === 'none') return;

    try {
      const channelName = this.resolveChannelName(delivery.channel);
      const channel = this.findChannel(channelName);

      if (!channel) {
        console.warn(`[CronExecutor] Channel not found: ${channelName}`);
        if (!delivery.bestEffort) {
          throw new Error(`Channel not found: ${channelName}`);
        }
        return;
      }

      const chatId = sessionIdForDelivery || await this.resolveChatId(channelName, delivery.to);
      console.log(`[CronExecutor] Delivering to channel ${channelName}, chatId: ${chatId}`);
      await channel.sendMessage(chatId, message, attachments);
    } catch (error) {
      console.error('[CronExecutor] Message delivery failed:', error);
      if (!delivery.bestEffort) {
        throw error;
      }
    }
  }

  /**
   * 将 delivery.channel 字段规范化为渠道名称。
   * 支持：
   *   - 精确实例名：'feishu:hr-bot'、'feishu:default' 等
   *   - 平台名（向后兼容）：'feishu'、'web' 等
   */
  private resolveChannelName(channel?: string | 'last'): string {
    if (!channel || channel === 'last') return 'web';
    return channel;
  }

  /**
   * 根据渠道名称在 registry 中查找渠道实例。
   * 优先精确匹配（支持 'feishu:hr-bot' 格式），
   * 找不到时回退到平台名匹配（向后兼容 'feishu' 格式）。
   */
  private findChannel(channelName: string): IChannel | null {
    // 1. 精确名称匹配：支持 'feishu:hr-bot' 等实例级路由
    const exact = this.deps.channelRegistry.get(channelName);
    if (exact) return exact;

    // 2. 回退到平台名匹配：向后兼容 delivery.channel='feishu' 旧格式
    const byPlatform = this.deps.channelRegistry.getByPlatform(channelName);
    if (byPlatform) {
      const allChannels = this.deps.channelRegistry.getAllByPlatform(channelName);
      if (allChannels.length > 1) {
        console.warn(`[CronExecutor] Multiple channels for platform '${channelName}', using first: ${allChannels[0].name}. Consider using exact name like '${channelName}:xxx'.`);
      }
      return byPlatform;
    }

    return null;
  }

  private getOrCreateSession(job: CronJob): string {
    const { sessionTarget } = job;
    if (sessionTarget === 'main') return 'main';

    const sessionKey = `cron:${job.id}`;
    let session = this.deps.sessionManager.getSession(sessionKey);
    if (!session) {
      session = this.deps.sessionManager.createSession(sessionKey, 'default', job.name);
    }
    return session.id;
  }

  private async resolveChatId(_channelId: string, to?: string): Promise<string> {
    return to || 'default';
  }
}
