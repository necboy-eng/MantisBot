// src/agents/unified-runner.ts
// 统一的 Agent Runner 入口
// 根据模型类型自动选择 ClaudeAgentRunner 或 OpenAICompatRunner

import { EventEmitter } from 'events';
import { ToolRegistry } from './tools/registry.js';
import { getConfig } from '../config/loader.js';
import { ClaudeAgentRunner } from './claude-agent-runner.js';
import { OpenAICompatRunner } from './openai-compat-runner.js';
import type { LLMMessage, FileAttachment } from '../types.js';
import {
  type StreamChunk,
  type AgentResult,
  type AgentRunnerOptions,
  type IAgentRunner,
} from './types.js';

/**
 * 判断模型是否使用 Claude Agent SDK
 *
 * 判断逻辑（按优先级）：
 * 1. protocol === 'anthropic' → 使用 Claude Agent SDK
 * 2. provider === 'anthropic' → 使用 Claude Agent SDK
 * 3. 其他情况 → 使用 OpenAI 兼容模式
 */
function isClaudeModel(modelName: string): boolean {
  const config = getConfig();
  const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);

  if (!modelConfig) {
    console.warn(`[UnifiedRunner] Model not found in config: ${modelName}, defaulting to OpenAI compatible`);
    return false;
  }

  const mc = modelConfig as any;

  // 1. 优先检查 protocol 字段
  if (mc.protocol === 'anthropic') {
    console.log(`[UnifiedRunner] Model: ${modelName}, protocol: ${mc.protocol}, useClaudeSdk: true`);
    return true;
  }

  // 2. 检查 provider 字段
  if (mc.provider === 'anthropic') {
    console.log(`[UnifiedRunner] Model: ${modelName}, provider: ${mc.provider}, useClaudeSdk: true`);
    return true;
  }

  console.log(`[UnifiedRunner] Model: ${modelName}, provider: ${mc.provider || 'none'}, useClaudeSdk: false`);
  return false;
}

/**
 * 统一的 Agent Runner
 * 根据模型类型自动选择底层实现
 */
export class UnifiedAgentRunner extends EventEmitter implements IAgentRunner {
  private runner: IAgentRunner;
  private options: AgentRunnerOptions;
  private toolRegistry: ToolRegistry;
  private openaiRunner: OpenAICompatRunner | null = null; // 保存引用以便调用 abort
  private claudeRunner: ClaudeAgentRunner | null = null; // 保存引用以便调用 abort
  private abortController: AbortController | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    options: AgentRunnerOptions = {}
  ) {
    super();
    this.toolRegistry = toolRegistry;
    this.options = options;

    // 确定默认模型
    if (!options.model) {
      const config = getConfig();
      options.model = config.models[0]?.name;
    }

    // 根据模型类型选择实现
    if (options.model && isClaudeModel(options.model)) {
      console.log(`[UnifiedRunner] Using ClaudeAgentRunner for model: ${options.model}`);
      this.claudeRunner = new ClaudeAgentRunner(toolRegistry, {
        ...options,
      });
      this.runner = this.claudeRunner;

      // 转发 Claude Agent Runner 的事件
      this.claudeRunner.on('permissionRequest', (request: any) => {
        this.emit('permissionRequest', request);
      });
    } else {
      console.log(`[UnifiedRunner] Using OpenAICompatRunner for model: ${options.model}`);
      this.openaiRunner = new OpenAICompatRunner(toolRegistry, options);
      this.runner = this.openaiRunner;

      // 转发 OpenAI Runner 的权限请求事件
      this.openaiRunner.on('permissionRequest', (request: any) => {
        this.emit('permissionRequest', request);
      });
    }
  }

  /** 当前 Runner 使用的模型名称 */
  get modelName(): string {
    return this.options.model || '';
  }

  /**
   * 停止当前执行
   */
  abort(): void {
    console.log('[UnifiedRunner] Abort requested');
    if (this.openaiRunner) {
      this.openaiRunner.abort();
    }
    if (this.claudeRunner) {
      this.claudeRunner.abort();
    }
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * 动态设置激活的 Agent 团队（仅 ClaudeAgentRunner 支持）
   * 由 MessageDispatcher 在每次消息分发时调用
   */
  setActiveTeam(team: import('../config/schema.js').AgentTeam | null): void {
    if (this.claudeRunner) {
      (this.claudeRunner as any).options.activeTeam = team ?? undefined;
      console.log(`[UnifiedRunner] Active team set to: ${team?.name ?? 'none'}`);
    } else {
      console.log('[UnifiedRunner] setActiveTeam ignored: not using ClaudeAgentRunner');
    }
  }

  /**
   * 流式运行
   */
  async *streamRun(
    userMessage: string,
    conversationHistory: LLMMessage[] = [],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    // 创建内部 AbortController，支持 abort() 方法
    this.abortController = abortSignal ? null : new AbortController();
    const signal = abortSignal || this.abortController?.signal;

    if (signal) {
      yield* this.runner.streamRun(userMessage, conversationHistory, signal);
    } else {
      yield* this.runner.streamRun(userMessage, conversationHistory);
    }
  }

  /**
   * 非流式运行
   */
  async run(
    userMessage: string,
    conversationHistory: LLMMessage[] = [],
    abortSignal?: AbortSignal
  ): Promise<AgentResult> {
    // 创建内部 AbortController，支持 abort() 方法
    this.abortController = abortSignal ? null : new AbortController();
    const signal = abortSignal || this.abortController?.signal;

    if (signal) {
      return this.runner.run(userMessage, conversationHistory, signal);
    }
    return this.runner.run(userMessage, conversationHistory);
  }

  /**
   * 响应权限请求
   */
  async respondToPermission(
    requestId: string,
    approved: boolean,
    updatedInput?: Record<string, unknown>,
    denyMessage?: string
  ): Promise<void> {
    if (this.runner.respondToPermission) {
      return this.runner.respondToPermission(requestId, approved, updatedInput, denyMessage);
    }
    console.warn('[UnifiedRunner] respondToPermission not supported by underlying runner');
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    // ClaudeAgentRunner 使用 getClaudeSessionId()
    if (this.claudeRunner && this.claudeRunner.getClaudeSessionId) {
      return this.claudeRunner.getClaudeSessionId();
    }
    // 兼容其他 runner 的 getSessionId()
    if (this.runner.getSessionId) {
      return this.runner.getSessionId();
    }
    return null;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.runner.dispose) {
      this.runner.dispose();
    }
  }

  /**
   * 简单对话（不带工具）
   */
  async simpleChat(message: string): Promise<string> {
    if ('simpleChat' in this.runner && typeof (this.runner as any).simpleChat === 'function') {
      return (this.runner as any).simpleChat(message);
    }
    // 降级：使用 run 方法
    const result = await this.run(message, []);
    return result.response;
  }
}

/**
 * 创建 Agent Runner 的工厂函数
 */
export function createAgentRunner(
  toolRegistry: ToolRegistry,
  options: AgentRunnerOptions = {}
): IAgentRunner {
  return new UnifiedAgentRunner(toolRegistry, options);
}

// 重新导出类型
export type { StreamChunk, AgentResult, AgentRunnerOptions, IAgentRunner };
