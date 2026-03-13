// src/plugins/feishu-advanced/tool-client.ts

import * as Lark from '@larksuiteoapi/node-sdk';
import { getRequiredScopes } from './scope-manager.js';
import { getUATStore } from '../../agents/tools/feishu/uat-store.js';
import { UserAuthRequiredError, LarkApiError } from './auth-errors.js';
import type { FeishuChannelConfig } from './types.js';

/**
 * Per-request options returned by `Lark.withUserAccessToken()`.
 */
type LarkRequestOptions = ReturnType<typeof Lark.withUserAccessToken>;

/**
 * 工具调用选项
 */
export interface InvokeOptions {
  /** 使用用户身份还是租户身份，默认 'user' */
  as?: 'user' | 'tenant';
  /** 指定用户的 Open ID，默认使用 senderOpenId */
  userOpenId?: string;
  /** 是否禁用自动重试 */
  noRetry?: boolean;
}

/**
 * invokeByPath() 的选项 — 在 InvokeOptions 基础上增加 HTTP 请求参数
 */
export interface InvokeByPathOptions extends InvokeOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string>;
  /** 自定义请求 header */
  headers?: Record<string, string>;
}

/**
 * 工具调用上下文
 */
export interface ToolCallContext {
  /** 发送者 Open ID */
  senderOpenId?: string;
  /** 聊天 ID */
  chatId?: string;
  /** 额外上下文信息 */
  extra?: Record<string, unknown>;
}

/**
 * invoke() 的回调签名
 *
 * - UAT 模式：`opts` 为 `Lark.withUserAccessToken(token)`，需传给 SDK 方法；`uat` 为 User Access Token 原始字符串
 * - TAT 模式：`opts` 为 `undefined`，SDK 默认走应用身份；`uat` 也为 `undefined`
 */
export type InvokeFn<T> = (sdk: Lark.Client, opts?: LarkRequestOptions, uat?: string) => Promise<T>;

/**
 * 统一飞书工具客户端
 *
 * 提供统一的 API 调用入口，自动处理：
 * - TAT（租户访问令牌）/ UAT（用户访问令牌）切换
 * - Scope 权限检查
 * - 错误处理和重试
 */
export class ToolClient {
  readonly sdk: Lark.Client;
  readonly senderOpenId: string | undefined;
  readonly feishuConfig: FeishuChannelConfig;
  readonly context: ToolCallContext;

  constructor(params: {
    sdk: Lark.Client;
    senderOpenId?: string;
    feishuConfig: FeishuChannelConfig;
    context?: ToolCallContext;
  }) {
    this.sdk = params.sdk;
    this.senderOpenId = params.senderOpenId;
    this.feishuConfig = params.feishuConfig;
    this.context = params.context ?? {};
  }

  /**
   * 统一 API 调用入口
   *
   * @param apiName API 名称（用于权限检查和日志）
   * @param fn 实际的 API 调用函数
   * @param options 调用选项
   *
   * @example
   * ```ts
   * const result = await client.invoke(
   *   'feishu_bitable_app_table_record.list',
   *   async (sdk, opts) => {
   *     return await sdk.bitable.appTableRecord.search({
   *       path: { app_token: 'xxx', table_id: 'xxx' },
   *       ...opts
   *     });
   *   },
   *   { as: 'user' }
   * );
   * ```
   */
  async invoke<T>(
    apiName: string,
    fn: InvokeFn<T>,
    options?: InvokeOptions
  ): Promise<T> {
    const tokenType = options?.as ?? 'user';
    const requiredScopes = getRequiredScopes(apiName);

    // TAT 模式（应用身份）
    if (tokenType === 'tenant') {
      return fn(this.sdk);
    }

    // UAT 模式（用户身份）
    const userOpenId = options?.userOpenId ?? this.senderOpenId;
    if (!userOpenId) {
      throw new UserAuthRequiredError('unknown', {
        apiName,
        scopes: requiredScopes,
      });
    }

    return this.invokeWithUAT(userOpenId, fn, apiName, requiredScopes);
  }

  /**
   * 使用 UAT（用户访问令牌）调用 API
   */
  private async invokeWithUAT<T>(
    userOpenId: string,
    fn: InvokeFn<T>,
    apiName: string,
    requiredScopes: string[]
  ): Promise<T> {
    // 获取 UAT
    const uatStore = getUATStore();
    const uat = await uatStore.getUAT(userOpenId, this.feishuConfig.appId);

    if (!uat) {
      throw new UserAuthRequiredError(userOpenId, {
        apiName,
        scopes: requiredScopes,
      });
    }

    try {
      // 使用 Lark.withUserAccessToken() 创建选项
      return await fn(this.sdk, Lark.withUserAccessToken(uat.accessToken), uat.accessToken);
    } catch (error: any) {
      // 处理 UAT 过期或无效
      if (this.isTokenInvalidError(error)) {
        console.log(`[ToolClient] UAT invalid for user=${userOpenId}, clearing cache`);
        await uatStore.deleteUAT(userOpenId, this.feishuConfig.appId);
        throw new UserAuthRequiredError(userOpenId, {
          apiName,
          scopes: requiredScopes,
        });
      }
      throw error;
    }
  }

