// src/agents/agent-runner.ts

import type { LLMMessage, FileAttachment } from '../types.js';
import { ToolRegistry } from './tools/registry.js';
import { getLLMClient } from './llm-client.js';
import type { GlobalErrorHandler } from '../reliability/global-error-handler.js';
import { getHooksLoader } from '../hooks/loader.js';

export interface AgentOptions {
  model?: string;                      // 指定模型（可选）
  systemPrompt?: string;               // 自定义系统提示词（可选）
  maxIterations?: number;              // 最大迭代次数（0 = 无限制，默认 0）
  enableUnderstanding?: boolean;       // 是否启用理解需求提示词（仅流式，默认 true）
}

export interface AgentResult {
  response: string;
  success: boolean;
  toolCalls?: { tool: string; result: unknown }[];
  attachments?: FileAttachment[];      // 新增：文件附件支持
}

/**
 * 工具结果截断配置
 */
const MAX_TOOL_RESULT_CHARS = 6000;
const MIN_KEEP_CHARS = 1000;
const TRUNCATION_SUFFIX = `\n\n⚠️ [结果已截断 - 原始��容过大。如需更多内容，请明确指定需要哪部分。]`;

/**
 * 截断过大的工具结果文本
 */
function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) {
    return content;
  }

  const keepChars = Math.max(MIN_KEEP_CHARS, MAX_TOOL_RESULT_CHARS - TRUNCATION_SUFFIX.length);

  // 尽量在换行符处截断
  let cutPoint = keepChars;
  const lastNewline = content.lastIndexOf('\n', keepChars);
  if (lastNewline > keepChars * 0.8) {
    cutPoint = lastNewline;
  }

  return content.slice(0, cutPoint) + TRUNCATION_SUFFIX;
}

/**
 * 辅助函数：从工具结果中收集附件（含去重：基于 URL）
 */
function collectAttachments(result: unknown, attachments: FileAttachment[]): void {
  if (result && typeof result === 'object') {
    let newItems: FileAttachment[] = [];

    // 如果结果有 attachments 字段
    if ('attachments' in result && Array.isArray(result.attachments)) {
      newItems = result.attachments as FileAttachment[];
    }
    // 如果结果本身就是 FileAttachment 数组
    else if (Array.isArray(result) && result.length > 0 && 'url' in result[0]) {
      newItems = result as FileAttachment[];
    }
    // 如果结果是单个 FileAttachment
    else if ('url' in result && 'name' in result && !Array.isArray(result)) {
      newItems = [result as FileAttachment];
    }

    // 去重：跳过已经收集过（相同 URL）的附件
    const existingUrls = new Set(attachments.map(a => a.url));
    for (const item of newItems) {
      if (!existingUrls.has(item.url)) {
        attachments.push(item);
        existingUrls.add(item.url);
      } else {
        console.log(`[AgentRunner] 跳过重复附件: ${item.name} (${item.url})`);
      }
    }
  }
}

/**
 * Agent Runner - 支持工具调用的智能体（支持流��和非流式）
 *
 * 核心功能：
 * 1. 无迭代次数限制（可配置）
 * 2. 支持文件附件收集
 * 3. 工具结果自动截断（6K 字符）
 * 4. 支持流式和非流式处理
 * 5. 可选的"理解需求"提示词（仅流式模式）
 */
export class AgentRunner {
  private toolRegistry: ToolRegistry;
  private options: {
    model?: string;
    systemPrompt: string;
    maxIterations: number;
    enableUnderstanding: boolean;
  };
  private errorHandler?: GlobalErrorHandler;

  constructor(
    toolRegistry: ToolRegistry,
    options: AgentOptions = {},
    errorHandler?: GlobalErrorHandler
  ) {
    this.toolRegistry = toolRegistry;
    this.options = {
      model: options.model,
      systemPrompt: options.systemPrompt || '',  // 空字符串表示不添加
      maxIterations: options.maxIterations || 0, // 0 = 无限制
      enableUnderstanding: options.enableUnderstanding ?? false,
    };
    this.errorHandler = errorHandler;
  }

