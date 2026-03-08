// src/agents/types.ts
// 统一的 Agent Runner 类型定义

import type { FileAttachment } from '../types.js';

/**
 * 权限请求
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  isDangerous: boolean;
  reason?: string;
}

/**
 * 流式输出块
 */
export interface StreamChunk {
  // 消息类型
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'permission' | 'complete' | 'error' | 'system' | 'agent_invocation';
  // 文本内容
  content?: string;
  // 工具相关
  tool?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  // 权限请求
  permission?: PermissionRequest;
  // 附件
  attachments?: FileAttachment[];
  // 元数据
  messageId?: string;
  // Agent 调用相关（type === 'agent_invocation'）
  agentId?: string;       // 调用 tool_use_id
  agentName?: string;     // subagent 的 key 名称
  phase?: 'start' | 'end'; // 调用阶段
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  response: string;
  success: boolean;
  toolCalls?: { tool: string; result: unknown }[];
  attachments?: FileAttachment[];
}

// 审批模式类型（与 src/types.ts 保持同步）
export type ApprovalMode = 'auto' | 'ask' | 'dangerous';

/**
 * Agent Runner 选项
 */
export interface AgentRunnerOptions {
  model?: string;                      // 指定模型
  systemPrompt?: string;               // 自定义系统提示词
  maxIterations?: number;              // 最大迭代次数（0 = 无限制）
  /** @deprecated 使用 approvalMode 代替 */
  autoApprove?: boolean;               // 是否自动批准所有工具调用（向后兼容）
  approvalMode?: ApprovalMode;         // 审批模式：auto=自动批准所有, ask=每次询问, dangerous=仅危险操作询问
  skillsLoader?: any;                  // Skills 加载器
  cwd?: string;                        // 工作目录
  claudeSessionId?: string;            // 用于 resume 的会话 ID（仅 Claude SDK）
  abortSignal?: AbortSignal;           // 用于中断执行的信号
  /** 激活的 Agent 团队配置（仅 Claude SDK 支持） */
  activeTeam?: import('../config/schema.js').AgentTeam;
}

/**
 * Agent Runner 统一接口
 */
export interface IAgentRunner {
  /** 当前使用的模型名称 */
  readonly modelName: string;

  /**
   * 流式运行
   */
  streamRun(
    userMessage: string,
    conversationHistory: import('../types.js').LLMMessage[],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk>;

  /**
   * 非流式运行
   */
  run(
    userMessage: string,
    conversationHistory: import('../types.js').LLMMessage[],
    abortSignal?: AbortSignal
  ): Promise<AgentResult>;

  /**
   * 响应权限请求（可选，仅需要权限管理的实现需要）
   */
  respondToPermission?(
    requestId: string,
    approved: boolean,
    updatedInput?: Record<string, unknown>
  ): Promise<void>;

  /**
   * 获取会话 ID（可选，仅支持会话恢复的实现需要）
   */
  getSessionId?(): string | null;

  /**
   * 清理资源（可选）
   */
  dispose?(): void;
}

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  attachments?: FileAttachment[];
}

/**
 * 删除类工具（始终需要确认）
 */
export const DANGEROUS_TOOLS = new Set([
  'delete', 'remove', 'unlink', 'rmdir',
]);

/**
 * Bash 执行工具名称集合
 */
export const BASH_TOOLS = new Set(['Bash', 'bash', 'exec']);

/**
 * 需要确认的危险 Bash 命令模式（跨平台：macOS / Linux / Windows）
 */
export const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
  // === 版本控制 / 包发布（跨平台）===
  /\bgit\s+push\b/,
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bpnpm\s+publish\b/,
  // === 文件删除 ===
  /\brm\b/,                              // macOS/Linux: 任何 rm 命令
  /\bdel\b/i,                            // Windows cmd: del
  /\b(rd|rmdir)\b/i,                     // Windows cmd: rd / rmdir
  /Remove-Item\b/i,                      // PowerShell: Remove-Item
  // === 进程终止 ===
  /\bpkill\b|\bkillall\b/,
  /\btaskkill\b/i,
  /Stop-Process\b/i,
  // === 系统关机/重启 ===
  /\bshutdown\b/,
  /\breboot\b/,
  // === Docker 危险操作 ===
  /\bdocker\s+(rm|rmi|push|prune)\b/,
];

/**
 * 工具结果截断配置
 */
export const MAX_TOOL_RESULT_CHARS = 6000;
export const MIN_KEEP_CHARS = 1000;
export const TRUNCATION_SUFFIX = `\n\n⚠️ [结果已截断 - 原始内容过大。如需更多内容，请明确指定需要哪部分。]`;
