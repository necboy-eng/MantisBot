// src/agents/protocol-transform.ts
// 协议双向转换：Anthropic Messages API ↔ OpenAI Chat Completions API
//
// 设计原则：
// - anthropicToOpenAI：将 Claude SDK 发出的 Anthropic 请求转换为 OpenAI 格式
// - processOpenAIStreamChunk：将 OpenAI SSE 流逐块转换为 Anthropic SSE 事件
//
// 参考：LobsterAI coworkFormatTransform.ts + coworkOpenAICompatProxy.ts

export type OpenAIStreamChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

/**
 * SSE 流转换状态机
 * 追踪当前处于哪个 Anthropic content block
 */
export type StreamState = {
  messageId: string | null;
  model: string | null;
  /** 当前 content_block 的全局索引（每次 block_stop 后 +1） */
  contentIndex: number;
  /** 当前打开的 block 类型 */
  currentBlockType: 'thinking' | 'text' | 'tool_use' | null;
  /** 当前打开的工具调用的 OpenAI toolCalls 数组下标 */
  activeToolIndex: number | null;
  /** 已识别的工具调用 meta，按 OpenAI delta index 索引 */
  toolCalls: Record<number, { id?: string; name?: string }>;
  /** 是否已发送 message_start */
  hasMessageStart: boolean;
};

export function createStreamState(): StreamState {
  return {
    messageId: null,
    model: null,
    contentIndex: 0,
    currentBlockType: null,
    activeToolIndex: null,
    toolCalls: {},
    hasMessageStart: false,
  };
}

// ─── 辅助：格式化 Anthropic SSE 事件 ─────────────────────────────────────────

export function formatAnthropicSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── 辅助：OpenAI finish_reason → Anthropic stop_reason ──────────────────────

export function mapStopReason(finishReason?: string | null): string {
  if (!finishReason) return 'end_turn';
  if (finishReason === 'tool_calls') return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  if (finishReason === 'stop') return 'end_turn';
  return finishReason;
}

// ─── 辅助：schema 清洗（移除 OpenAI 不接受的 Anthropic 特有字段）──────────────

function cleanSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }
  const obj = schema as Record<string, unknown>;
  const output: Record<string, unknown> = { ...obj };

  // OpenAI 不接受 format: 'uri'
  if (output.format === 'uri') {
    delete output.format;
  }

  if (output.properties && typeof output.properties === 'object') {
    const nextProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(output.properties as Record<string, unknown>)) {
      nextProps[k] = cleanSchema(v);
    }
    output.properties = nextProps;
  }

  if (output.items !== undefined) {
    output.items = cleanSchema(output.items);
  }

  return output;
}

// ─── 请求转换：Anthropic Messages → OpenAI Chat Completions ──────────────────

/**
 * 将 Anthropic Messages API 请求体转换为 OpenAI Chat Completions 请求体
 * @param body  Claude SDK 发送的原始 Anthropic 请求体
 * @param overrideModel  上游真实模型名（替换 Claude 模型名）
 */