  /**
   * 判断是否为令牌无效错误
   */
  private isTokenInvalidError(error: any): boolean {
    const code = error?.code ?? error?.response?.data?.code;
    // 飞书错误码：99991663 = access_token 过期或无效
    return code === 99991663 || code === 99991661;
  }

  /**
   * 批量调用多个 API
   */
  async invokeBatch<T>(
    calls: Array<{
      apiName: string;
      fn: InvokeFn<T>;
      options?: InvokeOptions;
    }>
  ): Promise<Array<T | Error>> {
    return Promise.all(
      calls.map(async (call) => {
        try {
          return await this.invoke(call.apiName, call.fn, call.options);
        } catch (error) {
          return error as Error;
        }
      })
    );
  }

  /**
   * 对 SDK 未覆盖的飞书 API 发起 raw HTTP 请求
   *
   * @param apiName 逻辑 API 名称（用于日志和错误信息）
   * @param path API 路径（以 /open-apis/ 开头）
   * @param options HTTP 方法、body、query 及 InvokeOptions
   *
   * @example
   * ```typescript
   * const res = await client.invokeByPath<{ data: { items: Array<{ chat_id: string }> } }>(
   *   "im.v1.chatP2p.batchQuery",
   *   "/open-apis/im/v1/chat_p2p/batch_query",
   *   {
   *     method: "POST",
   *     body: { chatter_ids: [openId] },
   *     as: "user",
   *   },
   * );
   * ```
   */
  async invokeByPath<T = any>(
    apiName: string,
    path: string,
    options?: InvokeByPathOptions
  ): Promise<T> {
    const fn: InvokeFn<T> = async (_sdk, _opts, uat) => {
      return this.rawRequest<T>(path, {
        method: options?.method,
        body: options?.body,
        query: options?.query,
        headers: options?.headers,
        accessToken: uat,
      });
    };
    return this.invoke(apiName, fn, options);
  }

  /**
   * 发起 raw HTTP 请求到飞书 API
   */
  private async rawRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string>;
      headers?: Record<string, string>;
      accessToken?: string;
    }
  ): Promise<T> {
    // 确定域名
    const baseUrl = this.feishuConfig.domain || 'https://open.feishu.cn';
    const url = new URL(path, baseUrl);

    // 添加 query 参数
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    // 构建请求头
    const headers: Record<string, string> = {};
    if (options.accessToken) {
      headers['Authorization'] = `Bearer ${options.accessToken}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    // 发送请求
    const resp = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const data = (await resp.json()) as any;

    // 飞书 API 统一错误模式：code !== 0
    if (data.code !== undefined && data.code !== 0) {
      const err = new Error(data.msg ?? `Lark API error: code=${data.code}`);
      (err as any).code = data.code;
      (err as any).msg = data.msg;
      throw err;
    }

    return data as T;
  }
}

/**
 * 创建 ToolClient 实例
 */
export async function createToolClient(
  feishuConfig: FeishuChannelConfig,
  senderOpenId?: string,
  context?: ToolCallContext
): Promise<ToolClient> {
  const { getFeishuBotClient } = await import('../../agents/tools/feishu/client.js');
  const sdk = await getFeishuBotClient();

  return new ToolClient({
    sdk,
    senderOpenId,
    feishuConfig,
    context,
  });
}

/**
 * 飞书 API 响应类型
 */
export interface LarkResponse<T = any> {
  code: number;
  msg: string;
  data?: T;
}

/**
 * 解析飞书 API 响应
 * 成功时返回 data，失败时抛出 LarkApiError
 */
export function parseLarkResponse<T>(response: LarkResponse<T>): T {
  if (response.code !== 0) {
    throw new LarkApiError(response.code, response.msg, response.data);
  }
  return response.data as T;
}

/**
 * 安全解析飞书 API 响应
 * 成功时返回 { success: true, data }，失败时返回 { success: false, error }
 */
export function safeParseLarkResponse<T>(
  response: LarkResponse<T>
): { success: true; data: T } | { success: false; error: LarkApiError } {
  if (response.code !== 0) {
    return { success: false, error: new LarkApiError(response.code, response.msg, response.data) };
  }
  return { success: true, data: response.data as T };
}

/**
 * 分页请求辅助函数
 */
export async function paginate<T, R>(
  fetchPage: (pageToken?: string) => Promise<LarkResponse<{ items?: T[]; page_token?: string }>>,
  options?: { maxPages?: number; pageSize?: number }
): Promise<T[]> {
  const maxPages = options?.maxPages ?? 10;
  const results: T[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const response = await fetchPage(pageToken);
    const data = parseLarkResponse(response);

    if (data.items) {
      results.push(...data.items);
    }

    pageToken = data.page_token;
    pageCount++;

    if (!pageToken) {
      break;
    }
  }

  return results;
}