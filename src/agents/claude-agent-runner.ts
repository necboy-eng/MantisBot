// src/agents/claude-agent-runner.ts

import { EventEmitter } from 'events';
import { loadClaudeSdk } from './claude-sdk.js';
import { ToolRegistry } from './tools/registry.js';
import type { SkillsLoader } from './skills/loader.js';
import { formatSkillsForPrompt } from '@mariozechner/pi-coding-agent';
import { getGlobalPluginLoader } from '../plugins/loader.js';
import type { ToolInfo } from '../types.js';
import type { LLMMessage, FileAttachment } from '../types.js';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { getConfig } from '../config/loader.js';
import { applyIsolatedEnv, buildIsolatedEnv } from '../env-isolation.js';
import { getFileStorage } from '../files/storage.js';
import { workDirManager } from '../workdir/manager.js';
import { buildSdkAgents } from './agent-teams.js';
import { z } from 'zod';

// 审批模式类型
export type ApprovalMode = 'auto' | 'ask' | 'dangerous';

export interface ClaudeAgentRunnerOptions {
  model?: string;
  systemPrompt?: string;
  maxIterations?: number;
  /** @deprecated 使用 approvalMode 代替 */
  autoApprove?: boolean;  // 是否自动批准所有工具调用（向后兼容）
  approvalMode?: ApprovalMode;  // 审批模式：auto=自动批准所有, ask=每次询问, dangerous=仅危险操作询问
  skillsLoader?: SkillsLoader;  // Skills 加载器
  cwd?: string;  // 工作目录
  claudeSessionId?: string;  // 用于 resume 的会话 ID
  /** 激活的 Agent 团队配置（仅 Claude SDK 支持） */
  activeTeam?: import('../config/schema.js').AgentTeam;
}

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
  agentId?: string;
  agentName?: string;
  phase?: 'start' | 'end';
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  isDangerous: boolean;
  reason?: string;
}

export interface AgentResult {
  response: string;
  success: boolean;
  toolCalls?: { tool: string; result: unknown }[];
  attachments?: FileAttachment[];
}

// 删除类工具（始终需要确认）
const DANGEROUS_TOOLS = new Set([
  'delete', 'remove', 'unlink', 'rmdir',
]);

// Bash 执行工具名称集合（Bash / bash / exec 统一处理）
const BASH_TOOLS = new Set(['Bash', 'bash', 'exec']);

// 需要确认的危险 Bash 命令模式（跨平台：macOS / Linux / Windows）
const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
  // === 版本控制 / 包发布（跨平台）===
  /\bgit\s+push\b/,                               // git push（含 --force）
  /\bnpm\s+publish\b/,                             // npm publish
  /\byarn\s+publish\b/,                            // yarn publish
  /\bpnpm\s+publish\b/,                            // pnpm publish

  // === 文件删除 ===
  /\brm\b/,                                        // macOS/Linux: 任何 rm 命令（含 rm file / rm -rf）
  /\bdel\b/i,                                      // Windows cmd: del
  /\b(rd|rmdir)\b/i,                               // Windows cmd: rd / rmdir（含 /s）
  /Remove-Item\b/i,                                // PowerShell: Remove-Item（含 -Recurse/-Force）

  // === 进程终止 ===
  /\bpkill\b|\bkillall\b/,                         // macOS/Linux
  /\btaskkill\b/i,                                 // Windows cmd
  /Stop-Process\b/i,                               // PowerShell

  // === 系统关机/重启 ===
  /\bshutdown\b/,                                  // macOS/Linux + Windows (shutdown /s /r)
  /\breboot\b/,                                    // macOS/Linux

  // === Docker 危险操作（跨平台）===
  /\bdocker\s+(rm|rmi|push|prune)\b/,
];

// 需要通过 MCP 注入的工具（SDK 没有的）
const MCP_ONLY_TOOLS = new Set([
  'memory_search',
  'remember',
  'read_skill',
  'send_file',
  'document',
  'logger',
  'cron_manage',  // 定时任务管理
  'firecrawl',    // Firecrawl 网页搜索和抓取（与 WebFetch 互斥，取决于 FIRECRAWL_API_KEY）
  'crawl4ai',    // Crawl4AI 网页爬取（基于 Playwright，高质量 Markdown 输出）
  // 浏览器工具
  'browser_launch',
  'browser_close',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_snapshot',
  'browser_screenshot',
  'browser_wait',
  'browser_wait_for',
  'browser_get_text',
  'browser_exists',
  'browser_refresh',
  'browser_go_back',
  'browser_get_html',
  'browser_evaluate'
]);

// 工具结果截断配置
const MAX_TOOL_RESULT_CHARS = 6000;

/**
 * 将 subagent 模型别名解析为实际可用的模型名称
 * - 'inherit' 或 undefined → 使用父模型
 * - 'opus' / 'sonnet' / 'haiku' → Claude 原生模型 ID
 * - 其他 → 直接透传（可能是完整模型 ID）
 */
function resolveSubagentModel(agentModel: string | undefined, parentModel: string): string {
  if (!agentModel || agentModel === 'inherit') return parentModel;
  const claudeAliases: Record<string, string> = {
    opus: 'claude-opus-4-6',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5-20251001',
  };
  return claudeAliases[agentModel] ?? agentModel;
}
const TRUNCATION_SUFFIX = '\n\n[Result truncated - original content too large]';

/**
 * 截断过大的工具结果
 */