  /**
   * 非流式处理（兼容旧 API）
   */
  async run(
    userMessage: string,
    conversationHistory: LLMMessage[] = []
  ): Promise<AgentResult> {
    const llm = getLLMClient();
    const toolCalls: AgentResult['toolCalls'] = [];
    const attachments: FileAttachment[] = [];

    // 构建消息列表
    const messages: LLMMessage[] = this.buildMessages(userMessage, conversationHistory);

    // 获取可用工具
    const tools = this.toolRegistry.listTools();

    // 第一轮：发送消息给 LLM
    let llmResponse = await llm.chat(messages, this.options.model, tools);

    // 迭代处理工具调用
    let iterations = 0;
    while (true) {
      // 检查迭代限制（0 = 无限制）
      if (this.options.maxIterations > 0 && iterations >= this.options.maxIterations) {
        return {
          response: llmResponse.content || '已达到最大迭代次数',
          success: false,
          toolCalls,
          attachments: attachments.length > 0 ? attachments : undefined,
        };
      }

      // 如果 LLM 没有调用工具，直接返回
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        return {
          response: llmResponse.content,
          success: true,
          toolCalls,
          attachments: attachments.length > 0 ? attachments : undefined,
        };
      }

      // 处理工具调用
      for (const toolCall of llmResponse.toolCalls) {
        const startTime = Date.now();
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[AgentRunner] 🔧 Tool Call Started`);
        console.log(`  Tool Name: ${toolCall.name}`);
        console.log(`  Tool ID: ${toolCall.id}`);
        console.log(`  Arguments:`, JSON.stringify(toolCall.arguments, null, 2));
        console.log(`${'='.repeat(80)}`);

        try {
          const result = await this.toolRegistry.executeTool(
            toolCall.name,
            toolCall.arguments
          );

          const duration = Date.now() - startTime;

          // 详细的结果日志
          console.log(`\n[AgentRunner] ✅ Tool Execution Completed`);
          console.log(`  Tool: ${toolCall.name}`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Result Preview:`);

          // 根据结果类型显示不同的预览
          if (result && typeof result === 'object') {
            const resultStr = JSON.stringify(result, null, 2);
            const previewLines = resultStr.split('\n').slice(0, 10);
            console.log('  ' + previewLines.map(line => '  ' + line).join('\n'));
            if (resultStr.split('\n').length > 10) {
              console.log('  ... (truncated, total lines: ' + resultStr.split('\n').length + ')');
            }
          } else {
            console.log('  ', result);
          }
          console.log(`${'='.repeat(80)}\n`);

          toolCalls.push({
            tool: toolCall.name,
            result,
          });

          // 触发 tool.called hook（成功）
          try {
            getHooksLoader().emit('tool.called', {
              tool: toolCall.name,
              result,
              isError: false,
            });
          } catch { /* hook 错误不阻塞主流程 */ }

          // 收集附件
          collectAttachments(result, attachments);

          // 添加工具调用和结果到消息列表（标准格式）
          messages.push({
            role: 'assistant',
            content: llmResponse.content || '',
            tool_calls: [{
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            }],
          });

          // 向 LLM 发送工具结果时，优先使用 message 字段（简洁文本），
          // 避免把包含大量附件元数据的完整 JSON 传回给 LLM 引起截断和重试
          const resultForLLM = (result && typeof result === 'object' && 'message' in result)
            ? { message: (result as Record<string, unknown>).message, sent: (result as Record<string, unknown>).sent }
            : result;
          const resultStr = JSON.stringify(resultForLLM);
          const truncatedResult = truncateToolResult(resultStr);

          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,  // 使用标准字段名
            content: truncatedResult,
          });
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`\n[AgentRunner] ❌ Tool Execution Failed`);
          console.error(`  Tool: ${toolCall.name}`);
          console.error(`  Duration: ${duration}ms`);
          console.error(`  Error:`, error);
          console.error(`${'='.repeat(80)}\n`);

          // 触发 tool.called hook（失败）
          const errorMessage = String(error);
          try {
            getHooksLoader().emit('tool.called', {
              tool: toolCall.name,
              result: { error: errorMessage },
              isError: true,
            });
          } catch { /* hook 错误不阻塞主流程 */ }

          // 使用GlobalErrorHandler处理错误（简化版本）
          let finalErrorMessage = errorMessage;
          if (this.errorHandler) {
            try {
              // 简化错误处理：只记录错误，不执行复杂逻辑
              console.log(`[AgentRunner] Error handler processing tool error: ${toolCall.name}`);
              // 可以在这里添加错误分类和记录逻辑
              finalErrorMessage = `Tool execution failed: ${errorMessage}`;
            } catch (handlerError) {
              console.error('[AgentRunner] Error handler failed:', handlerError);
            }
          }

          messages.push({
            role: 'assistant',
            content: llmResponse.content || '',
          });
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: `Error: ${finalErrorMessage}`,
          });
        }
      }

      // 再次调用 LLM
      llmResponse = await llm.chat(messages, this.options.model, tools);
      iterations++;
    }
  }

  /**
   * 流式处理（新增）
   */
  async *streamRun(
    userMessage: string,
    conversationHistory: LLMMessage[] = []
  ): AsyncGenerator<{
    type: 'text' | 'tool_start' | 'tool_end' | 'done';
    content?: string;
    tool?: string;
    args?: Record<string, unknown>;  // 新增：工具参数
    result?: unknown;
    attachments?: FileAttachment[];
  }> {
    const llm = getLLMClient();
    const attachments: FileAttachment[] = [];

    // 构建消息列表
    const messages: LLMMessage[] = this.buildMessages(userMessage, conversationHistory);

    // 获取可用工具
    const tools = this.toolRegistry.listTools();

    // 过滤函数：移除模型输出的工具调用文本格式
    const filterToolCallText = (text: string): string => {
      return text
        .replace(/<FunctionCall>[\s\S]*?(?=\n\n|$)/gi, '')  // 移除 <FunctionCall> 块
        .replace(/\{'tool'\s*=>\s*'[^']*'/gi, '')  // 移除 {'tool' => 'xxx'
        .replace(/\{'name'\s*=>\s*'[^']*'/gi, '')  // 移除 {'name' => 'xxx'
        .replace(/\{'arguments'\s*=>/gi, '');  // 移除 {'arguments' =>
    };

    // 第一步：快速生成"理解需求"回复（如果启用）
    if (this.options.enableUnderstanding) {
      const understandingPrompt: LLMMessage[] = [
        { role: 'system', content: '你是一个简洁的助手。请用简短的一句话复述你理解到的用户需求，只复述用户想要什么。回复不超过30个字。' },
        ...conversationHistory.filter(m => m.role !== 'system'),
        { role: 'user', content: userMessage },
      ];

      let understandingText = '';
      for await (const chunk of llm.streamChat(understandingPrompt, this.options.model, undefined)) {
        if (chunk.type === 'text' && chunk.content) {
          const filteredContent = filterToolCallText(chunk.content);
          understandingText += filteredContent;
          if (filteredContent) {
            yield { type: 'text', content: filteredContent };
          }
          if (understandingText.length > 30) break;
        }
      }

      yield { type: 'text', content: '\n\n' };
    }

    // 第二步：正常处理任务
    let iterations = 0;
    while (true) {
      // 检查迭代限制
      if (this.options.maxIterations > 0 && iterations >= this.options.maxIterations) {
        yield { type: 'done', attachments: attachments.length > 0 ? attachments : undefined };
        return;
      }

      let fullContent = '';
      const toolCalls: { id: string; name: string; arguments: string }[] = [];

      // 流式调用 LLM
      for await (const chunk of llm.streamChat(messages, this.options.model, tools)) {
        if (chunk.type === 'text' && chunk.content) {
          const filteredContent = filterToolCallText(chunk.content);
          fullContent += filteredContent;
          if (filteredContent) {
            yield { type: 'text', content: filteredContent };
          }
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        }
      }

      // 没有工具调用，完成
      if (toolCalls.length === 0) {
        yield { type: 'done', attachments: attachments.length > 0 ? attachments : undefined };
        return;
      }

      // 处理工具调用
      for (const tc of toolCalls) {
        const startTime = Date.now();

        try {
          const args = JSON.parse(tc.arguments);

          // 详细日志：工具调用开始
          console.log(`\n${'='.repeat(80)}`);
          console.log(`[AgentRunner Stream] 🔧 Tool Call Started`);
          console.log(`  Tool Name: ${tc.name}`);
          console.log(`  Tool ID: ${tc.id}`);
          console.log(`  Arguments:`, JSON.stringify(args, null, 2));
          console.log(`${'='.repeat(80)}`);

          yield { type: 'tool_start', tool: tc.name, args };  // 传递工具参数

          const result = await this.toolRegistry.executeTool(tc.name, args);

          const duration = Date.now() - startTime;

          // 详细日志：工具调用完成
          console.log(`\n[AgentRunner Stream] ✅ Tool Execution Completed`);
          console.log(`  Tool: ${tc.name}`);
          console.log(`  Duration: ${duration}ms`);
          console.log(`  Result Preview:`);

          // 根据结果类型显示不同的预览
          if (result && typeof result === 'object') {
            const resultStr = JSON.stringify(result, null, 2);
            const previewLines = resultStr.split('\n').slice(0, 10);
            console.log('  ' + previewLines.map(line => '  ' + line).join('\n'));
            if (resultStr.split('\n').length > 10) {
              console.log('  ... (truncated, total lines: ' + resultStr.split('\n').length + ')');
            }
          } else {
            console.log('  ', result);
          }
          console.log(`${'='.repeat(80)}\n`);

          // 收集附件
          collectAttachments(result, attachments);

          // 向 LLM 发送工具结果时，优先使用 message 字段（简洁文本），
          // 避免把包含大量附件元数据的完整 JSON 传回给 LLM 引起截断和重试
          const resultForLLM = (result && typeof result === 'object' && 'message' in result)
            ? { message: (result as Record<string, unknown>).message, sent: (result as Record<string, unknown>).sent }
            : result;

          // 截断工具结果
          const resultStr = JSON.stringify(resultForLLM);
          const truncatedResult = truncateToolResult(resultStr);

          // 添加到消息列表（标准格式）
          messages.push({
            role: 'assistant',
            content: fullContent,
            tool_calls: [{ id: tc.id, name: tc.name, arguments: args }],
          });
          messages.push({
            role: 'tool',
            toolCallId: tc.id,  // 使用标准字段名
            content: truncatedResult,
          });

          yield { type: 'tool_end', tool: tc.name, args, result };
        } catch (error) {
          const duration = Date.now() - startTime;

          // 详细日志：工具调用失败
          console.error(`\n[AgentRunner Stream] ❌ Tool Execution Failed`);
          console.error(`  Tool: ${tc.name}`);
          console.error(`  Duration: ${duration}ms`);
          console.error(`  Error:`, error);
          console.error(`${'='.repeat(80)}\n`);

          // 尝试解析 args（如果 JSON.parse 失败，使用空对象）
          let args = {};
          try {
            args = JSON.parse(tc.arguments);
          } catch {
            args = {};
          }

          // 使用GlobalErrorHandler处理错误（简化版本）
          let errorMessage = String(error);
          if (this.errorHandler) {
            try {
              console.log(`[AgentRunner Stream] Error handler processing tool error: ${tc.name}`);
              errorMessage = `Tool execution failed: ${errorMessage}`;
            } catch (handlerError) {
              console.error('[AgentRunner Stream] Error handler failed:', handlerError);
            }
          }

          messages.push({
            role: 'assistant',
            content: fullContent,
            tool_calls: [{ id: tc.id, name: tc.name, arguments: args }],
          });
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `Error: ${errorMessage}`,
          });

          yield { type: 'tool_end', tool: tc.name, args, result: { error: errorMessage } };
        }
      }

      iterations++;
      // 继续循环，LLM 会基于工具结果继续生成
    }
  }

  /**
   * 构建消息列表（统一逻辑）
   */
  private buildMessages(userMessage: string, history: LLMMessage[]): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 如果有自定义系统提示词，添加到开头
    if (this.options.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.options.systemPrompt,
      });
    }

    // 添加历史记录
    messages.push(...history);

    // 添加用户消息
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }

  /**
   * 简单对话（不带工具）
   */
  async simpleChat(message: string): Promise<string> {
    const llm = getLLMClient();
    return llm.simpleChat(message);
  }
}
