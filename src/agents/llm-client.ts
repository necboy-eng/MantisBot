import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/loader.js';
import { PROVIDER_DEFAULTS } from '../config/schema.js';
import type { ToolInfo } from '../types.js';
import { ProfileLoader } from './profile-loader.js';
import { workDirManager } from '../workdir/manager.js';
import { getGlobalPluginLoader } from '../plugins/loader.js';
import { getSkillsLoader } from './tools/read-skill.js';
import { formatSkillsForPrompt } from '@mariozechner/pi-coding-agent';
// import type { CircuitBreakerService } from '../reliability/circuit-breaker.js';
// import type { RetryService } from '../reliability/retry-service.js';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
  name?: string;  // 用于 tool 角色的工具名称
  toolCallId?: string;  // 用于 tool 角色的工具调用 ID
}

export interface LLMResponse {
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
}

// Skills 提示词（从 SkillsLoader 获取）
let skillsPromptContent: string = '';
let pluginSkillsPromptContent: string = '';  // 缓存 plugin skills prompt

// 设置 skills 提示词
export function setSkillsPrompt(prompt: string): void {
  skillsPromptContent = prompt;
}

/**
 * 获取格式化后的 plugin skills prompt
 * 用于 ClaudeAgentRunner 等需要单独获取的场景
 */
export function getPluginSkillsPrompt(): string {
  return pluginSkillsPromptContent;
}

/**
 * 刷新 skills 提示词（从 PluginLoader 和 SkillsLoader 重新获取）
 * 在 toggle 插件后调用此函数
 */
export function refreshSkillsPrompt(): void {
  const config = getConfig();
  const enabledSkills = config.enabledSkills || [];

  // 获取 standalone skill 对象（按 enabledSkills 过滤）
  const skillsLoader = getSkillsLoader();
  const standaloneSkillObjs = skillsLoader
    ? skillsLoader.list().map(ls => ls.skill).filter(s => enabledSkills.includes(s.name))
    : [];
  console.log(`[LLMClient] Standalone skills: ${standaloneSkillObjs.map(s => s.name).join(', ') || '(none)'}`);

  // 获取 plugin skills，转换为 pi-coding-agent 格式
  const pluginLoader = getGlobalPluginLoader();
  const pluginSkills = pluginLoader?.getSkills() || [];
  console.log(`[LLMClient] Plugin skills count: ${pluginSkills.length}`);
  if (pluginSkills.length > 0) {
    console.log(`[LLMClient] Plugin skills: ${pluginSkills.map(s => s.name).join(', ')}`);
  }

  const formattedPluginSkills = pluginSkills.map(s => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    baseDir: '',
    source: `plugin:${s.pluginName}`,
    disableModelInvocation: false,
  }));

  // 合并后统一格式化为单个 <available_skills> 块，避免出现多个同名 XML 块
  const allSkills = [...standaloneSkillObjs, ...formattedPluginSkills];
  const combinedSkillsPrompt = formatSkillsForPrompt(allSkills);
  console.log(`[LLMClient] Skills prompt refreshed: ${combinedSkillsPrompt.length} chars (${standaloneSkillObjs.length} standalone + ${formattedPluginSkills.length} plugin)`);

  // 缓存 plugin-only 提示词供 ClaudeAgentRunner 使用（其系统提示词中单独追加）
  pluginSkillsPromptContent = formatSkillsForPrompt(formattedPluginSkills);

  setSkillsPrompt(combinedSkillsPrompt);
}

