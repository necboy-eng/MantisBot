// src/auto-reply/dispatch.ts

import path from 'path';
import fs from 'fs';
import type { ChannelMessage, ChannelContext } from '../channels/channel.interface.js';
import type { FileAttachment } from '../types.js';
import type { IAgentRunner } from '../agents/unified-runner.js';
import type { StreamChunk } from '../agents/types.js';
import { SessionManager } from '../session/manager.js';
import { MemoryManager } from '../memory/manager.js';
import { truncateHistory } from '../utils/token-counter.js';
import { getConfig } from '../config/loader.js';
import { detectTeamFromMessage, findTeamByCommand } from '../agents/agent-teams.js';
import type { AgentTeam } from '../config/schema.js';
import { getHooksLoader } from '../hooks/loader.js';
import { UnifiedAgentRunner } from '../agents/unified-runner.js';
import { getFileStorage } from '../files/index.js';
import { workDirManager } from '../workdir/manager.js';
import { registerPendingImages, VISION_INJECT_ENV_KEY, type ImageBlock } from '../agents/openai-proxy.js';
import { getUserById } from '../auth/users-store.js';

// 图片最大允许大小（2MB）
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

/**
 * 检测模型是否支持视觉
 * 支持两种配置格式：
 * - 数组：capabilities: ['vision']
 * - 对象：capabilities: { vision: true }
 * - 简写：vision: true 或 supportsVision: true
 */
function modelSupportsVision(modelConfig: any): boolean {
  // 数组格式：capabilities: ['vision']
  if (Array.isArray(modelConfig?.capabilities) && modelConfig.capabilities.includes('vision')) {
    return true;
  }
  // 对象格式：capabilities: { vision: true }
  if (modelConfig?.capabilities?.vision === true) {
    return true;
  }
  // 简写格式
  return modelConfig?.vision === true || modelConfig?.supportsVision === true;
}

export interface DispatchResult {
  response: string;
  success: boolean;
  files?: FileAttachment[];
}

/**
 * 流式输出生成器类型
 */
export type StreamGenerator = AsyncGenerator<{ type: 'text' | 'done'; content?: string; files?: FileAttachment[] }>;

export class MessageDispatcher {
  private agentRunner: IAgentRunner;
  private sessionManager: SessionManager;
  private memoryManager: MemoryManager;

  constructor(
    agentRunner: IAgentRunner,
    sessionManager: SessionManager,
    memoryManager: MemoryManager
  ) {
    this.agentRunner = agentRunner;
    this.sessionManager = sessionManager;
    this.memoryManager = memoryManager;
  }

  /**
   * 解析消息中的团队触发信息，返回 { team, cleanedContent }
   *
   * 四种触发方式（按优先级）：
   * 1. 实例级指定 team（context.agentTeam 字段，来自飞书多实例配置）
   * 2. UI 显式指定 teamId（message.teamId 字段）
   * 3. /command 触发（消息以 "/xxx " 或 "/xxx\n" 开头）
   * 4. AI 自动关键词检测
   */
  private resolveTeam(message: ChannelMessage, context: ChannelContext): { team: AgentTeam | null; content: string } {
    const config = getConfig();
    const teams: AgentTeam[] = config.agentTeams || [];
    let content = message.content;

    // 1. 实例级指定 team（多实例支持）
    const instanceTeamId = context.agentTeam;
    if (instanceTeamId) {
      const team = teams.find(t => t.enabled && t.id === instanceTeamId) ?? null;
      if (team) {
        console.log(`[Dispatch] Using instance-level team: ${team.name} (id: ${instanceTeamId})`);
        return { team, content };
      }
    }

    // 2. UI 显式指定 teamId
    const explicitTeamId = (message as any).teamId as string | undefined;
    if (explicitTeamId) {
      const team = teams.find(t => t.enabled && t.id === explicitTeamId) ?? null;
      if (team) {
        console.log(`[Dispatch] Using explicitly selected team: ${team.name}`);
        return { team, content };
      }
    }

    // 3. /command 触发：以 "/xxx" 开头（后跟空格、换行或直接结束）
    const cmdMatch = content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
    if (cmdMatch) {
      const command = cmdMatch[1];
      const team = findTeamByCommand(command, teams);
      if (team) {
        content = cmdMatch[2]?.trim() ?? '';
        console.log(`[Dispatch] Team triggered by command /${command}: ${team.name}`);
        return { team, content };
      }
    }

    // 4. AI 自动关键词检测
    const detectedTeam = detectTeamFromMessage(content, teams);
    if (detectedTeam) {
      console.log(`[Dispatch] Team auto-detected from keywords: ${detectedTeam.name}`);
      return { team: detectedTeam, content };
    }

    return { team: null, content };
  }

