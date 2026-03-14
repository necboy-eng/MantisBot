// web-ui/src/utils/auth.ts
// AT 仅存内存，RT 存于 HttpOnly Cookie（由服务端 Set-Cookie 管理）
// 对外暴露与旧版兼容的 authFetch / appendTokenToUrl / appendTokenToWsUrl

let _accessToken: string | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

/**
 * 刷新 Access Token（利用 HttpOnly Cookie 中的 RT）
 * 并发调用时只发一次请求（Promise 复用）
 */
export async function refreshToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include', // 携带 HttpOnly Cookie
      });
      if (!res.ok) {
        _accessToken = null;
        return null;
      }
      const data = await res.json();
      _accessToken = data.accessToken;
      return _accessToken;
    } catch {
      _accessToken = null;
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/**
 * 带鉴权的 fetch 包装，AT 过期时自动刷新并重试
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null) =>
    fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doFetch(_accessToken);

  if (res.status === 401) {
    const newToken = await refreshToken();
    if (!newToken) {
      // 刷新失败，触发重新登录事件
      window.dispatchEvent(new Event('auth:unauthorized'));
      return res;
    }
    res = await doFetch(newToken);
  }

  return res;
}

/**
 * 为 URL 附加 token（WS 连接用）
 */
export function appendTokenToWsUrl(url: string): string {
  if (!_accessToken) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(_accessToken)}`;
}

// 兼容旧版 appendTokenToUrl（已不建议用于 WS 之外的场景）
export function appendTokenToUrl(url: string): string {
  return appendTokenToWsUrl(url);
}

// 兼容旧版函数名
export function getAuthToken(): string | null {
  return _accessToken;
}

export function setAuthToken(token: string): void {
  _accessToken = token;
}

export function clearAuthToken(): void {
  _accessToken = null;
}
