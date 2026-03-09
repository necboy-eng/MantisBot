// src/agents/openai-proxy.ts
// 本地 HTTP 代理：将 Claude SDK 的 Anthropic Messages API 请求
// 转发到 OpenAI 兼容后端，并在响应流上做协议转换。
//
// 设计原则：
// - 单例进程级代理，应用启动时启动，关闭时停止
// - 上游配置编码在 API Key 中（格式：proxy::<base64(JSON)>），天然支持多模型并发
//   Claude SDK 会把 ANTHROPIC_API_KEY 作为 x-api-key 头发送，代理解析它获取上游配置

import http from 'http';
import https from 'https';
import { randomUUID } from 'node:crypto';
import {
  anthropicToOpenAI,
  buildOpenAIChatCompletionsURL,
  createStreamState,
  processOpenAIStreamChunk,
} from './protocol-transform.js';

// ─── 上游配置编码 ─────────────────────────────────────────────────────────────
// Claude SDK 通过 ANTHROPIC_API_KEY 环境变量（最终变成 x-api-key 请求头）传递凭证。
// 当使用代理时，我们把上游配置编码到 apiKey 中，格式：
//   proxy::<base64(JSON{baseUrl, apiKey, model})>
// 代理服务器解析这个特殊格式来获取真实上游配置。

export const PROXY_KEY_PREFIX = 'proxy::';

export type UpstreamConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * 将上游配置编码为代理 API key 格式
 */
export function encodeUpstreamConfig(config: UpstreamConfig): string {
  return PROXY_KEY_PREFIX + Buffer.from(JSON.stringify(config)).toString('base64');
}

/**
 * 从代理 API key 中解析上游配置（如果不是代理格式则返回 null）
 */
export function decodeUpstreamConfig(apiKey: string | undefined): UpstreamConfig | null {
  if (!apiKey?.startsWith(PROXY_KEY_PREFIX)) return null;
  try {
    return JSON.parse(Buffer.from(apiKey.slice(PROXY_KEY_PREFIX.length), 'base64').toString('utf8')) as UpstreamConfig;
  } catch {
    return null;
  }
}

// ─── 代理状态 ─────────────────────────────────────────────────────────────────
let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
const PROXY_HOST = '127.0.0.1';

// ─── 视觉图片注册表 ───────────────────────────────────────────────────────────
// 用于在 http-server.ts 与 OpenAI Proxy 之间传递图片数据（绕过 Claude SDK 的 string-only prompt 限制）
// key: injectId（UUID）  value: 图片 content blocks 数组
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};

/** process.env 中用于传递本次请求图片注入 ID 的键名 */
export const VISION_INJECT_ENV_KEY = 'VISION_INJECT_ID' as const;

const pendingImages = new Map<string, ImageBlock[]>();

/**
 * 注册一组图片，返回 injectId（用作请求标识）
 * Proxy 收到带有此 ID 的请求时会自动注入图片到最后一条 user message
 */
export function registerPendingImages(images: ImageBlock[]): string {
  const id = randomUUID();
  pendingImages.set(id, images);
  // 30 秒后自动清理（防止泄漏）
  setTimeout(() => pendingImages.delete(id), 30_000);
  console.log(`[OpenAIProxy] Registered ${images.length} image(s) with id: ${id}`);
  return id;
}

/**
 * 消费已注册的图片（取出并删除）
 */
export function consumePendingImages(id: string): ImageBlock[] | null {
  const images = pendingImages.get(id) ?? null;
  if (images) pendingImages.delete(id);
  return images;
}

// ─── 生命周期 ─────────────────────────────────────────────────────────────────

/**
 * 启动本地代理服务器（随机端口）
 */