// 获取包含 skills 的系统提示词
async function getSystemPrompt(tools?: ToolInfo[]): Promise<string> {
  // 获取 Profile 内容
  const profileLoader = new ProfileLoader();
  const profilePrompt = await profileLoader.getProfilePrompt();

  const skillsSection = skillsPromptContent ? `
## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with \`read_skill\` tool, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
${skillsPromptContent}
` : '';

  // 动态生成工具列表
  let toolsSection = '';
  if (tools && tools.length > 0) {
    const toolDescriptions = tools.map(t => {
      // 从参数定义中提取简短描述
      const hasDesc = t.description || '无描述';
      return `- ${t.name}: ${hasDesc}`;
    }).join('\n');

    toolsSection = `
## 可用工具
以下工具已通过 API 提供，你可以直接调用：

${toolDescriptions}

使用工具时，请根据工具的参数定义提供正确的参数。`;
  } else {
    // 如果没有传入工具列表，使用默认提示
    toolsSection = `
## 可用工具
工具列表将通过 API 动态提供。请根据可用的工具定义来决定使用哪些工具。`;
  }

  // 获取当前工作目录
  const currentWorkDir = workDirManager.getCurrentWorkDir();

  // 获取当前时间信息
  const now = new Date();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const weekDay = weekDays[now.getDay()];
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');

  // 计算本周的范围
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const formatDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  const thisWeekRange = `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}`;


  return `你是一个智能助手，可以帮助用户完成各种任务。

当前时间：${year}年${month}月${date}日 星期${weekDay} ${hours}:${minutes}
本周范围：${thisWeekRange}

当前工作目录：${currentWorkDir}

文件操作规范：
- 【重要】创建新文件时，必须默认放到工作目录下
- 例如：创建 test.txt 应使用路径 ${currentWorkDir}/test.txt
- 只有用户明确指定其他位置时，才使用其他路径
- 读取和编辑文件优先在工作目录中查找
- 命令执行（exec, Bash）也在此目录下进行

如需切换工作目录，请告知用户在界面上点击工作目录路径进行切换

当用户需要你执行特定操作时，你应该：
1. 理解用户的需求
2. 检查是否有匹配的技能（查看 <available_skills> 列表）
3. 如果有匹配的技能，使用 read_skill 工具读取技能文件
4. 按照技能文件中的指令执行操作
5. 返回结果给用户

重要提醒：
- 当你使用工具（如 write）生成文件后，必须使用 send_file 工具将文件发送给用户
- 这包括 HTML、Office 文档、图片、PDF 等任何生成的文件
- 只有将文件作为附件发送，用户才能在界面中预览和下载

浏览器操作规范（重要）：
当用户请求浏览网页、访问网站或查看页面时，必须执行以下步骤：
1. 使用 browser_launch 启动浏览器（首次操作时）
2. 使用 browser_navigate 导航到目标网址
3. 使用 browser_snapshot 获取页面文本内容（用于理解页面）
4. 【必须】使用 browser_screenshot 截取页面截图，向用户展示页面外观
5. 向用户报告页面内容和操作结果

关键要求：
- browser_screenshot 是必需的步骤，用于让用户直观地看到页面
- 即使页面内容已通过 browser_snapshot 获取，也必须调用 browser_screenshot
- 截图会自动显示在用户的浏览器界面中，提供可视化反馈
- 在执行搜索、点击等操作后，也应该调用 browser_screenshot 展示结果页面
${toolsSection}${skillsSection}${profilePrompt}`;
}

// 根据模型配置判断使用哪个 SDK
// 优先使用 protocol 字段，其次使用 provider 字段推断
function getSDKType(modelName: string): 'anthropic' | 'openai' {
  const config = getConfig();
  const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);

  if (!modelConfig) {
    console.warn(`[LLM] Model not found in config: ${modelName}, defaulting to OpenAI`);
    return 'openai';
  }

  const mc = modelConfig as any;

  // 1. 优先使用 protocol 字段
  if (mc.protocol) {
    console.log(`[LLM] Using ${mc.protocol} SDK for model: ${modelName} (from protocol field)`);
    return mc.protocol;
  }

  // 2. 使用 provider 字段推断协议
  if (mc.provider && PROVIDER_DEFAULTS[mc.provider]) {
    const protocol = PROVIDER_DEFAULTS[mc.provider].defaultProtocol;
    console.log(`[LLM] Using ${protocol} SDK for model: ${modelName} (from provider: ${mc.provider})`);
    return protocol;
  }

  console.log(`[LLM] Using OpenAI SDK for model: ${modelName} (default)`);
  return 'openai';
}