function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) {
    return content;
  }
  return content.slice(0, MAX_TOOL_RESULT_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * 收集附件
 * 支持多种格式：
 * 1. { attachments: FileAttachment[] } - send_file 工具返回
 * 2. { url, name } - 单个附件
 * 3. { image, mimeType } - base64 图片（如 browser_screenshot），会保存到文件
 * 4. { filePath/fileUrl, previewHtml } - infographic 工具返回
 */
function collectAttachments(result: unknown, attachments: FileAttachment[]): void {
  if (result && typeof result === 'object') {
    let newItems: FileAttachment[] = [];

    const resultObj = result as Record<string, unknown>;

    // 1. 检查是否有 attachments 数组
    if ('attachments' in resultObj && Array.isArray(resultObj.attachments)) {
      newItems = resultObj.attachments as FileAttachment[];
    }
    // 2. 检查是否是数组格式
    else if (Array.isArray(result) && result.length > 0 && 'url' in result[0]) {
      newItems = result as FileAttachment[];
    }
    // 3. 检查是否是单个 URL 附件
    else if ('url' in resultObj && 'name' in resultObj && !Array.isArray(result)) {
      newItems = [result as FileAttachment];
    }
    // 4. 检查是否是截图（browser_screenshot）- 使用已保存的文件路径
    else if ('savedImagePath' in resultObj && 'savedImageName' in resultObj) {
      const savedPath = resultObj.savedImagePath as string;
      const savedName = resultObj.savedImageName as string;
      const mimeType = resultObj.mimeType as string || 'image/png';
      const timestamp = Date.now();

      console.log('[collectAttachments] Using saved screenshot:', savedPath);
      newItems = [{
        id: `screenshot-${timestamp}`,
        name: savedName,
        url: savedPath,
        mimeType: mimeType,
        size: 0,  // 大小未知，但前端不需要
      } as FileAttachment];
    }
    // 5. 检查是否是 base64 图片（其他工具）- 保存到文件
    else if ('image' in resultObj && 'mimeType' in resultObj && typeof resultObj.image === 'string') {
      const mimeType = resultObj.mimeType as string || 'image/png';
      const base64Data = resultObj.image as string;

      // 生成唯一文件名
      const timestamp = Date.now();
      const ext = mimeType.split('/')[1] || 'png';
      const name = `screenshot-${timestamp}.${ext}`;

      // 保存到文件
      try {
        const fileStorage = getFileStorage();
        const savedFile = fileStorage.saveImageFile(name, base64Data, mimeType);
        console.log('[collectAttachments] Saved screenshot to file:', savedFile.url);
        newItems = [savedFile];
      } catch (error) {
        console.error('[collectAttachments] Failed to save screenshot:', error);
        // 保存失败时跳过这个附件
      }
    }
    // 6. 检查是否是 infographic 工具返回（filePath/fileUrl + previewHtml）
    else if (('filePath' in resultObj || 'fileUrl' in resultObj) && 'previewHtml' in resultObj) {
      const fileUrl = (resultObj.filePath || resultObj.fileUrl) as string;
      // 从 previewHtml 中提取文件名或标题
      const previewHtml = resultObj.previewHtml as string;
      const titleMatch = previewHtml?.match(/<title>([^<]+)<\/title>/);
      const fileName = titleMatch ? titleMatch[1].trim() + '.html' : 'infographic.html';
      const timestamp = Date.now();

      console.log('[collectAttachments] Detected infographic:', fileUrl);
      newItems = [{
        id: `infographic-${timestamp}`,
        name: fileName,
        url: fileUrl,
        mimeType: 'text/html',
        size: 0,  // 大小未知
      } as FileAttachment];
    }

    const existingUrls = new Set(attachments.map(a => a.url));
    for (const item of newItems) {
      if (!existingUrls.has(item.url)) {
        attachments.push(item);
        existingUrls.add(item.url);
      }
    }
  }
}

/**
 * Claude Agent Runner - 基于 Claude Agent SDK 的 Agent 实现
 *
 * 核心功能：
 * 1. 使用 Claude Agent SDK 的 query API
 * 2. 支持权限请求机制（通过 canUseTool 回调）
 * 3. MCP 服务器集成现有工具系统
 * 4. 流式输出支持
 */
export class ClaudeAgentRunner extends EventEmitter {
  private toolRegistry: ToolRegistry;
  private skillsLoader?: SkillsLoader;
  private options: {
    model: string;
    systemPrompt: string;
    maxIterations: number;
    approvalMode: ApprovalMode;
    activeTeam?: import('../config/schema.js').AgentTeam;
  };

  // Agent SDK 会话 ID（用于 resume 继续会话）
  private claudeSessionId: string | null = null;

  // 中断控制器
  private abortController: AbortController | null = null;

  // 获取当前的 claudeSessionId
  getClaudeSessionId(): string | null {
    return this.claudeSessionId;
  }

  /** 当前使用的模型名称 */
  get modelName(): string {
    return this.options.model;
  }

  /**
   * 停止当前执行
   */
  abort(): void {
    if (this.abortController) {
      console.log('[ClaudeAgentRunner] Abort requested');
      this.abortController.abort();
    }
  }

  // 权限请求等待队列
  private pendingPermissions: Map<string, {
    resolve: (result: PermissionResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(
    toolRegistry: ToolRegistry,
    options: ClaudeAgentRunnerOptions = {}
  ) {
    super();
    this.toolRegistry = toolRegistry;
    this.skillsLoader = options.skillsLoader;
    this.claudeSessionId = options.claudeSessionId || null;

    // 兼容旧的 autoApprove 参数，转换为 approvalMode
    let approvalMode: ApprovalMode = options.approvalMode || 'dangerous';  // 默认仅危险操作询问
    if (options.autoApprove === true && !options.approvalMode) {
      approvalMode = 'auto';
    } else if (options.autoApprove === false && !options.approvalMode) {
      approvalMode = 'dangerous';
    }

    this.options = {
      model: options.model || 'claude-sonnet-4-20250514',
      systemPrompt: options.systemPrompt || '',
      maxIterations: options.maxIterations || 0,  // 0 = 无限制
      approvalMode,
      activeTeam: options.activeTeam,
    };
    console.log('[ClaudeAgentRunner] Initialized with approvalMode:', approvalMode);
  }

  /**
   * 检查工具是否为删除类危险操作
   */
  private isDangerousTool(toolName: string): boolean {
    return DANGEROUS_TOOLS.has(toolName.toLowerCase());
  }

  /**
   * 检查 Bash 命令是否匹配危险操作模式
   */
  private isDangerousBashCommand(command: string): boolean {
    return DESTRUCTIVE_BASH_PATTERNS.some(pattern => pattern.test(command));
  }

  /**
   * 创建权限请求
   */
  private createPermissionRequest(
    toolName: string,
    toolInput: Record<string, unknown>
  ): PermissionRequest {
    const isDangerous = this.isDangerousTool(toolName) ||
      (BASH_TOOLS.has(toolName) && this.isDangerousBashCommand(
        String(toolInput.command || toolInput.cmd || '')
      ));
    let reason: string | undefined;

    if (BASH_TOOLS.has(toolName)) {
      const command = toolInput.command || toolInput.cmd || '';
      reason = `Will execute command: ${String(command).slice(0, 100)}`;
    } else if (this.isDangerousTool(toolName)) {
      reason = `Tool "${toolName}" may perform destructive operation`;
    }

    const requestId = crypto.randomUUID();

    // 保存原始输入，以便在批准时使用（如果没有提供修改后的输入）
    this.permissionOriginalInputs.set(requestId, toolInput);

    return {
      requestId,
      toolName,
      toolInput,
      isDangerous,
      reason,
    };
  }

  /**
   * 等待权限响应
   */
  private waitForPermission(
    requestId: string,
    timeoutMs: number = 60000
  ): Promise<PermissionResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timeout' });
      }, timeoutMs);

      this.pendingPermissions.set(requestId, { resolve, reject, timeout });
    });
  }

  // 存储权限请求时的原始输入（用于批准时回退）
  private permissionOriginalInputs = new Map<string, Record<string, unknown>>();

  /**
   * 响应权限请求（供外部调用，如 HTTP Server）
   */
  async respondToPermission(
    requestId: string,
    approved: boolean,
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(`[ClaudeAgentRunner] No pending permission request for ID: ${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(requestId);

    if (approved) {
      // 获取原始输入（在 createPermissionRequest 时保存）
      const originalInput = this.permissionOriginalInputs.get(requestId);
      this.permissionOriginalInputs.delete(requestId);

      // 如果没有提供 updatedInput，使用原始输入
      // 这样 SDK 就能正确执行工具，不会因为空对象导致 undefined.includes() 错误
      const finalInput = updatedInput && Object.keys(updatedInput).length > 0
        ? updatedInput
        : originalInput || {};

      console.log('[ClaudeAgentRunner] Permission approved, using input:', JSON.stringify(finalInput).slice(0, 200));

      pending.resolve({
        behavior: 'allow',
        updatedInput: finalInput,
      });
    } else {
      // 清理原始输入
      this.permissionOriginalInputs.delete(requestId);
      pending.resolve({
        behavior: 'deny',
        message: 'Permission denied by user',
      });
    }
  }

  /**
   * 获取待处理的权限请求
   */
  getPendingPermissions(): PermissionRequest[] {
    const requests: PermissionRequest[] = [];
    for (const [requestId, pending] of this.pendingPermissions) {
      // 从 resolve 函数中提取 requestId 对应的信息
      // 这里简化处理，实际需要更完善的数据结构
    }
    return requests;
  }

  /**
   * 构建 MCP 工具列表
   */
  private async buildMcpTools() {
    const { tool: createTool, createSdkMcpServer } = await loadClaudeSdk();
    const toolRegistry = this.toolRegistry;
    const tools = toolRegistry.listTools();

    const mcpTools = tools.map((toolInfo: ToolInfo) => {
      return createTool(
        toolInfo.name,
        toolInfo.description,
        // 将 JSON Schema 转为 Zod（简化版本）
        this.jsonSchemaToZod(toolInfo.parameters),
        async (args: Record<string, unknown>) => {
          try {
            const result = await toolRegistry.execute(toolInfo.name, args);

            // 截断结果
            const resultStr = JSON.stringify(result);
            const truncated = truncateToolResult(resultStr);

            return {
              content: [
                {
                  type: 'text' as const,
                  text: truncated,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
    });

    return { createTool, createSdkMcpServer, mcpTools };
  }

  /**
   * JSON Schema 转 Zod Raw Shape
   * 将工具的 JSON Schema 转换为 Zod raw shape（传递给 z.object() 的对象）
   * 注意：SDK 的 createTool 期望的是 raw shape，不是 z.object() 的返回值
   */
  private jsonSchemaToZod(schema: any): any {
    if (!schema || !schema.properties) {
      return {};
    }

    const properties = schema.properties;
    const zodProperties: Record<string, any> = {};

    for (const [key, prop] of Object.entries(properties)) {
      const propDef = prop as Record<string, unknown>;
      const zodType = this.jsonSchemaPropToZod(propDef);
      zodProperties[key] = zodType;
    }

    // 返回 raw shape 对象，而不是 z.object(zodProperties)
    // SDK 的 createTool 会自动将其包装为 z.object()
    return zodProperties;
  }

  /**
   * 将 JSON Schema 属性转换为 Zod 类型
   */
  private jsonSchemaPropToZod(prop: Record<string, unknown>): any {
    const type = prop.type as string;

    switch (type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(z.any());
      case 'object':
        return z.record(z.string(), z.any());
      default:
        return z.any();
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
    // 创建或复用 AbortController
    if (abortSignal) {
      // 使用传入的 signal，创建一个绑定到它的 controller
      this.abortController = null; // 外部管理
    } else {
      this.abortController = new AbortController();
      abortSignal = this.abortController.signal;
    }

    const { query, createSdkMcpServer, tool: createTool } = await loadClaudeSdk();
    const attachments: FileAttachment[] = [];

    // 应用环境变量隔离
    // 查找当前模型的 apiKey 和 baseUrl，确保第三方 Anthropic-compatible 模型（如 MiniMax、GLM）
    // 使用正确的 API 端点和凭证，而不是默认模型的配置
    // mc 提到外层作用域，供后续 query() 调用时复用真实模型 ID
    const { models: _allModels } = getConfig();
    const mc = _allModels.find((m: any) => m.name === this.options.model) as any;
    // 真实 API 模型 ID（如 "glm-5"），区别于显示名（如 "GLM-5-Aliyun"）
    const resolvedModelId = mc?.model || this.options.model;
    applyIsolatedEnv({
      model: resolvedModelId,
      apiKey: mc?.apiKey,
      baseUrl: mc?.baseURL || mc?.baseUrl || mc?.endpoint,
    });

    // 检查是否启用 Firecrawl（优先）还是 WebFetch
    // 如果设置了 FIRECRAWL_API_KEY，使用 Firecrawl MCP 工具
    // 否则使用 SDK 内置的 WebFetch 工具
    const useFirecrawl = !!process.env.FIRECRAWL_API_KEY;
    console.log('[ClaudeAgentRunner] FIRECRAWL_API_KEY set:', useFirecrawl);

    // 每次对话都动态读取当前工作目录（支持会话中途切换）
    const currentCwd = workDirManager.getCurrentWorkDir();

    // 构建系统提示词
    let systemPrompt = this.options.systemPrompt;
    if (!systemPrompt) {
      systemPrompt = 'You are a helpful AI assistant.';
    }

    // Agent Team 激活时：将协调者角色注入到系统提示词最顶部，优先级高于一切
    // 这确保模型首先建立"我是协调者"的身份，而不是被后续的 skills 指令覆盖
    if (this.options.activeTeam?.orchestrator?.systemPrompt) {
      const agentList = Object.entries(this.options.activeTeam.agents)
        .map(([id, def]) => `- **${id}**: ${def.description}`)
        .join('\n');
      console.log('[ClaudeAgentRunner] Prepending Agent Team orchestrator prompt for team:', this.options.activeTeam.name);
      systemPrompt = `## 你当前的角色：${this.options.activeTeam.name} 协调者\n\n${this.options.activeTeam.orchestrator.systemPrompt}\n\n可调用的专业 Agent（以工具调用方式派遣）：\n${agentList}\n\n**重要**：你不应直接执行任务（不要自己搜索、写报告、分析数据），你的职责是将任务分解后派遣给上述专业 Agent 完成。\n\n---\n\n${systemPrompt}`;
    }

    // 将当前工作目录注入系统提示词，确保 Claude 始终感知到正确路径
    systemPrompt = `${systemPrompt}\n\n## 当前工作目录\n${currentCwd}`;

    // 注入目录结构上下文（办公场景优化）
    const dirContext = workDirManager.getWorkDirContext();
    if (dirContext) {
      systemPrompt = `${systemPrompt}\n\n${dirContext}`;
    }

    // 注入记忆工具使用指引 + 记忆使用约束
    systemPrompt = `${systemPrompt}\n\n## 记忆使用规范
你拥有用户的历史记忆信息，但请遵守以下规则：
1. **不要主动复述**：除非用户明确询问（如"你知道我是谁吗"），否则不要复述记忆中的个人信息
2. **隐式使用**：将记忆作为上下文背景，自然地融入回答，而非单独列出
3. **仅回答相关问题**：只有当用户问题与记忆直接相关时，才引用记忆内容
4. **避免过度联想**：简单的问候（如"你好"、"早上好"）不需要触发记忆中的身份信息
5. **保持自然**：使用记忆时，像普通人聊天一样自然提及，不要像读档案一样

## 记忆工具
你有一个 \`remember\` 工具，仅在学到对未来对话有价值的信息时调用：
- 用户偏好（编码风格、语言偏好、沟通方式）
- 项目关键事实（技术栈、架构决策、环境信息）
- 重要决策（用户做出的选择，如"暂不引入 Redis"）
- 个人上下文（姓名、时区、角色）

不要调用 remember 记录：普通问答、解释说明、调试步骤、或仅与当前任务相关的临时信息。`;

    // 加载 Skills 提示词（如果提供了 skillsLoader）
    // Agent Team 激活时跳过：协调者不直接执行技能，skills 由各子 agent 自身携带
    if (!this.options.activeTeam) {
      const config = getConfig();
      const enabledSkills = config.enabledSkills || [];

      // 获取 standalone skill 对象（按 enabledSkills 过滤）
      const standaloneSkillObjs = this.skillsLoader
        ? this.skillsLoader.list().map(ls => ls.skill).filter(s => enabledSkills.includes(s.name))
        : [];

      // 获取 plugin skills
      const pluginSkills = getGlobalPluginLoader()?.getSkills() || [];
      const formattedPluginSkills = pluginSkills.map(s => ({
        name: s.name,
        description: s.description,
        filePath: s.filePath,
        baseDir: '',
        source: `plugin:${s.pluginName}`,
        disableModelInvocation: false,
      }));

      // 合并后统一格式化为单个 <available_skills> 块
      const allSkills = [...standaloneSkillObjs, ...formattedPluginSkills];
      if (allSkills.length > 0) {
        const skillsPrompt = formatSkillsForPrompt(allSkills);
        console.log(`[ClaudeAgentRunner] Injecting ${standaloneSkillObjs.length} standalone + ${formattedPluginSkills.length} plugin skills`);
        systemPrompt = `${systemPrompt}\n\n${skillsPrompt}`;
      }
    } else {
      console.log('[ClaudeAgentRunner] Skipping skills injection (Agent Team active, orchestrator delegates to subagents)');
    }

    // 构建 MCP 工具 - 只保留 MCP_ONLY_TOOLS 中的工具
    const toolList = this.toolRegistry.listTools();

    // 过滤：只保留 MCP_ONLY_TOOLS 中的工具
    // 如果启用 WebFetch，则排除 firecrawl 工具
    const mcpOnlyToolList = toolList.filter((toolInfo: ToolInfo) => {
      if (!MCP_ONLY_TOOLS.has(toolInfo.name)) {
        return false;
      }
      // 如果不使用 Firecrawl（即使用 WebFetch），排除 firecrawl 工具
      if (!useFirecrawl && toolInfo.name === 'firecrawl') {
        return false;
      }
      return true;
    });

    console.log('[ClaudeAgentRunner] MCP only tools:', mcpOnlyToolList.map(t => t.name));

    const mcpTools = mcpOnlyToolList.map((toolInfo: ToolInfo) => {
      return createTool(
        toolInfo.name,
        toolInfo.description,
        this.jsonSchemaToZod(toolInfo.parameters),
        async (args: Record<string, unknown>, extra?: unknown) => {
          console.log('[ClaudeAgentRunner] Tool execution started:', toolInfo.name);
          console.log('[ClaudeAgentRunner] Args:', JSON.stringify(args));
          console.log('[ClaudeAgentRunner] Extra:', JSON.stringify(extra));

          // 尝试从不同位置获取参数（SDK 可能使用不同的参数结构）
          let toolArgs = args;
          if (extra && typeof extra === 'object') {
            const extraObj = extra as Record<string, unknown>;
            if (extraObj.input && typeof extraObj.input === 'object') {
              console.log('[ClaudeAgentRunner] Using input from extra:', JSON.stringify(extraObj.input));
              toolArgs = extraObj.input as Record<string, unknown>;
            }
          }

          try {
            const result = await this.toolRegistry.execute(toolInfo.name, toolArgs);
            collectAttachments(result, attachments);
            console.log('[ClaudeAgentRunner] After collectAttachments, total attachments:', attachments.length);

            const resultStr = JSON.stringify(result);
            const truncated = truncateToolResult(resultStr);

            console.log('[ClaudeAgentRunner] Tool execution succeeded:', toolInfo.name);
            return {
              content: [{ type: 'text' as const, text: truncated }],
            };
          } catch (error) {
            console.error('[ClaudeAgentRunner] Tool execution failed:', toolInfo.name, error);
            return {
              content: [{ type: 'text' as const, text: `Error: ${error}` }],
              isError: true,
            };
          }
        }
      );
    });

    // ── Agent Team 工具包装器 ───────────────────────────────────────────────
    // 当激活 Agent Team 时，为每个 subagent 创建一个真实的 MCP 工具。
    // 协调者通过调用这些工具来派遣 subagent，避免依赖 SDK 原生 agents 特性，
    // 使 GLM-5 / MiniMax 等 Anthropic-compatible 模型也能正确触发 subagent。
    const agentMcpTools: ReturnType<typeof createTool>[] = [];
    const agentToolNames: string[] = [];

    if (this.options.activeTeam) {
      const team = this.options.activeTeam;
      console.log('[ClaudeAgentRunner] Building subagent MCP tools for team:', team.name);

      for (const [agentId, agentDef] of Object.entries(team.agents)) {
        agentToolNames.push(agentId);
        const subAgentModel = resolveSubagentModel(agentDef.model, this.options.model);

        agentMcpTools.push(
          createTool(
            agentId,
            agentDef.description,
            { task: z.string().describe('The specific task for this agent to perform') } as any,
            async (args: Record<string, unknown>) => {
              const task = String(args.task || '');
              console.log(`[ClaudeAgentRunner] ▶ Subagent "${agentId}" started, task:`, task.slice(0, 200));

              // 为 subagent 创建独立 runner（不传 activeTeam 防止递归）
              const subRunner = new ClaudeAgentRunner(this.toolRegistry, {
                model: subAgentModel,
                systemPrompt: agentDef.systemPrompt || agentDef.description,
                maxIterations: agentDef.maxTurns || 20,
                approvalMode: 'auto',
              });

              let outputText = '';
              try {
                for await (const chunk of subRunner.streamRun(task)) {
                  if (chunk.type === 'text' && chunk.content) {
                    outputText += chunk.content;
                  } else if (chunk.type === 'complete' && chunk.attachments?.length) {
                    // 将 subagent 产生的附件冒泡至父 runner
                    collectAttachments({ attachments: chunk.attachments }, attachments);
                  }
                }
              } catch (err) {
                console.error(`[ClaudeAgentRunner] Subagent "${agentId}" error:`, err);
                return {
                  content: [{ type: 'text' as const, text: `Error in ${agentId}: ${err}` }],
                  isError: true,
                };
              }

              console.log(`[ClaudeAgentRunner] ✓ Subagent "${agentId}" completed, output length:`, outputText.length);
              return {
                content: [{ type: 'text' as const, text: outputText || `(${agentId} 已完成，无文本输出)` }],
              };
            }
          )
        );
      }
    }

    // 合并所有 MCP 工具（内置工具 + subagent 工具）
    const allMcpTools = [...mcpTools, ...agentMcpTools];

    // 构建 MCP 服务器（如果没有特有工具则不创建）
    const mcpServer = allMcpTools.length > 0
      ? createSdkMcpServer({
          name: 'mantis-tools',
          tools: allMcpTools,
        })
      : null;

    // 构建消息历史
    const messages = this.buildMessages(userMessage, conversationHistory);

    // 配置选项
    const options: Record<string, unknown> = {
      // 将 Skills 内容注入为系统提示词，传给 Claude Agent SDK
      // 这是 MantisBot Skills 生效的核心机制：通过 systemPrompt 文本注入，不依赖 SDK Skill 工具
      systemPrompt,
      // 使用真实 API 模型 ID（如 "glm-5"），而非显示名（如 "GLM-5-Aliyun"）
      model: resolvedModelId,
      // 工作目录（动态读取，支持会话中途切换）
      cwd: currentCwd,
      // 使用 tools 指定可用工具（不使用 allowedTools，因为 allowedTools 会自动批准）
      // tools 只指定哪些工具可用，权限由 canUseTool 回调控制
      tools: [
        'Read', 'Write', 'Edit', 'Bash',
        'Glob', 'Grep',
        // 根据环境变量选择：有 FIRECRAWL_API_KEY 用 Firecrawl，否则用 WebFetch
        ...(useFirecrawl ? [] : ['WebSearch', 'WebFetch']),
        'AskUserQuestion',
        // MCP 工具
        ...mcpOnlyToolList.map((t: ToolInfo) => t.name),
        // Subagent 工具（Agent Team 激活时动态添加，名称 = agentId）
        ...agentToolNames,
      ],
      // 权限模式：使用 default 以确保 canUseTool 回调被调用
      // SDK 默认可能使用 bypassPermissions，导致 canUseTool 不被调用
      permissionMode: 'default',
      // 禁用不需要的工具
      // - Skill: 防止 SDK 调用本机全局 Skills（~/.claude/skills/）
      // - WebSearch/WebFetch: 当使用 Firecrawl 时禁用，否则启用
      disallowedTools: [
        'Skill',
        'EnterPlanMode',
        'ExitPlanMode',
        'TodoWrite',
        // 根据环境变量决定禁用哪个
        ...(useFirecrawl ? ['WebSearch', 'WebFetch'] : ['firecrawl'])
      ],
      // Sandbox 配置 - 配置 ripgrep 搜索超时
      // SDK 内置 Glob/Grep 工具默认超时 20 秒，大目录搜索容易超时
      sandbox: {
        ripgrep: {
          // 通过添加 --timeout 参数增加 ripgrep 超时时间（单位：秒）
          // 注意：这是 ripgrep 自身的超时，不是 SDK 的超时
          args: ['--timeout', '60'],  // ripgrep 搜索超时 60 秒
        },
      },
      // Agent Teams：如果有激活的团队，传入 subagent 定义（仅 Claude SDK 支持）
      ...(this.options.activeTeam
        ? {
            agents: buildSdkAgents(this.options.activeTeam),
            // 使用团队 orchestrator 的 maxTurns（如未设置则回退到默认值）
            maxTurns: this.options.activeTeam.orchestrator.maxTurns,
          }
        : {}),
      // 不加载任何文件系统配置（完全隔离模式）
      // - 不读取 ~/.claude/settings.json（不加载全局用户 Skills/插件配置）
      // - 不读取 .claude/settings.json（不加载项目级 SDK 设置）
      // - MantisBot 所有配置完全通过代码注入，不依赖文件系统
      settingSources: [],
      // 覆盖所有 SessionStart 及 SessionStart:resume hooks
      // 防止本机安装的插件（superpowers、firecrawl 等）注入系统提示词
      // 日志观察：插件使用 "SessionStart:resume" hook 事件注入，需同时覆盖
      hooks: {
        SessionStart: [
          {
            hooks: [async (_input: unknown) => ({ continue: true })]
          }
        ],
        // 覆盖 SessionStart:resume hook（resume 会话时触发）
        'SessionStart:resume': [
          {
            hooks: [async (_input: unknown) => ({ continue: true })]
          }
        ],
        // 覆盖 UserPromptSubmit hook（防止其他插件拦截用户消息）
        UserPromptSubmit: [
          {
            hooks: [async (_input: unknown) => ({})]
          }
        ],
      },
      // 只有在有 MCP 工具时才添加 mcpServers
      ...(mcpServer ? { mcpServers: { 'mantis-tools': mcpServer } } : {}),
      // 权限回调
      canUseTool: async (
        toolName: string,
        toolInput: unknown,
        { signal }: { signal: AbortSignal }
      ): Promise<PermissionResult> => {
        const resolvedName = String(toolName || 'unknown');
        const resolvedInput = toolInput && typeof toolInput === 'object'
          ? toolInput as Record<string, unknown>
          : { value: toolInput };

        console.log('[ClaudeAgentRunner] canUseTool called for:', resolvedName, 'approvalMode:', this.options.approvalMode, 'input:', JSON.stringify(resolvedInput).slice(0, 200));

        // AskUserQuestion 需要用户交互，任何模式下都需要询问
        if (resolvedName === 'AskUserQuestion' || resolvedName === 'askuserquestion') {
          console.log('[ClaudeAgentRunner] AskUserQuestion requires user interaction, sending permission request');
          const permissionRequest = this.createPermissionRequest(resolvedName, resolvedInput);
          this.emit('permissionRequest', permissionRequest);
          const result = await this.waitForPermission(permissionRequest.requestId);
          return result;
        }

        // 根据 approvalMode 决定权限策略
        const approvalMode = this.options.approvalMode;

        // auto 模式：自动批准所有工具（除 AskUserQuestion）
        if (approvalMode === 'auto') {
          console.log('[ClaudeAgentRunner] Auto-approving tool (mode=auto):', resolvedName);
          return { behavior: 'allow', updatedInput: resolvedInput };
        }

        // ask 模式：所有工具都需要用户确认
        if (approvalMode === 'ask') {
          console.log('[ClaudeAgentRunner] Asking permission for all tools (mode=ask):', resolvedName);
          const permissionRequest = this.createPermissionRequest(resolvedName, resolvedInput);
          this.emit('permissionRequest', permissionRequest);
          const result = await this.waitForPermission(permissionRequest.requestId);
          return result;
        }

        // dangerous 模式（默认）：Bash 检查命令内容，删除操作始终确认

        // 1. Bash/exec 工具：仅对危险命令模式需要确认
        if (BASH_TOOLS.has(resolvedName)) {
          const command = String(resolvedInput.command || resolvedInput.cmd || '');
          if (this.isDangerousBashCommand(command)) {
            console.log('[ClaudeAgentRunner] Dangerous bash command (mode=dangerous):', command.slice(0, 100));
            const permissionRequest = this.createPermissionRequest(resolvedName, resolvedInput);
            this.emit('permissionRequest', permissionRequest);
            const result = await this.waitForPermission(permissionRequest.requestId);
            return result;
          }
          console.log('[ClaudeAgentRunner] Safe bash command, allowing:', resolvedName);
          return { behavior: 'allow', updatedInput: resolvedInput };
        }

        // 2. 删除类工具：始终需要确认
        if (this.isDangerousTool(resolvedName)) {
          console.log('[ClaudeAgentRunner] Delete tool detected (mode=dangerous):', resolvedName);
          const permissionRequest = this.createPermissionRequest(resolvedName, resolvedInput);

          // 通过事件发出权限请求（供外部监听）
          this.emit('permissionRequest', permissionRequest);

          // 等待用户响应
          console.log('[ClaudeAgentRunner] Waiting for permission response, requestId:', permissionRequest.requestId);
          const result = await this.waitForPermission(permissionRequest.requestId);
          console.log('[ClaudeAgentRunner] Permission result:', result);
          return result;
        }

        console.log('[ClaudeAgentRunner] Non-dangerous tool, allowing (mode=dangerous):', resolvedName);
        return { behavior: 'allow', updatedInput: resolvedInput };
      },
    };

    // 迭代处理
    let iterations = 0;
    let messageIndex = 0;
    let currentToolName = '';  // 当前正在执行的工具名称
    let currentToolArgs: Record<string, unknown> | undefined;  // 当前工具参数
    const toolIdToInfo = new Map<string, { name: string; args?: Record<string, unknown> }>();  // toolId -> { name, args } 映射

    console.log('[ClaudeAgentRunner] streamRun started, loading SDK...');

    try {
      console.log('[ClaudeAgentRunner] Calling query API...');

      // 构建 query 参数
      const queryParams: Record<string, unknown> = {
        prompt: userMessage,
        options,
      };

      // 如果有之前的 session_id，使用 resume 继续同一会话
      // 注意：resume 必须添加到 options 对象中，而不是作为独立参数
      console.log('[ClaudeAgentRunner] Current claudeSessionId:', this.claudeSessionId);
      if (this.claudeSessionId) {
        console.log('[ClaudeAgentRunner] Resuming session:', this.claudeSessionId);
        options.resume = this.claudeSessionId;
      } else {
        console.log('[ClaudeAgentRunner] Starting NEW session (no previous session_id)');
      }

      const queryResult = query(queryParams as any);

      console.log('[ClaudeAgentRunner] Query result type:', typeof queryResult, queryResult ? 'object' : 'null');
      if (!queryResult || typeof queryResult !== 'object') {
        console.error('[ClaudeAgentRunner] Invalid query result:', queryResult);
        yield { type: 'complete' };
        return;
      }

      // 处理事件流
      console.log('[ClaudeAgentRunner] Starting to iterate events...');
      let eventCount = 0;
      // Agent Teams 调用追踪：tool_use_id → agent名称
      const agentCallMap = new Map<string, string>();
      const agentNames = this.options.activeTeam ? Object.keys(this.options.activeTeam.agents) : [];

      // 工具名称规范化：Claude Code SDK 中 MCP 工具名带有 mcp__<server>__<name> 前缀
      // 需要提取末尾的 <name> 部分与 agentNames 进行比对
      const getMcpBaseName = (toolName: string): string => {
        // 匹配 mcp__<server>__<basename> 格式，提取最后一段
        if (toolName.startsWith('mcp__') && toolName.includes('__', 5)) {
          const lastDoubleUnderscore = toolName.lastIndexOf('__');
          return toolName.slice(lastDoubleUnderscore + 2);
        }
        return toolName;
      };
      // 检查工具名（可能带 MCP 前缀）是否对应某个 agent
      const resolveAgentName = (toolName: string): string | null => {
        const baseName = getMcpBaseName(toolName);
        if (agentNames.includes(baseName)) return baseName;
        if (agentNames.includes(toolName)) return toolName;
        return null;
      };
      for await (const event of queryResult) {
        // 检查中断信号
        if (abortSignal?.aborted) {
          console.log('[ClaudeAgentRunner] Execution aborted by user');
          yield { type: 'error', content: '用户已停止对话' };
          return;
        }

        eventCount++;
        // 处理不同的事件类型
        const eventType = event.type;
        // 调试：打印所有事件（有助于排查参数问题）
        console.log('[ClaudeAgentRunner] Event', eventCount, 'type:', eventType, 'data:', JSON.stringify(event).slice(0, 500));

        // 检查迭代限制
        if (this.options.maxIterations > 0 && iterations >= this.options.maxIterations) {
          yield { type: 'complete', attachments: attachments.length > 0 ? attachments : undefined };
          return;
        }

        console.log('[ClaudeAgentRunner] Processing event type:', eventType);

        // 处理 system 事件（初始化等）
        if (eventType === 'system') {
          const subtype = event.subtype;
          if (subtype === 'init' && event.session_id) {
            // 保存 session_id 以便后续继续使用同一会话
            this.claudeSessionId = event.session_id;
            console.log('[ClaudeAgentRunner] Claude session initialized:', event.session_id);
          }
          continue;
        }

        // 处理 auth_status 事件（认证状态）
        if (eventType === 'auth_status') {
          if (event.error) {
            console.error('[ClaudeAgentRunner] Auth error:', event.error);
            yield { type: 'text', content: `\n\n[认证错误: ${event.error}]\n` };
          }
          continue;
        }

        if (eventType === 'message_create' || eventType === 'assistant') {
          // 处理消息内容
          const message = event.message || event;
          const contentArray = message?.content || [];

          for (const block of contentArray) {
            // Claude Agent SDK 的 assistant 事件包含完整消息内容（非流式增量）
            // 文本和思考内容直接在此处发送，不依赖 content_block_delta
            if (block.type === 'text' && block.text) {
              yield { type: 'text', content: block.text };
            } else if (block.type === 'thinking' && block.thinking) {
              yield { type: 'thinking', content: block.thinking };
            } else if (block.type === 'tool_use') {
              const toolName = block.name;
              const toolId = block.id;
              const toolInput = block.input;
              console.log('[ClaudeAgentRunner] Tool call:', toolName, 'id:', toolId, 'input:', JSON.stringify(toolInput)?.slice(0, 200));
              currentToolName = toolName;  // 保存工具名称
              currentToolArgs = toolInput;  // 保存工具参数
              if (toolId) {
                toolIdToInfo.set(toolId, { name: toolName, args: toolInput });  // 建立映射
              }
              // 检测是否是 Agent 团队调用（orchestrator 委派 subagent）
              // 注意：MCP 工具名带有 mcp__<server>__<name> 前缀，需用 resolveAgentName 规范化
              const resolvedAgent1 = toolId ? resolveAgentName(toolName) : null;
              if (toolId && resolvedAgent1) {
                agentCallMap.set(toolId, resolvedAgent1);
                // 提取 task 字段作为任务描述（MCP 工具包装器统一使用 { task } 参数）
                const taskDesc = typeof (toolInput as any)?.task === 'string' ? (toolInput as any).task : undefined;
                console.log(`[ClaudeAgentRunner] ✦ Agent invocation detected (message_create): ${resolvedAgent1} (raw: ${toolName}), task: ${taskDesc?.slice(0, 100)}`);
                yield { type: 'agent_invocation', agentId: toolId, agentName: resolvedAgent1, phase: 'start', content: taskDesc };
              } else if (toolName === 'Bash' && agentNames.length > 0 && typeof (toolInput as any)?.description === 'string') {
                // 检测通过 Bash description 标记的 agent 派遣（GLM 等非原生 subagent 模式）
                const desc: string = (toolInput as any).description;
                const matchedAgent = agentNames.find(n => desc.includes(n));
                if (matchedAgent && toolId) {
                  agentCallMap.set(toolId, matchedAgent);
                  yield { type: 'agent_invocation', agentId: toolId, agentName: matchedAgent, phase: 'start', content: desc };
                } else {
                  yield { type: 'tool_use', tool: toolName, toolId: toolId, args: toolInput };
                }
              } else {
                yield {
                  type: 'tool_use',
                  tool: toolName,
                  toolId: toolId,
                  args: toolInput,
                };
              }
            }
          }
        } else if (eventType === 'content_block_start') {
          // 内容块开始 - 可能是 tool_use 块
          const block = event.content_block;
          if (block?.type === 'tool_use') {
            const toolName = block.name;
            const toolId = block.id;
            const toolInput = block.input;
            console.log('[ClaudeAgentRunner] Tool block start:', toolName, 'id:', toolId);
            if (toolId && toolName) {
              toolIdToInfo.set(toolId, { name: toolName, args: toolInput });
              // 检测是否是 Agent 团队调用（content_block_start 中检测，作为备用路径）
              const resolvedAgent2 = resolveAgentName(toolName);
              if (resolvedAgent2 && !agentCallMap.has(toolId)) {
                agentCallMap.set(toolId, resolvedAgent2);
                const taskDesc = typeof (toolInput as any)?.task === 'string' ? (toolInput as any).task : undefined;
                console.log(`[ClaudeAgentRunner] ✦ Agent invocation detected (content_block_start): ${resolvedAgent2} (raw: ${toolName})`);
                yield { type: 'agent_invocation', agentId: toolId, agentName: resolvedAgent2, phase: 'start', content: taskDesc };
              }
            }
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta;
          const index = event.index;
          // 处理思考内容增量 - 单独作为 thinking 类型发送
          if (delta?.thinking) {
            yield { type: 'thinking', content: delta.thinking };
          }
          // 处理文本增量
          if (delta?.text) {
            yield { type: 'text', content: delta.text };
          }
          // 处理工具输入增量（可能包含部分 JSON）
          if (delta?.type === 'input_json_delta' && delta?.partial_json) {
            // 工具输入增量 - 通常不需要单独处理，完整输入会在 tool_use 事件中
          }
        } else if (eventType === 'content_block_stop') {
          // 内容块结束 - 工具执行可能已完成
          // 注意：SDK 内置工具的结果可能在下一个 assistant 消息或 user 消息中
        } else if (eventType === 'tool_use') {
          const toolName = event.tool_use?.name;
          const toolInput = event.tool_use?.input;
          const toolId = event.tool_use?.id;

          console.log(`[ClaudeAgentRunner] Tool call: ${toolName}`, 'id:', toolId, 'input:', JSON.stringify(toolInput)?.slice(0, 200));
          currentToolName = toolName || '';  // 保存工具名称
          currentToolArgs = toolInput;  // 保存工具参数
          if (toolId && toolName) {
            toolIdToInfo.set(toolId, { name: toolName, args: toolInput });  // 建立映射
          }

          // 检测是否是 Agent 团队调用（tool_use 事件中检测，作为备用路径）
          const resolvedAgent3 = toolId && toolName ? resolveAgentName(toolName) : null;
          if (toolId && toolName && resolvedAgent3 && !agentCallMap.has(toolId)) {
            agentCallMap.set(toolId, resolvedAgent3);
            const taskDesc = typeof (toolInput as any)?.task === 'string' ? (toolInput as any).task : undefined;
            console.log(`[ClaudeAgentRunner] ✦ Agent invocation detected (tool_use): ${resolvedAgent3} (raw: ${toolName}), task: ${taskDesc?.slice(0, 100)}`);
            yield { type: 'agent_invocation', agentId: toolId, agentName: resolvedAgent3, phase: 'start', content: taskDesc };
          } else if (toolName === 'Bash' && agentNames.length > 0 && typeof (toolInput as any)?.description === 'string' && toolId && !agentCallMap.has(toolId)) {
            const desc: string = (toolInput as any).description;
            const matchedAgent = agentNames.find(n => desc.includes(n));
            if (matchedAgent) {
              agentCallMap.set(toolId, matchedAgent);
              yield { type: 'agent_invocation', agentId: toolId, agentName: matchedAgent, phase: 'start', content: desc };
            } else {
              yield { type: 'tool_use', tool: toolName, toolId: toolId, args: toolInput };
            }
          } else {
            yield {
              type: 'tool_use',
              tool: toolName,
              toolId: toolId,
              args: toolInput,
            };
          }

          // 执行工具（这里会在 canUseTool 之后自动执行）
          // 注意：实际执行由 SDK 内部处理
        } else if (eventType === 'user') {
          // 处理工具结果（user 消息包含工具执行结果）
          const message = event.message || event;
          const contentArray = message?.content || [];

          for (const block of contentArray) {
            if (block.type === 'tool_result') {
              const resultContent = block.content;
              const toolUseId = block.tool_use_id;
              // 从映射中获取工具信息
              const toolInfo = toolUseId ? toolIdToInfo.get(toolUseId) : undefined;
              const toolName = toolInfo?.name || currentToolName || 'tool';
              const toolArgs = toolInfo?.args || currentToolArgs;
              console.log('[ClaudeAgentRunner] Tool result for', toolName, '(id:', toolUseId, ') args:', JSON.stringify(toolArgs)?.slice(0, 200), 'result:', resultContent?.slice?.(0, 100) || resultContent);
              // 检测是否是 Agent 调用的结果（subagent 完成）
              if (toolUseId && agentCallMap.has(toolUseId)) {
                const agentName = agentCallMap.get(toolUseId)!;
                agentCallMap.delete(toolUseId);
                yield { type: 'agent_invocation', agentId: toolUseId, agentName, phase: 'end' };
              } else {
                yield {
                  type: 'tool_result',
                  tool: toolName,
                  toolId: toolUseId,
                  args: toolArgs,  // 包含参数，前端可以从中提取命令
                  result: resultContent,
                };
              }
              // 清理映射
              if (toolUseId) {
                toolIdToInfo.delete(toolUseId);
              }
              currentToolName = '';  // 清空工具名称
              currentToolArgs = undefined;  // 清空工具参数
              iterations++;
            }
          }
        } else if (eventType === 'tool_use_output') {
          // 工具执行结果
          const toolResult = event.tool_use_output?.content?.[0]?.text;
          const toolUseId = event.tool_use_output?.tool_use_id;

          // 从映射中获取工具信息
          const toolInfo = toolUseId ? toolIdToInfo.get(toolUseId) : undefined;
          // 尝试从事件本身获取工具名称（MCP 工具可能在 output 事件中包含名称）
          const eventToolName = event.tool_use_output?.name || event.tool_name || event.name;
          const toolName = toolInfo?.name || currentToolName || eventToolName || 'tool';
          const toolArgs = toolInfo?.args || currentToolArgs;
          console.log(`[ClaudeAgentRunner] Tool result for`, toolName, '(id:', toolUseId, ') args:', JSON.stringify(toolArgs)?.slice(0, 200), 'result:', toolResult?.slice?.(0, 100) || toolResult);

          // 检测是否是 Agent 调用的结果（subagent 完成）
          if (toolUseId && agentCallMap.has(toolUseId)) {
            const agentName = agentCallMap.get(toolUseId)!;
            agentCallMap.delete(toolUseId);
            yield { type: 'agent_invocation', agentId: toolUseId, agentName, phase: 'end' };
          } else {
            yield {
              type: 'tool_result',
              tool: toolName,
              toolId: toolUseId,
              args: toolArgs,  // 包含参数，前端可以从中提取命令
              result: toolResult,
            };
          }
          // 清理映射
          if (toolUseId) {
            toolIdToInfo.delete(toolUseId);
          }
          currentToolName = '';  // 清空工具名称
          currentToolArgs = undefined;  // 清空工具参数

          // 继续迭代
          iterations++;
        } else if (eventType === 'result') {
          // 检测执行错误（如 session 过期、resume 失败等）
          if (event.is_error === true) {
            if (event.subtype === 'error_during_execution') {
              // resume 失败（服务端 session 已过期）：静默清空 sessionId 并用本地历史重试
              // 本地 conversationHistory 始终独立传入，降级后上下文依然连贯
              // 重试时 claudeSessionId 为 null，不会再触发同一错误，最多重试一次
              console.warn('[ClaudeAgentRunner] Session expired, silently retrying without resume...');
              this.claudeSessionId = null;
              yield* this.streamRun(userMessage, conversationHistory, abortSignal);
              return;
            }
            // 其他错误类型仍然向上报告
            console.error('[ClaudeAgentRunner] Execution error:', event.subtype);
            yield { type: 'error', content: `执行错误: ${event.subtype || 'unknown'}` };
            return;
          }
          // 最终结果 - 文本已经在 assistant 事件中发送，这里不再重复发送
          // 只发送 complete 事件表示结束
          console.log('[ClaudeAgentRunner] Result event, attachments count:', attachments.length);
          if (attachments.length > 0) {
            console.log('[ClaudeAgentRunner] Attachments:', JSON.stringify(attachments.map(a => ({ name: a.name, url: a.url }))));
          }
          yield { type: 'complete', attachments: attachments.length > 0 ? attachments : undefined };
          return;
        }
      }
    } catch (error) {
      console.error('[ClaudeAgentRunner] Error:', error);
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
        attachments: attachments.length > 0 ? attachments : undefined,
      } as StreamChunk;
    }
  }

  /**
   * 非流式运行（兼容旧 API）
   */
  async run(
    userMessage: string,
    conversationHistory: LLMMessage[] = []
  ): Promise<AgentResult> {
    let fullContent = '';
    const toolCalls: AgentResult['toolCalls'] = [];
    const attachments: FileAttachment[] = [];

    for await (const chunk of this.streamRun(userMessage, conversationHistory)) {
      if (chunk.type === 'text' && chunk.content) {
        fullContent += chunk.content;
      } else if (chunk.type === 'tool_result') {
        toolCalls.push({
          tool: chunk.tool || '',
          result: chunk.result,
        });
      } else if (chunk.type === 'complete' || chunk.type === 'error') {
        if (chunk.attachments) {
          attachments.push(...chunk.attachments);
        }
      }
    }

    return {
      response: fullContent,
      success: true,
      toolCalls,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  /**
   * 构建消息列表
   */
  private buildMessages(userMessage: string, history: LLMMessage[]): LLMMessage[] {
    const messages: LLMMessage[] = [];

    if (this.options.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.options.systemPrompt,
      });
    }

    messages.push(...history);
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    // 清除所有待处理的权限请求
    for (const [requestId, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.resolve({ behavior: 'deny', message: 'Agent disposed' });
    }
    this.pendingPermissions.clear();
    this.permissionOriginalInputs.clear();
  }
}