export async function startProxy(): Promise<void> {
  if (proxyServer) return;

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        const msg = err instanceof Error ? err.message : 'proxy error';
        console.error('[OpenAIProxy] Unhandled request error:', msg);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: msg } }));
        } else {
          res.end();
        }
      });
    });

    server.on('error', reject);

    server.listen(0, PROXY_HOST, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('[OpenAIProxy] Failed to bind port'));
        return;
      }
      proxyServer = server;
      proxyPort = addr.port;
      console.log(`[OpenAIProxy] Started on ${PROXY_HOST}:${proxyPort}`);
      resolve();
    });
  });
}

/**
 * 停止本地代理服务器
 */
export async function stopProxy(): Promise<void> {
  if (!proxyServer) return;
  const server = proxyServer;
  proxyServer = null;
  proxyPort = null;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  console.log('[OpenAIProxy] Stopped');
}

/**
 * 获取代理的 base URL（供 ClaudeAgentRunner 注入）
 */
export function getProxyBaseURL(): string | null {
  if (!proxyPort) return null;
  return `http://${PROXY_HOST}:${proxyPort}`;
}

// ─── 请求处理 ─────────────────────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // 只处理 POST /v1/messages
  if (req.method !== 'POST' || !req.url?.includes('/messages')) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  // 从 x-api-key 或 Authorization: Bearer 头中解析上游配置
  const rawApiKey = (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '')
    || (typeof req.headers['authorization'] === 'string'
      ? req.headers['authorization'].replace(/^Bearer\s+/i, '')
      : '');

  const upstream = decodeUpstreamConfig(rawApiKey);

  if (!upstream) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'invalid_request',
        message: 'API key does not contain encoded upstream config. Expected format: proxy::<base64>',
      },
    }));
    return;
  }

  const { baseUrl: upstreamBaseURL, apiKey: upstreamApiKey, model: upstreamModel } = upstream;

  // 读取请求体
  const rawBody = await readBody(req);
  let anthropicBody: unknown;
  try {
    anthropicBody = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_json', message: 'Request body is not valid JSON' } }));
    return;
  }

  const isStream = !!(anthropicBody as Record<string, unknown>)?.stream;

  // ── 视觉图片注入：从进程级 Map 中取出图片并注入到最后一条 user message ────────
  // 使用 process.env[VISION_INJECT_ENV_KEY] 传递（与 Proxy 同属同一 Node.js 进程）
  const injectId = process.env[VISION_INJECT_ENV_KEY] ?? null;

  if (injectId) {
    // 立即清空，避免影响后续请求（只对第一次 LLM 调用生效）
    delete process.env[VISION_INJECT_ENV_KEY];
    console.log(`[OpenAIProxy] Consumed VISION_INJECT_ID: ${injectId}`);

    const images = consumePendingImages(injectId);
    if (images && images.length > 0) {
      const body = anthropicBody as Record<string, unknown>;
      const msgs = body.messages as Array<Record<string, unknown>> | undefined;
      if (msgs && msgs.length > 0) {
        // 找到最后一条 user 消息，将图片 blocks 追加到其 content 中
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            const existingContent = msgs[i].content;
            const textBlocks: Array<Record<string, unknown>> = typeof existingContent === 'string'
              ? [{ type: 'text', text: existingContent }]
              : Array.isArray(existingContent) ? existingContent as Array<Record<string, unknown>> : [];
            // 追加图片 blocks（Anthropic 格式，protocol-transform 会转成 OpenAI image_url）
            msgs[i].content = [...textBlocks, ...images];
            console.log(`[OpenAIProxy] Injected ${images.length} image(s) into message[${i}]`);
            break;
          }
        }
      }
    } else {
      console.warn(`[OpenAIProxy] No images found for inject-id: ${injectId}`);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // 转换请求格式
  const openAIBody = anthropicToOpenAI(anthropicBody, upstreamModel);
  if (isStream) {
    openAIBody.stream = true;
    // 某些后端需要 stream_options 来获取 usage
    openAIBody.stream_options = { include_usage: true };
  }

  const targetURL = buildOpenAIChatCompletionsURL(upstreamBaseURL);
  console.log(`[OpenAIProxy] → ${upstreamModel} @ ${targetURL}`);

  // 转发到上游（透传 SDK 发来的请求头，供需要识别 agent 身份的上游端点使用）
  await forwardToUpstream(targetURL, upstreamApiKey, openAIBody, isStream, res, req.headers);
}