// 获取模型的 baseURL（统一处理 baseUrl/baseURL/endpoint，并支持提供商默认值）
function getModelBaseURL(modelName: string): string | undefined {
  const config = getConfig();
  const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);

  if (!modelConfig) return undefined;

  const mc = modelConfig as any;

  // 1. 优先使用用户配置的端点（依次检查 baseURL, baseUrl, endpoint）
  const customEndpoint = mc.baseURL || mc.baseUrl || mc.endpoint;
  if (customEndpoint) {
    return customEndpoint;
  }

  // 2. 使用提供商的默认端点（根据协议选择）
  if (mc.provider && PROVIDER_DEFAULTS[mc.provider]) {
    const protocol: 'openai' | 'anthropic' = mc.protocol || PROVIDER_DEFAULTS[mc.provider].defaultProtocol;
    return PROVIDER_DEFAULTS[mc.provider][protocol];
  }

  return undefined;
}

// 超时和重试配置
const LLM_REQUEST_TIMEOUT_MS = 120000; // 2分钟超时
const LLM_MAX_RETRIES = 2;
const LLM_RETRY_DELAY_MS = 1000;

// 延迟工具函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class LLMClient {
  private openAIClients: Map<string, OpenAI> = new Map();
  private anthropicClients: Map<string, Anthropic> = new Map();
  // private circuitBreakerService?: CircuitBreakerService;
  // private retryService?: RetryService;

  constructor(
    // circuitBreakerService?: CircuitBreakerService,
    // retryService?: RetryService
  ) {
    // this.circuitBreakerService = circuitBreakerService;
    // this.retryService = retryService;
  }

  // 超时控制包装器
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = LLM_REQUEST_TIMEOUT_MS,
    operationName: string = 'LLM request'
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} 超时（${timeoutMs / 1000}秒）`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  // 带重试的请求
  private async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string = 'LLM request',
    maxRetries: number = LLM_MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.withTimeout(fn(), LLM_REQUEST_TIMEOUT_MS, operationName);
      } catch (error: any) {
        lastError = error;

        // 判断是否是可重试的���误（网络错误、超时、5xx 服务器错误）
        const isRetryable =
          error?.code === 'ETIMEDOUT' ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ENOTFOUND' ||
          error?.message?.includes('timeout') ||
          error?.message?.includes('网络') ||
          (error?.status >= 500 && error?.status < 600);

        if (!isRetryable || attempt === maxRetries) {
          console.error(`[LLM] ${operationName} 失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error?.message);
          throw error;
        }

        const delayMs = LLM_RETRY_DELAY_MS * Math.pow(2, attempt); // 指数退避
        console.warn(
          `[LLM] ${operationName} 失败 (尝试 ${attempt + 1}/${maxRetries + 1})，` +
          `${delayMs}ms 后重试: ${error?.message}`
        );
        await delay(delayMs);
      }
    }

    throw lastError;
  }

  getOpenAIClient(modelName: string): OpenAI | null {
    if (this.openAIClients.has(modelName)) {
      return this.openAIClients.get(modelName)!;
    }

    const config = getConfig();
    const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);
    if (!modelConfig) {
      console.error(`[LLM] Model not found: ${modelName}`);
      return null;
    }

    const baseURL = getModelBaseURL(modelName);
    console.log(`[LLM] Creating OpenAI client for ${modelName}: baseURL=${baseURL}`);

    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: baseURL || undefined,
    });

    this.openAIClients.set(modelName, client);
    return client;
  }

  getAnthropicClient(modelName: string): Anthropic | null {
    if (this.anthropicClients.has(modelName)) {
      return this.anthropicClients.get(modelName)!;
    }

    const config = getConfig();
    const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);
    if (!modelConfig) {
      console.error(`[LLM] Model config not found: ${modelName}`);
      console.log('[LLM] Available models:', config.models.map((m: any) => m.name));
      return null;
    }

    const baseURL = getModelBaseURL(modelName) || 'https://api.anthropic.com';
    console.log(`[LLM] Creating Anthropic client for ${modelName}: baseURL=${baseURL}`);

    // MiniMax (minimaxi.com) 和 GLM (bigmodel.cn) 需要使用 Authorization: Bearer header
    // 而不是默认的 x-api-key
    const isMiniMax = baseURL.includes('minimaxi.com');
    const isGLM = baseURL.includes('bigmodel.cn');
    const needsBearerAuth = isMiniMax || isGLM;

    const client = new Anthropic({
      apiKey: needsBearerAuth ? 'placeholder' : modelConfig.apiKey,
      baseURL: baseURL,
      defaultHeaders: needsBearerAuth ? {
        'Authorization': `Bearer ${modelConfig.apiKey}`
      } : undefined,
    });

    console.log('[LLM] Anthropic client created:', !!client);

    this.anthropicClients.set(modelName, client);
    return client;
  }

  /**
   * 使用 Anthropic SDK 调用兼容 Anthropic 协议的模型（如 MiniMax、GLM）
   */
  async chatWithAnthropic(
    messages: LLMMessage[],
    modelName: string,
    tools?: ToolInfo[]
  ): Promise<LLMResponse> {
    const config = getConfig();
    const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);

    if (!modelConfig) {
      throw new Error(`Model config not found: ${modelName}`);
    }

    const client = this.getAnthropicClient(modelName);
    if (!client) {
      throw new Error(`Failed to create Anthropic client for: ${modelName}`);
    }

    const apiModel = modelConfig.model || modelName;
    console.log(`[LLM] Using Anthropic SDK: model=${apiModel}, tools=${tools?.length || 0}`);

    // 检查是否有自定义系统提示词
    const customSystemPrompt = messages.length > 0 && messages[0].role === 'system'
      ? messages[0].content
      : null;

    // 转换消息格式为 Anthropic 格式
    const anthropicMessages: { role: 'user' | 'assistant'; content: any }[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'tool') {
        // 工具结果消息 - Anthropic 使用 tool_result 类型
        console.log(`[LLM] Processing tool result:`, { toolCallId: msg.toolCallId, contentLength: msg.content?.length });
        const toolResultContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (!msg.toolCallId) {
          console.error('[LLM] ERROR: tool result missing toolCallId (tool_use_id)');
        }

        // 检查上一条消息是否已经包含对应的 tool_use
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        const hasToolUse = lastMsg &&
          lastMsg.role === 'assistant' &&
          Array.isArray(lastMsg.content) &&
          lastMsg.content.some((c: any) => c.type === 'tool_use' && c.id === msg.toolCallId);

        // 如果上一条消息没有对应的 tool_use，需要添加一个
        if (!hasToolUse && msg.toolCallId) {
          console.log('[LLM] WARNING: Adding tool_use for tool result based on toolCallId');
          anthropicMessages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: msg.toolCallId,
                name: 'unknown',
                input: {}
              }
            ] as any
          });
        }

        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || 'unknown',
              content: toolResultContent
            }
          ] as any
        });
      } else {
        // 用户或助手消息
        if (msg.role === 'assistant' && msg.tool_calls) {
          // 助手消息包含工具调用 - 需要转换为 Anthropic 格式
          console.log(`[LLM] Processing assistant with tool_calls:`, msg.tool_calls.map(tc => ({ id: tc.id, name: tc.name })));
          const content: any[] = [];
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id || `tool_${Date.now()}`,
              name: tc.name,
              input: tc.arguments
            });
          }
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          anthropicMessages.push({ role: 'assistant', content: content as any });
        } else {
          anthropicMessages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          });
        }
      }
    }

    console.log(`[LLM] Total messages: ${anthropicMessages.length}`);

    // 构建工具定义
    let anthropicTools: any[] | undefined;
    if (tools && tools.length > 0) {
      anthropicTools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    // 获取系统提示词（在重试外部获取，避免重复调用）
    const systemPrompt = customSystemPrompt || await getSystemPrompt(tools);

    try {
      // 使用 withRetry 包装 API 调用
      const message = await this.withRetry(
        async () => {
          // @ts-ignore - Anthropic SDK 类型问题
          return client.messages.create({
            model: apiModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages: anthropicMessages,
            tools: anthropicTools
          });
        },
        `Anthropic API (${apiModel})`
      );

      // 提取文本内容和工具调用
      let content = '';
      const toolCalls: { name: string; arguments: Record<string, unknown>; id: string }[] = [];

      for (const block of message.content) {
        if (block.type === 'text') {
          content += (block as any).text;
        } else if (block.type === 'tool_use') {
          // 工具调用请求
          const toolBlock = block as any;
          const toolId = toolBlock.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          toolCalls.push({
            id: toolId,
            name: toolBlock.name,
            arguments: toolBlock.input
          });
        }
      }

      if (toolCalls.length > 0) {
        console.log(`[LLM] Tool calls:`, toolCalls);
        return {
          content,
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          }))
        };
      }

      return { content };
    } catch (error: any) {
      console.error('[LLM] MiniMax API Error:', error);
      console.error('[LLM] Error message:', error?.message);
      console.error('[LLM] Error status:', error?.status);
      console.error('[LLM] Error response:', error?.response?.data);
      throw error;
    }
  }

  /**
   * 发送对话请求
   */
  async chat(
    messages: LLMMessage[],
    modelName?: string,
    tools?: ToolInfo[]
  ): Promise<LLMResponse> {
    const config = getConfig();
    const model = modelName || config.models[0]?.name || 'qwen-plus';

    // 根据模型 type 选择 SDK
    const sdkType = getSDKType(model);
    if (sdkType === 'anthropic') {
      return this.chatWithAnthropic(messages, model, tools);
    }

    const client = this.getOpenAIClient(model);

    if (!client) {
      throw new Error(`No available LLM client for model: ${model}`);
    }

    // 查找对应的模型名称
    const modelConfig = config.models.find((m: { name: string }) => m.name === model);
    const apiModel = modelConfig?.model || model;

    console.log(`[LLM] Using model: ${apiModel}`);

    // 构建消息 - 如果调用者已提供系统消息则使用，否则使用默认的
    // 注意：需要保留 tool_calls 和 toolCallId 字段
    const hasSystemMessage = messages.length > 0 && messages[0].role === 'system';
    const chatMessages = hasSystemMessage
      ? messages.map(m => {
          const msg: any = { role: m.role, content: m.content };
          if (m.role === 'assistant' && (m as any).tool_calls) {
            // OpenAI API 要求 arguments 是 JSON 字符串
            msg.tool_calls = (m as any).tool_calls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
              }
            }));
          }
          if (m.role === 'tool') {
            msg.tool_call_id = (m as any).toolCallId;
          }
          return msg;
        })
      : [
          { role: 'system' as const, content: await getSystemPrompt(tools) },
          ...messages.map(m => {
            const msg: any = { role: m.role, content: m.content };
            if (m.role === 'assistant' && (m as any).tool_calls) {
              // OpenAI API 要求 arguments 是 JSON 字符串
              msg.tool_calls = (m as any).tool_calls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                }
              }));
            }
            if (m.role === 'tool') {
              msg.tool_call_id = (m as any).toolCallId;
            }
            return msg;
          })
        ];

    // 构建工具
    let chatTools: any = undefined;
    if (tools && tools.length > 0) {
      chatTools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    try {
      // 使用 withRetry 包装 API 调用
      const response = await this.withRetry(
        // @ts-ignore - 简化类型处理
        async () => client.chat.completions.create({
          model: apiModel,
          messages: chatMessages as any,
          tools: chatTools as any,
          temperature: 0.7,
        }),
        `OpenAI API (${apiModel})`
      );

      const message = response.choices[0]?.message;
      if (!message) {
        throw new Error('No response from LLM');
      }

      // 处理工具调用
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[LLM] Tool calls:`, message.tool_calls);
        return {
          content: message.content || '',
          toolCalls: message.tool_calls.map(tc => ({
            id: tc.id || `tool_${Date.now()}`,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
          }))
        };
      }

      return {
        content: message.content || ''
      };
    } catch (error) {
      console.error('[LLM] Error:', error);
      throw error;
    }
  }

  /**
   * 简单的对话（不带工具）
   */
  async simpleChat(message: string, history: LLMMessage[] = []): Promise<string> {
    const config = getConfig();
    const model = config.models[0]?.name || 'qwen-plus';

    const messages: LLMMessage[] = [
      { role: 'system', content: await getSystemPrompt() },  // simpleChat 没有工具，不传
      ...history,
      { role: 'user', content: message }
    ];

    const response = await this.chat(messages, model);
    return response.content;
  }

  /**
   * 流式对话 - OpenAI 兼容模型
   */
  async *streamChatOpenAI(
    messages: LLMMessage[],
    modelName: string,
    tools?: ToolInfo[]
  ): AsyncGenerator<{ type: 'text' | 'tool_call'; content?: string; toolCall?: { id: string; name: string; arguments: string } }> {
    const config = getConfig();
    const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);
    const apiModel = modelConfig?.model || modelName;

    const client = this.getOpenAIClient(modelName);
    if (!client) {
      throw new Error(`No OpenAI client for model: ${modelName}`);
    }

    // 构建消息 - 如果调用者已提供系统消息则使用，否则使用默认的
    // 注意：需要保留 tool_calls 和 toolCallId 字段
    const hasSystemMessage = messages.length > 0 && messages[0].role === 'system';
    const chatMessages = hasSystemMessage
      ? messages.map(m => {
          const msg: any = { role: m.role, content: m.content };
          if (m.role === 'assistant' && (m as any).tool_calls) {
            msg.tool_calls = (m as any).tool_calls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
              }
            }));
          }
          if (m.role === 'tool') {
            msg.tool_call_id = (m as any).toolCallId;
          }
          return msg;
        })
      : [
          { role: 'system' as const, content: await getSystemPrompt(tools) },
          ...messages.map(m => {
            const msg: any = { role: m.role, content: m.content };
            if (m.role === 'assistant' && (m as any).tool_calls) {
              msg.tool_calls = (m as any).tool_calls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                }
              }));
            }
            if (m.role === 'tool') {
              msg.tool_call_id = (m as any).toolCallId;
            }
            return msg;
          })
        ];

    // 构建工具
    let chatTools: any = undefined;
    if (tools && tools.length > 0) {
      chatTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }

    // @ts-ignore
    const stream = await client.chat.completions.create({
      model: apiModel,
      messages: chatMessages,
      tools: chatTools,
      temperature: 0.7,
      stream: true,
    });

    let currentToolCall: { id: string; name: string; arguments: string } | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // 处理文本内容
      if (delta.content) {
        yield { type: 'text', content: delta.content };
      }

      // 处理工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            // 新工具调用开始
            if (currentToolCall) {
              yield { type: 'tool_call', toolCall: currentToolCall };
            }
            currentToolCall = {
              id: tc.id || `tool_${Date.now()}`,
              name: tc.function.name,
              arguments: tc.function.arguments || ''
            };
          } else if (currentToolCall && tc.function?.arguments) {
            // 追加参数
            currentToolCall.arguments += tc.function.arguments;
          }
        }
      }
    }

    // 输出最后一个工具调用
    if (currentToolCall) {
      yield { type: 'tool_call', toolCall: currentToolCall };
    }
  }

  /**
   * 流式对话 - Anthropic/MiniMax 模型
   */
  async *streamChatAnthropic(
    messages: LLMMessage[],
    modelName: string,
    tools?: ToolInfo[]
  ): AsyncGenerator<{ type: 'text' | 'tool_call'; content?: string; toolCall?: { id: string; name: string; arguments: string } }> {
    const config = getConfig();
    const modelConfig = config.models.find((m: { name: string }) => m.name === modelName);
    const apiModel = modelConfig?.model || modelName;

    const client = this.getAnthropicClient(modelName);
    if (!client) {
      throw new Error(`No Anthropic client for model: ${modelName}`);
    }

    // 检查是否有自定义系统提示词
    const customSystemPrompt = messages.length > 0 && messages[0].role === 'system'
      ? messages[0].content
      : null;

    // 转换消息格式
    const anthropicMessages: { role: 'user' | 'assistant'; content: any }[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId || msg.name || 'unknown', content: msg.content }]
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        const content = msg.tool_calls.map(tc => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments
        }));
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    // 构建工具定义
    let anthropicTools: any[] | undefined;
    if (tools && tools.length > 0) {
      anthropicTools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    // @ts-ignore
    const stream = client.messages.stream({
      model: apiModel,
      max_tokens: 4096,
      system: customSystemPrompt || await getSystemPrompt(tools),
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    // 跟踪正在构建的工具调用
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    // 使用 iterated messages
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as any;
        const index = event.index;

        if (delta?.type === 'text_delta') {
          yield { type: 'text', content: delta.text };
        } else if (delta?.type === 'input_json_delta') {
          // 累积工具调用参数
          const pending = pendingToolCalls.get(index);
          if (pending) {
            pending.arguments += delta.partial_json || '';
          }
        }
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        // 开始新的工具调用
        const block = event.content_block as any;
        pendingToolCalls.set(event.index, {
          id: block.id,
          name: block.name,
          arguments: ''
        });
      } else if (event.type === 'content_block_stop') {
        // 工具调用完成，输出结果
        const pending = pendingToolCalls.get(event.index);
        if (pending) {
          yield {
            type: 'tool_call',
            toolCall: { id: pending.id, name: pending.name, arguments: pending.arguments }
          };
          pendingToolCalls.delete(event.index);
        }
      }
    }

    // 输出任何剩余的工具调用（以防 content_block_stop 没有触发）
    for (const [, toolCall] of pendingToolCalls) {
      yield { type: 'tool_call', toolCall };
    }
  }

  /**
   * 流式对话 - 统一接口
   */
  async *streamChat(
    messages: LLMMessage[],
    modelName?: string,
    tools?: ToolInfo[]
  ): AsyncGenerator<{ type: 'text' | 'tool_call'; content?: string; toolCall?: { id: string; name: string; arguments: string } }> {
    const config = getConfig();
    const model = modelName || config.models[0]?.name || 'qwen-plus';

    // 根据模型 type 选择 SDK
    const sdkType = getSDKType(model);
    if (sdkType === 'anthropic') {
      yield* this.streamChatAnthropic(messages, model, tools);
    } else {
      yield* this.streamChatOpenAI(messages, model, tools);
    }
  }

  /**
   * 根据用户的第一条消息生成会话标题
   */
  async generateTitle(userMessage: string, modelName?: string): Promise<string> {
    const config = getConfig();
    const model = modelName || config.models[0]?.name || 'qwen-plus';

    const systemPrompt = `你是一个对话标题生成器。根据用户的提问，生成一个简短（不超过20字）且描述性的标题。不要使用引号或其他修饰符，直接输出标题。`;

    const userContent = `请为以下对话生成标题：${userMessage}`;

    try {
      const response = await this.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        model
      );

      const title = response.content.trim().replace(/^["']|["']$/g, '');
      return title.slice(0, 30); // 限制标题长度
    } catch (error) {
      console.error('[LLM] Failed to generate title:', error);
      // 失败时使用默认标题
      return `对话 ${new Date().toLocaleString('zh-CN')}`;
    }
  }

  // 清理客户端缓存，用于配置更新后热加载
  clearCache(): void {
    this.openAIClients.clear();
    this.anthropicClients.clear();
    console.log('[LLM] Client cache cleared for hot reload');
  }
}

// 单例
let llmClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  return llmClient;
}

// 清理 LLM 客户端缓存，用于配置更新后热加载
export function clearLLMClientCache(): void {
  if (llmClient) {
    llmClient.clearCache();
  }
}
