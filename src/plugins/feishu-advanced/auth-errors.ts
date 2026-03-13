// src/plugins/feishu-advanced/auth-errors.ts

/**
 * 飞书授权错误类型定义
 * 用于区分不同的授权失败场景，提供结构化的错误信息
 */

/**
 * 用户授权缺失错误
 * 当需要用户授权（UAT）但用户未完成授权时抛出
 */
export class UserAuthRequiredError extends Error {
  readonly userOpenId: string;
  readonly requiredScopes: string[];
  readonly apiName: string;

  constructor(
    userOpenId: string,
    options: { apiName: string; scopes: string[] }
  ) {
    const message =
      userOpenId === 'unknown'
        ? `User authentication required for API: ${options.apiName}. No user context available.`
        : `User authentication required for ${userOpenId}. Missing scopes: ${options.scopes.join(', ')}`;

    super(message);
    this.name = 'UserAuthRequiredError';
    this.userOpenId = userOpenId;
    this.requiredScopes = options.scopes;
    this.apiName = options.apiName;
  }

  /**
   * 生成授权引导消息
   */
  toAuthGuide(): string {
    return `此操作需要您的授权。请发送授权指令完成授权后重试。`;
  }
}

/**
 * 应用权限缺失错误
 * 当应用缺少必要的 API 权限时抛出
 */
export class AppScopeMissingError extends Error {
  readonly missingScopes: string[];
  readonly apiName: string;

  constructor(apiName: string, missingScopes: string[]) {
    super(
      `App missing required scopes for API ${apiName}: ${missingScopes.join(', ')}. ` +
        `Please contact admin to enable these scopes in Feishu Admin Console.`
    );
    this.name = 'AppScopeMissingError';
    this.missingScopes = missingScopes;
    this.apiName = apiName;
  }
}

/**
 * 用户权限不足错误
 * 当用户已授权但权限不足以执行操作时抛出
 */
export class UserScopeInsufficientError extends Error {
  readonly userOpenId: string;
  readonly grantedScopes: string[];
  readonly requiredScopes: string[];
  readonly apiName: string;

  constructor(
    userOpenId: string,
    options: {
      apiName: string;
      grantedScopes: string[];
      requiredScopes: string[];
    }
  ) {
    const missing = options.requiredScopes.filter(
      (s) => !options.grantedScopes.includes(s)
    );
    super(
      `User ${userOpenId} has insufficient scopes for API ${options.apiName}. ` +
        `Missing: ${missing.join(', ')}. Granted: ${options.grantedScopes.join(', ')}`
    );
    this.name = 'UserScopeInsufficientError';
    this.userOpenId = userOpenId;
    this.grantedScopes = options.grantedScopes;
    this.requiredScopes = options.requiredScopes;
    this.apiName = options.apiName;
  }

  /**
   * 生成重新授权引导消息
   */
  toReauthGuide(): string {
    const missing = this.requiredScopes.filter(
      (s) => !this.grantedScopes.includes(s)
    );
    return `您的授权权限不足，缺少: ${missing.join(', ')}。请重新授权以获取完整权限。`;
  }
}

/**
 * API 调用错误
 * 封装飞书 API 返回的错误信息
 */
export class LarkApiError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`Lark API Error ${code}: ${message}`);
    this.name = 'LarkApiError';
    this.code = code;
    this.data = data;
  }
}

/**
 * 判断是否为授权相关错误
 */
export function isAuthError(error: unknown): boolean {
  return (
    error instanceof UserAuthRequiredError ||
    error instanceof AppScopeMissingError ||
    error instanceof UserScopeInsufficientError
  );
}

/**
 * 判断是否需要用户授权
 */
export function isUserAuthRequired(error: unknown): error is UserAuthRequiredError {
  return error instanceof UserAuthRequiredError;
}

/**
 * 从错误中提取授权引导信息
 */
export function getAuthGuide(error: unknown): string | null {
  if (error instanceof UserAuthRequiredError) {
    return error.toAuthGuide();
  }
  if (error instanceof UserScopeInsufficientError) {
    return error.toReauthGuide();
  }
  if (error instanceof AppScopeMissingError) {
    return `应用权限不足，请联系管理员在飞书管理后台启用以下权限: ${error.missingScopes.join(', ')}`;
  }
  return null;
}