// src/plugins/feishu-advanced/types.ts

/**
 * 飞书高级功能插件类型定义
 */

/**
 * 飞书渠道配置
 */
export interface FeishuChannelConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 应用 ID */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 域名: feishu, lark, 或自定义域名 */
  domain?: string;
  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * 工具元数据
 */
export interface ToolMeta {
  /** API 名称（用于权限检查） */
  apiName: string;
  /** 工具描述 */
  description: string;
  /** 是否需要用户授权 */
  requireUserAuth?: boolean;
  /** 所需权限列表 */
  requiredScopes?: string[];
}

/**
 * 分页参数
 */
export interface PaginationParams {
  /** 页码 */
  page_size?: number;
  /** 页标记 */
  page_token?: string;
}

/**
 * 分页响应
 */
export interface PaginationResponse<T> {
  /** 数据项 */
  items: T[];
  /** 是否有更多 */
  has_more: boolean;
  /** 下一页标记 */
  page_token?: string;
  /** 总数（如果可用） */
  total?: number;
}

/**
 * 时间范围
 */
export interface TimeRange {
  /** 开始时间 */
  start?: string;
  /** 结束时间 */
  end?: string;
}

/**
 * 用户引用
 */
export interface UserRef {
  /** 用户 Open ID */
  open_id?: string;
  /** 用户 Union ID */
  union_id?: string;
  /** 用户 ID（飞书内部 ID） */
  user_id?: string;
}

/**
 * 文件引用
 */
export interface FileRef {
  /** 文件 Token */
  file_token: string;
  /** 文件名 */
  name?: string;
  /** 文件类型 */
  type?: string;
  /** 文件大小 */
  size?: number;
}

/**
 * 飞书 API 错误响应
 */
export interface LarkErrorResponse {
  /** 错误码 */
  code: number;
  /** 错误消息 */
  msg: string;
  /** 错误详情 */
  data?: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolResult<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 是否需要授权 */
  requiresAuth?: boolean;
  /** 授权引导 */
  authGuide?: string;
}

/**
 * 成功的工具有效结果
 */
export interface ToolResultSuccess<T> extends ToolResult<T> {
  success: true;
  data: T;
}

/**
 * 失败的工具有效结果
 */
export interface ToolResultFailure extends ToolResult {
  success: false;
  error: string;
}

/**
 * 创建成功结果
 */
export function success<T>(data: T): ToolResultSuccess<T> {
  return { success: true, data };
}

/**
 * 创建失败结果
 */
export function failure(error: string, options?: { requiresAuth?: boolean; authGuide?: string }): ToolResultFailure {
  return {
    success: false,
    error,
    requiresAuth: options?.requiresAuth,
    authGuide: options?.authGuide,
  };
}

/**
 * 创建需要授权的结果
 */
export function requiresAuth(message: string): ToolResultFailure {
  return failure(message, { requiresAuth: true, authGuide: message });
}