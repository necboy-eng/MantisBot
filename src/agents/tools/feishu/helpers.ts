// src/agents/tools/feishu/helpers.ts

/**
 * 飞书工具开发的通用辅助函数
 */

/**
 * 飞书工具错误类
 */
export class FeishuToolError extends Error {
  constructor(
    message: string,
    public code: string,
    public isAuthError: boolean = false,
    public isRateLimit: boolean = false
  ) {
    super(message);
    this.name = 'FeishuToolError';
  }
}

/**
 * 统一的错误处理和自动重试逻辑
 */
export async function withFeishuErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      // 速率限制 - 自动重试
      if (error.code === 99991663 || error.code === 99991402) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[FeishuTools] Rate limit, retry ${attempt}/${MAX_RETRIES}...`);
          await sleep(RETRY_DELAY * attempt);
          continue;
        }
        throw new FeishuToolError(
          '请求过于频繁，请稍后重试',
          'RATE_LIMIT',
          false,
          true
        );
      }

      // 授权失败 - 提示用户重新授权
      if (error.code === 99991401 || error.code === 99991400) {
        throw new FeishuToolError(
          '授权已过期，请发送 `/feishu auth` 重新授权',
          'AUTH_EXPIRED',
          true
        );
      }

      // 权限不足
      if (error.code === 99991403) {
        throw new FeishuToolError(
          '权限不足，请检查飞书开放平台是否已授予相应权限',
          'PERMISSION_DENIED'
        );
      }

      // 资源不存在
      if (error.code === 99991668 || error.code === 99991404) {
        throw new FeishuToolError(
          '资源不存在，请检查资源 ID 是否正确',
          'NOT_FOUND'
        );
      }

      // 其他错误
      const errorMessage = error.msg || error.message || String(error);
      throw new FeishuToolError(
        `飞书 API 调用失败: ${errorMessage}`,
        'API_ERROR'
      );
    }
  }

  throw new Error('Unexpected error in withFeishuErrorHandling');
}

/**
 * 延迟执行
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解析时间参数为飞书 API 需要的时间戳格式（秒级）
 */
export function parseTimeToTimestampMs(timeStr: string): number | null {
  try {
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date.getTime();
  } catch {
    return null;
  }
}

/**
 * 格式化飞书 API 返回结果
 */
export function formatResult(data: any) {
  if (!data) {
    return { error: '返回数据为空' };
  }

  if (data.code !== 0 && data.code !== undefined) {
    return { error: data.msg || `错误码: ${data.code}` };
  }

  return data.data || {};
}