// ─── 转发与响应转换 ───────────────────────────────────────────────────────────

// 从 SDK 来的请求头中，透传给上游的白名单（供 coding 端点识别 agent 身份）
const PASSTHROUGH_HEADERS = new Set([
  'x-app',
  'user-agent',
  'anthropic-beta',
  'anthropic-version',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-os',
  'x-stainless-arch',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
]);

async function forwardToUpstream(
  targetURL: string,
  apiKey: string,
  body: unknown,
  isStream: boolean,
  clientRes: http.ServerResponse,
  incomingHeaders?: http.IncomingHttpHeaders
): Promise<void> {
  const bodyStr = JSON.stringify(body);
  const url = new URL(targetURL);
  const isHttps = url.protocol === 'https:';

  // 基础请求头 + 白名单透传头
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
    'Authorization': `Bearer ${apiKey}`,
  };
  if (incomingHeaders) {
    for (const [key, val] of Object.entries(incomingHeaders)) {
      if (PASSTHROUGH_HEADERS.has(key.toLowerCase()) && typeof val === 'string') {
        headers[key] = val;
      }
    }
  }

  const requestOptions: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers,
  };

  console.log(`[OpenAIProxy] → upstream ${url.hostname}${requestOptions.path} headers:`, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey.slice(0, 8)}...`,
    ...(incomingHeaders?.['x-app'] ? { 'x-app': incomingHeaders['x-app'] } : {}),
    ...(incomingHeaders?.['anthropic-beta'] ? { 'anthropic-beta': incomingHeaders['anthropic-beta'] } : {}),
  });

  return new Promise<void>((resolve, reject) => {
    const transport = isHttps ? https : http;
    const upstreamReq = transport.request(requestOptions, (upstreamRes) => {
      if (isStream) {
        handleStreamResponse(upstreamRes, clientRes).then(resolve).catch(reject);
      } else {
        handleNonStreamResponse(upstreamRes, clientRes).then(resolve).catch(reject);
      }
    });

    upstreamReq.on('error', (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          error: { type: 'upstream_error', message: err.message },
        }));
      }
      reject(err);
    });

    upstreamReq.write(bodyStr);
    upstreamReq.end();
  });
}

async function handleStreamResponse(
  upstreamRes: http.IncomingMessage,
  clientRes: http.ServerResponse
): Promise<void> {
  if (!isSuccessStatus(upstreamRes.statusCode)) {
    // 上游错误：转换为 Anthropic 错误格式返回
    const errorBody = await readStream(upstreamRes);
    const anthropicError = toAnthropicError(upstreamRes.statusCode ?? 500, errorBody);
    clientRes.writeHead(upstreamRes.statusCode ?? 500, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(anthropicError));
    return;
  }

  // 发送 Anthropic 流式响应头
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const state = createStreamState();
  let buffer = '';

  return new Promise<void>((resolve, reject) => {
    upstreamRes.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');

      // 处理 SSE 包（以 \n\n 分隔）
      while (true) {
        const boundaryIdx = buffer.indexOf('\n\n');
        if (boundaryIdx === -1) break;

        const packet = buffer.slice(0, boundaryIdx);
        buffer = buffer.slice(boundaryIdx + 2);

        const dataLine = extractSSEData(packet);
        if (!dataLine || dataLine === '[DONE]') continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        const anthropicSSE = processOpenAIStreamChunk(
          parsed as Parameters<typeof processOpenAIStreamChunk>[0],
          state
        );
        if (anthropicSSE) {
          clientRes.write(anthropicSSE);
        }
      }
    });

    upstreamRes.on('end', () => {
      clientRes.end();
      resolve();
    });

    upstreamRes.on('error', reject);
  });
}

async function handleNonStreamResponse(
  upstreamRes: http.IncomingMessage,
  clientRes: http.ServerResponse
): Promise<void> {
  const body = await readStream(upstreamRes);

  if (!isSuccessStatus(upstreamRes.statusCode)) {
    const anthropicError = toAnthropicError(upstreamRes.statusCode ?? 500, body);
    clientRes.writeHead(upstreamRes.statusCode ?? 500, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(anthropicError));
    return;
  }

  // 非流式：将 OpenAI 响应转换为 Anthropic Messages 响应
  let openAIResp: unknown;
  try {
    openAIResp = JSON.parse(body);
  } catch {
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: { type: 'parse_error', message: 'Invalid upstream response' } }));
    return;
  }

  const anthropicResp = openAIResponseToAnthropic(openAIResp);
  clientRes.writeHead(200, { 'Content-Type': 'application/json' });
  clientRes.end(JSON.stringify(anthropicResp));
}

// ─── 非流式响应转换 ────────────────────────────────────────────────────────────

function openAIResponseToAnthropic(body: unknown): Record<string, unknown> {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const choices = Array.isArray(src.choices) ? src.choices : [];
  const firstChoice = (choices[0] && typeof choices[0] === 'object' ? choices[0] : {}) as Record<string, unknown>;
  const message = (firstChoice.message && typeof firstChoice.message === 'object'
    ? firstChoice.message
    : {}) as Record<string, unknown>;

  const content: Array<Record<string, unknown>> = [];

  // 文本内容
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // 工具调用
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (!tc || typeof tc !== 'object') continue;
      const t = tc as Record<string, unknown>;
      const fn = (t.function && typeof t.function === 'object' ? t.function : {}) as Record<string, unknown>;
      let args: unknown = {};
      try {
        args = JSON.parse(typeof fn.arguments === 'string' ? fn.arguments : '{}');
      } catch { /* keep {} */ }
      content.push({
        type: 'tool_use',
        id: typeof t.id === 'string' ? t.id : `tool_${Date.now()}`,
        name: typeof fn.name === 'string' ? fn.name : '',
        input: args,
      });
    }
  }

  const usage = (src.usage && typeof src.usage === 'object' ? src.usage : {}) as Record<string, unknown>;
  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null;

  return {
    id: typeof src.id === 'string' ? src.id : `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: typeof src.model === 'string' ? src.model : 'unknown',
    stop_reason: finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
  };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将上游错误响应转换为 Anthropic 标准错误格式
 * Claude SDK 只能正确处理符合 Anthropic 格式的错误响应
 */