  async dispatch(
    message: ChannelMessage,
    context: ChannelContext
  ): Promise<DispatchResult> {
    const { userId, chatId } = message;
    const sessionId = chatId;

    try {
      // Get session or create new one
      let session = this.sessionManager.getSession(sessionId);
      if (!session) {
        session = this.sessionManager.createSession(sessionId, 'default');
      }

      // 读取上下文窗口配置（maxInputChars 默认 80000 字符）
      const config = getConfig();
      const maxInputChars = config.session?.maxInputChars ?? 80000;

      // Build conversation history，并进行 token 感知截断
      const rawHistory = session.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // 截断历史，确保传入 LLM 的对话不超过预算
      const historyBudget = Math.floor(maxInputChars * 0.7);
      const truncated = truncateHistory(rawHistory, historyBudget);
      const history = truncated as Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;

      if (rawHistory.length !== truncated.length) {
        console.log(
          `[Dispatch] 会话 ${sessionId}: 历史消息从 ${rawHistory.length} 条截断到 ${truncated.length} 条` +
          `（预算 ${historyBudget} 字符）`
        );
      }

      // 解析团队触发（优先使用实例级配置，其次走命令/关键词检测）
      const { team: activeTeam, content } = this.resolveTeam(message, context);

      // dispatch() 不支持多实例 runner，effectiveRunner 始终为全局 agentRunner
      // 统一使用 effectiveRunner 变量，便于未来扩展
      const effectiveRunner = this.agentRunner;

      // 如果激活了团队，将团队信息注入 effectiveRunner（UnifiedAgentRunner 支持动态 options）
      if (typeof (effectiveRunner as any).setActiveTeam === 'function') {
        (effectiveRunner as any).setActiveTeam(activeTeam ?? null);
      }
      if (activeTeam) {
        console.log(`[Dispatch] Active team: ${activeTeam.name} (${Object.keys(activeTeam.agents).length} subagents)`);
      }

      // Search relevant memories
      console.log('[Dispatch] Searching memories for:', content.substring(0, 50));
      const memories = await this.memoryManager.searchHybrid('default', content, {
        limit: 3,        // 减少到 3 条，避免上下文污染
        minScore: 0.35,  // 提高阈值，过滤低相关度记忆
        sessionKey: undefined
      });
      console.log(`[Dispatch] Found ${memories.length} memories:`,
        memories.map(m => `${m.content.substring(0, 30)}... (score: ${m.score?.toFixed(3)})`));

      // Build prompt with memory context
      let prompt: string;
      if (memories.length > 0) {
        const memoryContext = memories.map((m, i) =>
          `${i + 1}. ${m.content}`
        ).join('\n');

        prompt = `📋 **相关记忆**（仅在记忆与用户问题直接相关时才参考）：
${memoryContext}

---

💬 **用户问题**：
${content}

`;
      } else {
        prompt = content;
      }

      // Run agent
      const result = await effectiveRunner.run(prompt, history);

      // Trigger agent.end hook for self-improving
      try {
        await getHooksLoader().emit('agent.end', {
          success: result.success,
          response: result.response,
          toolCalls: result.toolCalls,
          sessionId,
          userId,
        });
      } catch (hookError) {
        console.warn('[Dispatch] Hook error (non-blocking):', hookError);
      }

      // Add messages to session
      this.sessionManager.addMessage(sessionId, {
        role: 'user',
        content: message.content,
        metadata: {
          platform: message.platform,
          chatId: message.chatId,
          userId: message.userId,
          feishuInstanceId: context.feishuInstanceId, // 飞书实例 ID
        },
      });
      const assistantMsg = this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: result.response,
      });

