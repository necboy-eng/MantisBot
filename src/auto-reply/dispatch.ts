// src/auto-reply/dispatch.ts

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
   * 三种触发方式（按优先级）：
   * 1. UI 显式指定 teamId（message.teamId 字段）
   * 2. /command 触发（消息以 "/xxx " 或 "/xxx\n" 开头）
   * 3. AI 自动关键词检测
   */
  private resolveTeam(message: ChannelMessage): { team: AgentTeam | null; content: string } {
    const config = getConfig();
    const teams: AgentTeam[] = config.agentTeams || [];
    let content = message.content;

    // 1. UI 显式指定 teamId
    const explicitTeamId = (message as any).teamId as string | undefined;
    if (explicitTeamId) {
      const team = teams.find(t => t.enabled && t.id === explicitTeamId) ?? null;
      if (team) {
        console.log(`[Dispatch] Using explicitly selected team: ${team.name}`);
        return { team, content };
      }
    }

    // 2. /command 触发：以 "/xxx" 开头（后跟空格、换行或直接结束）
    const cmdMatch = content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
    if (cmdMatch) {
      const command = cmdMatch[1];
      const team = findTeamByCommand(command, teams);
      if (team) {
        content = cmdMatch[2]?.trim() || content;
        console.log(`[Dispatch] Team triggered by command /${command}: ${team.name}`);
        return { team, content };
      }
    }

    // 3. AI 自动关键词检测
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

      // 解析团队触发（三种方式）
      const { team: activeTeam, content } = this.resolveTeam(message);

      // 如果激活了团队，将团队信息注入 Runner options（通过 setOptions 或直接在 run 时传）
      if (activeTeam) {
        // 将 activeTeam 注入 runner（UnifiedAgentRunner 支持动态 options）
        const runner = this.agentRunner as any;
        if (typeof runner.setActiveTeam === 'function') {
          runner.setActiveTeam(activeTeam);
        }
        console.log(`[Dispatch] Active team: ${activeTeam.name} (${Object.keys(activeTeam.agents).length} subagents)`);
      } else {
        const runner = this.agentRunner as any;
        if (typeof runner.setActiveTeam === 'function') {
          runner.setActiveTeam(null);
        }
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
      const result = await this.agentRunner.run(prompt, history);

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

      // 解析团队触发
      const { team: activeTeam, content } = this.resolveTeam(message);

      if (activeTeam) {
        const runner = this.agentRunner as any;
        if (typeof runner.setActiveTeam === 'function') {
          runner.setActiveTeam(activeTeam);
        }
        console.log(`[DispatchStream] Active team: ${activeTeam.name}`);
      } else {
        const runner = this.agentRunner as any;
        if (typeof runner.setActiveTeam === 'function') {
          runner.setActiveTeam(null);
        }
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

      // Add user message to session
      this.sessionManager.addMessage(sessionId, {
        role: 'user',
        content: message.content,
        metadata: {
          platform: message.platform,
          chatId: message.chatId,
          userId: message.userId,
        },
      });

      // 非 Web 渠道（飞书/钉钉/Slack 等）无法弹窗，拦截 AskUserQuestion 权限请求：
      // 将问题格式化为文本输出，并自动 deny 让 Agent 自行决策
      const isNonWebPlatform = message.platform !== 'http' && message.platform !== 'web';
      let askUserQuestionHandler: ((req: any) => void) | undefined;
      if (isNonWebPlatform && typeof (this.agentRunner as any).on === 'function') {
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
            (this.agentRunner as any).respondToPermission?.(req.requestId, false, undefined, denyMsg);
          }
        };
        (this.agentRunner as any).on('permissionRequest', askUserQuestionHandler);
      }

      // 流式运行
      let fullResponse = '';
      const attachments: FileAttachment[] = [];

      try {
        for await (const chunk of this.agentRunner.streamRun(prompt, history)) {
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
        if (askUserQuestionHandler && typeof (this.agentRunner as any).off === 'function') {
          (this.agentRunner as any).off('permissionRequest', askUserQuestionHandler);
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