function toAnthropicError(statusCode: number, rawBody: string): Record<string, unknown> {
  // 尝试解析上游错误信息
  let message = `Upstream error (HTTP ${statusCode})`;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    // OpenAI 格式: { error: { message: "..." } }
    const errObj = parsed.error;
    if (errObj && typeof errObj === 'object') {
      const e = errObj as Record<string, unknown>;
      if (typeof e.message === 'string') message = e.message;
    } else if (typeof errObj === 'string') {
      message = errObj;
    } else if (typeof parsed.message === 'string') {
      message = parsed.message;
    }
  } catch { /* 非 JSON 则用默认消息 */ }

  // 映射 HTTP 状态码到 Anthropic 错误类型
  let errorType = 'api_error';
  if (statusCode === 400) errorType = 'invalid_request_error';
  else if (statusCode === 401) errorType = 'authentication_error';
  else if (statusCode === 403) errorType = 'permission_error';
  else if (statusCode === 404) errorType = 'not_found_error';
  else if (statusCode === 429) errorType = 'rate_limit_error';

  return {
    type: 'error',
    error: { type: errorType, message },
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readStream(stream: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function extractSSEData(packet: string): string | null {
  for (const line of packet.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      return line.slice(5).trimStart();
    }
  }
  return null;
}

function isSuccessStatus(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 200 && code < 300;
}