      return {
        response: result.response,
        success: result.success,
        files: result.attachments,
      };
    } catch (error) {
      console.error('[Dispatch] Error:', error);
      return {
        response: `处理消息时出错: ${error}`,
        success: false,
      };
    }
  }

  /**
   * 流式分发消息（支持飞书等平台的流式输出）
   */
  async *dispatchStream(
    message: ChannelMessage,
    context: ChannelContext
  ): StreamGenerator {
    const { userId, chatId } = message;
    const sessionId = chatId;

    try {
      // Get session or create new one
      let session = this.sessionManager.getSession(sessionId);
      if (!session) {
        session = this.sessionManager.createSession(sessionId, 'default');
      }

      // 读取上下文窗口配置
      const config = getConfig();
      const maxInputChars = config.session?.maxInputChars ?? 80000;

      // Build conversation history
      const rawHistory = session.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const historyBudget = Math.floor(maxInputChars * 0.7);
      const truncated = truncateHistory(rawHistory, historyBudget);
      const history = truncated as Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;

      // 解析团队触发（优先使用实例级配置，其次走命令/关键词检测）
      const { team: activeTeam, content } = this.resolveTeam(message, context);

      if (activeTeam) {
        console.log(`[DispatchStream] Active team: ${activeTeam.name}`);
      }

      // 设置用户上下文（用于工具执行时获取用户身份，如飞书的 senderOpenId）
      const runner = this.agentRunner as any;
      if (typeof runner.setUserContext === 'function') {
        // http-ws 渠道��� roleId 已由 http-server.ts 在 streamRun 前注入，此处跳过
        // 飞书/钉钉等渠道：userId 是平台 openId，尝试通过 DB 查询 roleId
        let roleId = 'role_member';
        if (userId && message.platform !== 'http-ws') {
          try {
            const dbUser = getUserById(userId);
            if (dbUser?.roleId) roleId = dbUser.roleId;
          } catch {
            // 查询失败时降级为 role_member
          }
        }
        runner.setUserContext({ userId, roleId, platform: message.platform });
        console.log(`[DispatchStream] User context set: userId=${userId}, roleId=${roleId}, platform=${message.platform}`);
      }

      // Search relevant memories
      console.log('[DispatchStream] Searching memories for:', content.substring(0, 50));
      const memories = await this.memoryManager.searchHybrid('default', content, {
        limit: 3,        // 减少到 3 条，避免上下文污染
        minScore: 0.35,  // 提高阈值，过滤低相关度记忆
        sessionKey: undefined
      });
      console.log(`[DispatchStream] Found ${memories.length} memories:`,
        memories.map(m => `${m.content.substring(0, 30)}... (score: ${m.score?.toFixed(3)})`));

      // Build prompt with memory context
      let prompt: string;
      if (memories.length > 0) {
        const memoryContext = memories.map((m, i) =>
          `${i + 1}. ${m.content}`
        ).join('\n');

        prompt = `📋 **相关记忆**（仅在记忆与用户问题直接相关时才参考）：
${memoryContext}

---

💬 **用户问题**：
${content}

`;
      } else {
        prompt = content;
      }

      // ── 视觉路由：图片附件检测与模型切换 ─────────────────────────────────
      // 检查是否有图片附件
      const incomingAttachments = message.attachments || [];
      const hasImageAttachment = incomingAttachments.some(
        (a) => a.mimeType?.startsWith('image/')
      );

      // 确定本次请求的工作目录（优先使用实例级配置，避免多实例竞态）
      const instanceCwd = context.workingDirectory
        ? path.join(context.workingDirectory, 'files')
        : workDirManager.getCurrentWorkDir();

      // 是否需要临时视觉 runner（图片存在且当前模型不支持视觉）
      let visionRunner: UnifiedAgentRunner | null = null;
      let visionSwitchNotice = '';
      let effectiveRunner = this.agentRunner;

      if (hasImageAttachment) {
        // 获取当前模型名称
        const currentModelName = (this.agentRunner as any).options?.model || config.models[0]?.name;
        const currentModelConfig = (config.models as any[]).find((m: any) => m.name === currentModelName);
        const currentSupportsVision = currentModelConfig ? modelSupportsVision(currentModelConfig) : false;

        if (!currentSupportsVision) {
          // 查找第一个支持视觉的模型
          const visionModel = (config.models as any[]).find(
            (m: any) => m.enabled !== false && modelSupportsVision(m)
          );

          if (visionModel) {
            console.log(`[DispatchStream] Vision routing: switching from ${currentModelName} to ${visionModel.name} for image analysis`);
            visionRunner = new UnifiedAgentRunner((this.agentRunner as any).toolRegistry, {
              model: visionModel.name,
              maxIterations: 0,
              approvalMode: session.approvalMode || 'dangerous',
              cwd: instanceCwd,
            });
            visionSwitchNotice = `🔍 已自动切换到 **${visionModel.name}** 进行图像分析`;
            effectiveRunner = visionRunner;
          } else {
            // 没有可用视觉模型，返回友好提示
            console.warn('[DispatchStream] Vision routing: no vision-capable model found');
            yield { type: 'text', content: '⚠️ 当前没有支持图像识别的模型。请在配置中为某个模型开启视觉理解能力后重试。' };
            yield { type: 'done' };
            return;
          }
        }

        // 将图片注入到消息中
        const imageAttachments = incomingAttachments.filter(
          (a) => a.mimeType?.startsWith('image/')
        );
        const fileStorage = getFileStorage();
        const imageBlocks: ImageBlock[] = [];

        for (const att of imageAttachments) {
          // URL 格式: /api/files/{storedName}
          const storedName = path.basename(att.url || '');
          const absPath = fileStorage.getFilePath(storedName);

          if (!absPath) {
            console.warn(`[DispatchStream] Image path not resolved: ${storedName}`);
            continue;
          }

          try {
            const stat = fs.statSync(absPath);
            if (stat.size > MAX_IMAGE_SIZE) {
              console.warn(`[DispatchStream] Image too large (${Math.round(stat.size / 1024)}KB): ${storedName}`);
              continue;
            }

            const buffer = fs.readFileSync(absPath);
            const base64 = buffer.toString('base64');
            const mimeType = att.mimeType || 'image/jpeg';

            imageBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64,
              },
            });
            console.log(`[DispatchStream] Image loaded: ${storedName} (${Math.round(stat.size / 1024)}KB)`);
          } catch (err) {
            console.error(`[DispatchStream] Failed to read image ${storedName}:`, err);
          }
        }

        // 如果成功加载了图片，使用 registerPendingImages 机制注入
        if (imageBlocks.length > 0) {
          // 注册图片，获取 injectId
          const injectId = registerPendingImages(imageBlocks);

          // 设置环境变量，Proxy 会读取并注入图片到最后一条 user message
          process.env[VISION_INJECT_ENV_KEY] = injectId;
          console.log(`[DispatchStream] Registered ${imageBlocks.length} image(s) with injectId: ${injectId}`);

          // 发送视觉模型切换通知
          if (visionSwitchNotice) {
            yield { type: 'text', content: visionSwitchNotice + '\n\n' };
          }
        }
      }

      // ── 实例级 Runner：当 context 携带 workingDirectory 或 agentProfile 时 ──
      // 如果当前 effectiveRunner 仍是全局默认 runner，但 context 带有实例级配置，
      // 则创建一个持有独立 cwd 的临时 runner，避免多实例并发竞态（工具执行路径隔离）。
      // 注意：agentProfile 目前由 ClaudeAgentRunner 内部通过 ProfileLoader 加载，
      // 未来可扩展 AgentRunnerOptions.profile 来支持实例级 profile 切换。
      let instanceRunner: UnifiedAgentRunner | null = null;
      if (effectiveRunner === this.agentRunner && context.workingDirectory) {
        const existingOptions = (this.agentRunner as any).options || {};
        instanceRunner = new UnifiedAgentRunner((this.agentRunner as any).toolRegistry, {
          ...existingOptions,
          cwd: instanceCwd,
        });
        effectiveRunner = instanceRunner;
        console.log(`[DispatchStream] Created instance runner: cwd=${instanceCwd}${context.agentProfile ? `, profile hint=${context.agentProfile}` : ''}`);
      }

      // effectiveRunner 已最终确定（可能是 visionRunner、instanceRunner 或全局 runner）
      // 在此统一设置 activeTeam，避免多实例并发竞态（不再操作全局 this.agentRunner）
      if (typeof (effectiveRunner as any).setActiveTeam === 'function') {
        (effectiveRunner as any).setActiveTeam(activeTeam ?? null);
      }

      // Add user message to session
      this.sessionManager.addMessage(sessionId, {
        role: 'user',
        content: message.content,
        metadata: {
          platform: message.platform,
          chatId: message.chatId,
          userId: message.userId,
          attachments: message.attachments?.map(a => ({ name: a.name, mimeType: a.mimeType })),
          feishuInstanceId: context.feishuInstanceId, // 飞书实例 ID
        },
      });

      // 非 Web 渠道（飞书/钉钉/Slack 等）无法弹窗，拦截 AskUserQuestion 权限请求：
      // 将问题格式化为文本输出，并自动 deny 让 Agent 自行决策
      const isNonWebPlatform = message.platform !== 'http' && message.platform !== 'web';
      let askUserQuestionHandler: ((req: any) => void) | undefined;
      if (isNonWebPlatform && typeof (effectiveRunner as any).on === 'function') {
        askUserQuestionHandler = (req: any) => {
          if (req.toolName === 'AskUserQuestion' || req.toolName === 'askuserquestion') {
            // 格式化问题选项，记录日志供调试
            const questions: any[] = req.toolInput?.questions || [];
            if (questions.length > 0) {
              const formatted = questions.map((q: any) => {
                const opts = (q.options || []).map((o: any, i: number) => `  ${i + 1}. ${o.label} — ${o.description}`).join('\n');
                return `${q.question}\n${opts}`;
              }).join('\n\n');
              console.log(`[DispatchStream] AskUserQuestion intercepted for non-web platform (${message.platform}), questions:\n${formatted}`);
            }
            // 自动 deny，告知 Agent 当前渠道不支持交互式问答，请自行判断
            const denyMsg = '当前渠道（非 Web 环境）不支持交互式问答弹窗。请根据上下文直接做出最合理的判断并继续执行，无需等待用户选择。';
            (effectiveRunner as any).respondToPermission?.(req.requestId, false, undefined, denyMsg);
          }
        };
        (effectiveRunner as any).on('permissionRequest', askUserQuestionHandler);
      }

      // 流式运行
      let fullResponse = '';
      const attachments: FileAttachment[] = [];

      try {
        for await (const chunk of effectiveRunner.streamRun(prompt, history)) {
          if (chunk.type === 'text' && chunk.content) {
            fullResponse += chunk.content;
            yield { type: 'text', content: chunk.content };
          } else if (chunk.type === 'complete') {
            // 收集附件
            if (chunk.attachments) {
              attachments.push(...chunk.attachments);
            }
          }
        }
      } finally {
        // 清理事件监听器，避免内存泄漏
        if (askUserQuestionHandler && typeof (effectiveRunner as any).off === 'function') {
          (effectiveRunner as any).off('permissionRequest', askUserQuestionHandler);
        }
        // 临时视觉 runner 用完即释放
        if (visionRunner) {
          visionRunner.dispose?.();
          console.log('[DispatchStream] Vision runner disposed');
        }
        // 实例级 runner 用完即释放（避免内存泄漏）
        if (instanceRunner) {
          instanceRunner.dispose?.();
          console.log('[DispatchStream] Instance runner disposed');
        }
      }

      // 保存助手消息到 session
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: fullResponse,
      });

      // Trigger agent.end hook
      try {
        await getHooksLoader().emit('agent.end', {
          success: true,
          response: fullResponse,
          toolCalls: [],
          sessionId,
          userId,
        });
      } catch (hookError) {
        console.warn('[DispatchStream] Hook error (non-blocking):', hookError);
      }

      // 发送完成信号
      yield { type: 'done', content: fullResponse, files: attachments };

    } catch (error) {
      console.error('[DispatchStream] Error:', error);
      yield { type: 'text', content: `处理消息时出错: ${error}` };
      yield { type: 'done' };
    }
  }
}
