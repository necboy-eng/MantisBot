import type { ChannelRegistry } from '../channels/registry.js';
import type { SessionManager } from '../session/manager.js';
import type { CronJob } from './service.js';
import type { FileAttachment } from '../types.js';
import type { ToolRegistry } from '../agents/tools/registry.js';
import type { SkillsLoader } from '../agents/skills/loader.js';
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

        // 为每次执行创建独立 runner，使用任务指定的模型
        // skills 过滤在 runner 内部通过 getConfig().enabledSkills 处理
        const runner = new UnifiedAgentRunner(this.deps.toolRegistry, {
          model: payload.model || this.deps.defaultModel,
          maxIterations: 50,
          skillsLoader: this.deps.skillsLoader,
        });

        const enabledSkills = payload.skills ?? [];
        console.log(`[CronExecutor] Job ${job.id}: model=${payload.model || this.deps.defaultModel}, skills=${enabledSkills.join(',') || 'none'}`);

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
      const channelId = this.resolveChannel(delivery.channel);
      const channel = this.deps.channelRegistry.getByPlatform(channelId);

      if (!channel) {
        console.warn(`[CronExecutor] Channel not found: ${channelId}`);
        if (!delivery.bestEffort) {
          throw new Error(`Channel not found: ${channelId}`);
        }
        return;
      }

      const chatId = sessionIdForDelivery || await this.resolveChatId(channelId, delivery.to);
      console.log(`[CronExecutor] Delivering to channel ${channelId}, chatId: ${chatId}`);
      await channel.sendMessage(chatId, message, attachments);
    } catch (error) {
      console.error('[CronExecutor] Message delivery failed:', error);
      if (!delivery.bestEffort) {
        throw error;
      }
    }
  }

  private resolveChannel(channel?: string | "last"): string {
    if (!channel || channel === "last") return "web";
    return channel;
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
