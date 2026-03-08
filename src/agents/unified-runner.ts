// src/agents/unified-runner.ts
// 统一的 Agent Runner 入口
// 所有模型统一使用 ClaudeAgentRunner（Claude Agent SDK）
// OpenAI 协议模型通过本地代理自动转换协议

import { EventEmitter } from 'events';
import { ToolRegistry } from './tools/registry.js';
import { getConfig } from '../config/loader.js';
import { ClaudeAgentRunner } from './claude-agent-runner.js';
import type { ClaudeAgentRunnerOptions } from './claude-agent-runner.js';
import { getProxyBaseURL, encodeUpstreamConfig } from './openai-proxy.js';
import type { LLMMessage } from '../types.js';
import {
  type StreamChunk,
  type AgentResult,
  type AgentRunnerOptions,
  type IAgentRunner,
} from './types.js';

/**
 * 判断模型是否使用 Anthropic 原生协议（直连，不需要代理）
 */
function isAnthropicNative(modelName: string): boolean {
  const config = getConfig();
  const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);

  if (!modelConfig) {
    console.warn(`[UnifiedRunner] Model not found in config: ${modelName}, defaulting to OpenAI proxy`);
    return false;
  }

  const mc = modelConfig as any;

  // 1. 优先检查 protocol 字段
  if (mc.protocol === 'anthropic') {
    console.log(`[UnifiedRunner] Model: ${modelName}, protocol: anthropic → direct`);
    return true;
  }

  // 2. 检查 provider 字段
  if (mc.provider === 'anthropic') {
    console.log(`[UnifiedRunner] Model: ${modelName}, provider: anthropic → direct`);
    return true;
  }

  console.log(`[UnifiedRunner] Model: ${modelName}, protocol: openai → proxy`);
  return false;
}

/**
 * 统一的 Agent Runner
 * 所有模型都使用 ClaudeAgentRunner（Claude Agent SDK）
 * - Anthropic 原生模型：直连，配置来自 env-isolation
 * - OpenAI 兼容模型：通过本地代理，上游配置编码在 API key 中
 */
export class UnifiedAgentRunner extends EventEmitter implements IAgentRunner {
  private claudeRunner: ClaudeAgentRunner;
  private options: AgentRunnerOptions;
  private abortController: AbortController | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    options: AgentRunnerOptions = {}
  ) {
    super();
    this.options = options;

    // 确定默认模型
    if (!options.model) {
      const config = getConfig();
      options.model = config.models[0]?.name;
    }

    let claudeOptions: ClaudeAgentRunnerOptions = { ...options };

    if (options.model && !isAnthropicNative(options.model)) {
      // OpenAI 兼容模型：通过本地代理
      const proxyBaseURL = getProxyBaseURL();
      if (!proxyBaseURL) {
        console.error('[UnifiedRunner] OpenAI proxy is not running! Call startProxy() before creating runners.');
      } else {
        // 获取上游模型配置
        const config = getConfig();
        const mc = config.models.find((m: any) => m.name === options.model) as any;
        const upstreamModel = mc?.model || options.model!;
        const upstreamApiKey = mc?.apiKey || '';
        const upstreamBaseUrl = mc?.baseURL || mc?.baseUrl || mc?.endpoint || '';

        // 编码上游配置到 API key 中
        const encodedKey = encodeUpstreamConfig({
          baseUrl: upstreamBaseUrl,
          apiKey: upstreamApiKey,
          model: upstreamModel,
        });

        console.log(`[UnifiedRunner] OpenAI proxy mode: ${options.model} → ${proxyBaseURL} (upstream: ${upstreamBaseUrl})`);

        claudeOptions = {
          ...options,
          anthropicBaseUrl: proxyBaseURL,
          overrideApiKey: encodedKey,
        };
      }
    } else {
      console.log(`[UnifiedRunner] Anthropic native mode: ${options.model}`);
    }

    this.claudeRunner = new ClaudeAgentRunner(toolRegistry, claudeOptions);

    // 转发事件
    this.claudeRunner.on('permissionRequest', (request: any) => {
      this.emit('permissionRequest', request);
    });
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
    this.claudeRunner.abort();
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * 动态设置激活的 Agent 团队
   */
  setActiveTeam(team: import('../config/schema.js').AgentTeam | null): void {
    (this.claudeRunner as any).options.activeTeam = team ?? undefined;
    console.log(`[UnifiedRunner] Active team set to: ${team?.name ?? 'none'}`);
  }

  /**
   * 流式运行
   */
  async *streamRun(
    userMessage: string,
    conversationHistory: LLMMessage[] = [],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    this.abortController = abortSignal ? null : new AbortController();
    const signal = abortSignal || this.abortController?.signal;

    if (signal) {
      yield* this.claudeRunner.streamRun(userMessage, conversationHistory, signal);
    } else {
      yield* this.claudeRunner.streamRun(userMessage, conversationHistory);
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
    this.abortController = abortSignal ? null : new AbortController();

    return this.claudeRunner.run(userMessage, conversationHistory);
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
    if (this.claudeRunner.respondToPermission) {
      return this.claudeRunner.respondToPermission(requestId, approved, updatedInput, denyMessage);
    }
    console.warn('[UnifiedRunner] respondToPermission not supported');
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.claudeRunner.getClaudeSessionId?.() ?? null;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.claudeRunner.dispose) {
      this.claudeRunner.dispose();
    }
  }

  /**
   * 简单对话（不带工具）
   */
  async simpleChat(message: string): Promise<string> {
    if ('simpleChat' in this.claudeRunner && typeof (this.claudeRunner as any).simpleChat === 'function') {
      return (this.claudeRunner as any).simpleChat(message);
    }
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
