// src/plugins/feishu-advanced/helpers.ts

/**
 * 飞书工具辅助函数
 * 从 openclaw-lark 移植并适配
 */

/**
 * 时间处理：解析时间字符串为毫秒时间戳
 * 支持多种格式：
 * 1. ISO 8601 / RFC 3339（带时区）："2024-01-01T00:00:00+08:00"
 * 2. 不带时区的格式（默认为北京时间 UTC+8）：
 *    - "2026-02-25 14:30"
 *    - "2026-02-25 14:30:00"
 *    - "2026-02-25T14:30:00"
 */
export function parseTimeToTimestampMs(input: string): string | null {
  try {
    const trimmed = input.trim();

    // 检查是否包含时区信息（Z 或 +/- 偏移）
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      // 有时区信息，直接解析
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return date.getTime().toString();
    }

    // 没有时区信息，当作北京时间处理
    const normalized = trimmed.replace('T', ' ');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      // 尝试直接解析（可能是其他 ISO 8601 格式）
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return date.getTime().toString();
    }

    const [, year, month, day, hour, minute, second] = match;
    // 当作北京时间（UTC+8），转换为 UTC
    const utcDate = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour) - 8, // 北京时间减去 8 小时得到 UTC
        parseInt(minute),
        parseInt(second ?? '0'),
      ),
    );

    return utcDate.getTime().toString();
  } catch {
    return null;
  }
}

/**
 * 时间处理：解析时间字符串为 Unix 时间戳（秒）
 */
export function parseTimeToTimestamp(input: string): string | null {
  const ms = parseTimeToTimestampMs(input);
  if (!ms) return null;
  return Math.floor(parseInt(ms) / 1000).toString();
}

/**
 * 时间处理：解析时间字符串为 RFC 3339 格式
 */
export function parseTimeToRFC3339(input: string): string | null {
  try {
    const trimmed = input.trim();
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return trimmed;
    }

    // 没有时区信息，当作北京时间处理
    const normalized = trimmed.replace('T', ' ');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return trimmed.includes('T') ? `${trimmed}+08:00` : trimmed;
    }

    const [, year, month, day, hour, minute, second] = match;
    const sec = second ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}:${sec}+08:00`;
  } catch {
    return null;
  }
}

/**
 * Unix 时间戳转换为 ISO 8601（上海时区）
 */
export function unixTimestampToISO8601(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null) return null;

  const text = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;

  const num = Number(text);
  if (!Number.isFinite(num)) return null;

  // 判断是秒还是毫秒
  const utcMs = Math.abs(num) >= 1e12 ? num : num * 1000;
  const beijingDate = new Date(utcMs + 8 * 60 * 60 * 1000);

  if (Number.isNaN(beijingDate.getTime())) return null;

  const year = beijingDate.getUTCFullYear();
  const month = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getUTCDate()).padStart(2, '0');
  const hour = String(beijingDate.getUTCHours()).padStart(2, '0');
  const minute = String(beijingDate.getUTCMinutes()).padStart(2, '0');
  const second = String(beijingDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

/**
 * 飞书 API 响应检查
 */
export function assertLarkOk(response: any): void {
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * 格式化飞书 API 错误
 */
export function formatLarkError(response: any): string {
  if (response.code === undefined || response.code === 0) {
    return '';
  }
  return `Lark API error ${response.code}: ${response.msg || 'Unknown error'}`;
}

/**
 * 格式化工具返回值
 */
export function json(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

/**
 * 转换时间范围对象
 */
export function convertTimeRange(
  timeRange: { start?: string; end?: string } | undefined,
  unit: 's' | 'ms' = 's',
): { start?: number; end?: number } | undefined {
  if (!timeRange) return undefined;

  const result: { start?: number; end?: number } = {};
  const parseFn = unit === 'ms' ? parseTimeToTimestampMs : parseTimeToTimestamp;

  if (timeRange.start) {
    const ts = parseFn(timeRange.start);
    if (!ts) {
      throw new Error(`Invalid time format for start: ${timeRange.start}`);
    }
    result.start = parseInt(ts, 10);
  }

  if (timeRange.end) {
    const ts = parseFn(timeRange.end);
    if (!ts) {
      throw new Error(`Invalid time format for end: ${timeRange.end}`);
    }
    result.end = parseInt(ts, 10);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}