// src/types.ts

// File Types
export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;   // 相对路径，如 /api/files/xxx（可选，纯 Buffer 附件无 URL）
  data?: Buffer;  // 原始文件数据（可选）
}

// Session types

/** 工具调用状态（持久化时 result 截断到 MAX_TOOL_RESULT_LEN 字符） */
export interface PersistedToolStatus {
  tool: string;
  toolId?: string;
  status: 'start' | 'end';
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  timestamp?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  attachments?: FileAttachment[];  // 文件附件列表
  /** 工具调用时间轴（result 已截断，仅用于历史展示） */
  toolStatus?: PersistedToolStatus[];
  /** 思考过程摘要（截断到前 500 字符） */
  thinking?: string;
  /** 消息元数据（如 platform、chatId 等） */
  metadata?: Record<string, unknown>;
}

// 审批模式类型
export type ApprovalMode = 'auto' | 'ask' | 'dangerous';

export interface Session {
  id: string;
  name?: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  // Claude Agent SDK 会话 ID（用于 resume 继续同一会话）
  claudeSessionId?: string;
  // 审批模式：auto=自动批准所有, ask=每次询问, dangerous=仅危险操作询问
  approvalMode?: ApprovalMode;
  // 星标置顶：标记为重要会话，在侧边栏顶部分组显示
  starred?: boolean;
}

// LLM types
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  tool_calls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'length' | 'tool_calls';
}

// Tool types
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface Tool extends ToolInfo {
  execute: (params: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// Agent Types
export interface AgentResult {
  content: string;
  toolCalls?: ToolCall[];
  files?: FileAttachment[];
}

export interface DispatchResult {
  content: string;
  files?: FileAttachment[];
}

// WS types
export interface WSMessage {
  type: string;
  payload?: unknown;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  model?: string;
  stream?: boolean;
}

export interface ChatResponse {
  sessionId: string;
  message: Message;
}