export function anthropicToOpenAI(
  body: unknown,
  overrideModel: string
): Record<string, unknown> {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  // 使用上游真实模型名
  output.model = overrideModel;

  // ── 构建 messages ──────────────────────────────────────────────────────────
  const messages: Array<Record<string, unknown>> = [];

  // Anthropic system 字段 → OpenAI system message
  if (typeof src.system === 'string' && src.system) {
    messages.push({ role: 'system', content: src.system });
  } else if (Array.isArray(src.system)) {
    for (const item of src.system as unknown[]) {
      if (item && typeof item === 'object') {
        const block = item as Record<string, unknown>;
        if (typeof block.text === 'string' && block.text) {
          messages.push({ role: 'system', content: block.text });
        }
      }
    }
  }

  // Anthropic messages → OpenAI messages
  for (const msg of ((Array.isArray(src.messages) ? src.messages : []) as unknown[])) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    const role = typeof m.role === 'string' ? m.role : 'user';

    if (typeof m.content === 'string') {
      messages.push({ role, content: m.content });
      continue;
    }

    if (!Array.isArray(m.content)) {
      messages.push({ role, content: null });
      continue;
    }

    const contentParts: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const block of m.content as unknown[]) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      const bType = typeof b.type === 'string' ? b.type : '';

      if (bType === 'text') {
        const text = typeof b.text === 'string' ? b.text : '';
        if (text) contentParts.push({ type: 'text', text });
        continue;
      }

      if (bType === 'image') {
        const source = (b.source && typeof b.source === 'object' ? b.source : {}) as Record<string, unknown>;
        const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png';
        const data = typeof source.data === 'string' ? source.data : '';
        if (data) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${data}` },
          });
        }
        continue;
      }

      if (bType === 'tool_use') {
        const id = typeof b.id === 'string' ? b.id : '';
        const name = typeof b.name === 'string' ? b.name : '';
        toolCalls.push({
          id,
          type: 'function',
          function: {
            name,
            arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}),
          },
        });
        continue;
      }

      if (bType === 'tool_result') {
        const toolCallId = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
        const rawContent = b.content;

        // 处理 array content（可能包含 image blocks）
        if (Array.isArray(rawContent)) {
          const transformedParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
          for (const item of rawContent) {
            const itemType = typeof item.type === 'string' ? item.type : '';
            if (itemType === 'image') {
              // 转换 Anthropic image block 为 OpenAI image_url 格式
              const source = typeof item.source === 'object' && item.source ? item.source as Record<string, unknown> : {};
              const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png';
              const data = typeof source.data === 'string' ? source.data : '';
              if (data) {
                transformedParts.push({
                  type: 'image_url',
                  image_url: { url: `data:${mediaType};base64,${data}` },
                });
              }
            } else if (itemType === 'text') {
              const text = typeof item.text === 'string' ? item.text : '';
              if (text) transformedParts.push({ type: 'text', text });
            } else {
              // 其他类型转为 JSON 字符串
              transformedParts.push({ type: 'text', text: JSON.stringify(item) });
            }
          }
          messages.push({ role: 'tool', tool_call_id: toolCallId, content: transformedParts });
        } else {
          // 保持原有 string content 处理逻辑
          const toolContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
          messages.push({ role: 'tool', tool_call_id: toolCallId, content: toolContent });
        }
        continue;
      }
    }

    if (toolCalls.length > 0 || contentParts.length > 0) {
      const nextMsg: Record<string, unknown> = { role };
      nextMsg.content = contentParts.length === 1 && contentParts[0].type === 'text'
        ? contentParts[0].text
        : contentParts.length > 0
          ? contentParts
          : null;
      if (toolCalls.length > 0) {
        nextMsg.tool_calls = toolCalls;
      }
      messages.push(nextMsg);
    }
  }

  output.messages = messages;

  // ── 其他参数 ──────────────────────────────────────────────────────────────
  if (src.max_tokens !== undefined) output.max_tokens = src.max_tokens;
  if (src.temperature !== undefined) output.temperature = src.temperature;
  if (src.top_p !== undefined) output.top_p = src.top_p;
  if (src.stop_sequences !== undefined) output.stop = src.stop_sequences;
  if (src.stream !== undefined) output.stream = src.stream;

  // ── 工具 ──────────────────────────────────────────────────────────────────
  if (Array.isArray(src.tools)) {
    const tools = (src.tools as unknown[])
      .filter((t) => {
        if (!t || typeof t !== 'object') return false;
        // 过滤掉 Anthropic 内部的 BatchTool
        return (t as Record<string, unknown>).type !== 'BatchTool';
      })
      .map((t) => {
        const tool = t as Record<string, unknown>;
        return {
          type: 'function',
          function: {
            name: typeof tool.name === 'string' ? tool.name : '',
            description: tool.description,
            parameters: cleanSchema(tool.input_schema ?? {}),
          },
        };
      });

    if (tools.length > 0) {
      output.tools = tools;
    }
  }

  return output;
}

// ─── 响应转换：OpenAI SSE chunk → Anthropic SSE 事件串 ───────────────────────

/**
 * 处理单个 OpenAI SSE 数据块，生成对应的 Anthropic SSE 事件字符串
 * 维护状态机，确保 content block 生命周期正确。
 *
 * @param chunk  已解析的 OpenAI stream chunk 对象
 * @param state  当前流状态（会被就地修改）
 * @returns      拼接好的 Anthropic SSE 字符串（可直接写入响应流）
 */
export function processOpenAIStreamChunk(
  chunk: OpenAIStreamChunk,
  state: StreamState
): string {
  let output = '';

  // ── message_start（首块） ──────────────────────────────────────────────────
  if (!state.hasMessageStart) {
    state.messageId = chunk.id ?? `chatcmpl-${Date.now()}`;
    state.model = chunk.model ?? 'unknown';

    output += formatAnthropicSSEEvent('message_start', {
      type: 'message_start',
      message: {
        id: state.messageId,
        type: 'message',
        role: 'assistant',
        model: state.model,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    state.hasMessageStart = true;
  }

  const choice = chunk.choices?.[0];
  if (!choice) return output;

  const delta = choice.delta;

  // ── thinking delta（推理内容，如 QwQ / DeepSeek-R1）────────────────────────
  const reasoning = delta?.reasoning_content ?? delta?.reasoning;
  if (reasoning) {
    output += ensureBlock(state, 'thinking');
    output += formatAnthropicSSEEvent('content_block_delta', {
      type: 'content_block_delta',
      index: state.contentIndex,
      delta: { type: 'thinking_delta', thinking: reasoning },
    });
  }

  // ── text delta ─────────────────────────────────────────────────────────────
  if (delta?.content) {
    output += ensureBlock(state, 'text');
    output += formatAnthropicSSEEvent('content_block_delta', {
      type: 'content_block_delta',
      index: state.contentIndex,
      delta: { type: 'text_delta', text: delta.content },
    });
  }

  // ── tool_calls delta ───────────────────────────────────────────────────────
  if (Array.isArray(delta?.tool_calls)) {
    for (const item of delta!.tool_calls!) {
      const toolIndex = item.index ?? 0;

      // 更新工具调用元信息
      if (!state.toolCalls[toolIndex]) {
        state.toolCalls[toolIndex] = {};
      }
      const tc = state.toolCalls[toolIndex];
      if (item.id) tc.id = item.id;
      if (item.function?.name) tc.name = item.function.name;

      // 有名称时才需要开 tool_use block
      if (item.function?.name) {
        output += ensureToolBlock(state, toolIndex);
      }

      // 输出参数 delta
      if (item.function?.arguments) {
        output += ensureToolBlock(state, toolIndex);
        output += formatAnthropicSSEEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.contentIndex,
          delta: { type: 'input_json_delta', partial_json: item.function.arguments },
        });
      }
    }
  }

  // ── finish_reason → message_delta + message_stop ──────────────────────────
  if (choice.finish_reason) {
    // 先关闭当前打开的 block
    output += closeBlock(state);

    output += formatAnthropicSSEEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: mapStopReason(choice.finish_reason),
        stop_sequence: null,
      },
      usage: {
        input_tokens: chunk.usage?.prompt_tokens ?? 0,
        output_tokens: chunk.usage?.completion_tokens ?? 0,
      },
    });

    output += formatAnthropicSSEEvent('message_stop', {
      type: 'message_stop',
    });
  }

  return output;
}

// ─── 内部：block 状态管理辅助 ────────────────────────────────────────────────

/** 关闭当前打开的 block，返回 content_block_stop 事件字符串 */
function closeBlock(state: StreamState): string {
  if (!state.currentBlockType) return '';

  const output = formatAnthropicSSEEvent('content_block_stop', {
    type: 'content_block_stop',
    index: state.contentIndex,
  });

  state.contentIndex += 1;
  state.currentBlockType = null;
  state.activeToolIndex = null;

  return output;
}

/** 确保当前 block 是指定的简单类型（text / thinking），如需要则关旧开新 */
function ensureBlock(state: StreamState, type: 'text' | 'thinking'): string {
  if (state.currentBlockType === type) return '';

  let output = closeBlock(state);

  output += formatAnthropicSSEEvent('content_block_start', {
    type: 'content_block_start',
    index: state.contentIndex,
    content_block: type === 'text'
      ? { type: 'text', text: '' }
      : { type: 'thinking', thinking: '' },
  });

  state.currentBlockType = type;
  return output;
}

/** 确保当前 block 是指定下标的 tool_use block */
function ensureToolBlock(state: StreamState, toolIndex: number): string {
  if (state.currentBlockType === 'tool_use' && state.activeToolIndex === toolIndex) {
    return '';
  }

  let output = closeBlock(state);
  const tc = state.toolCalls[toolIndex] ?? {};
  const resolvedId = tc.id ?? `tool_call_${toolIndex}`;
  const resolvedName = tc.name ?? 'tool';

  output += formatAnthropicSSEEvent('content_block_start', {
    type: 'content_block_start',
    index: state.contentIndex,
    content_block: {
      type: 'tool_use',
      id: resolvedId,
      name: resolvedName,
    },
  });

  state.currentBlockType = 'tool_use';
  state.activeToolIndex = toolIndex;
  return output;
}

/**
 * 构建 OpenAI Chat Completions 端点 URL
 */
export function buildOpenAIChatCompletionsURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/chat/completions';
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}
