// src/channels/http-ws/middleware/authenticate.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../../../auth/jwt.js';
import type { JWTPayload } from '../../../auth/jwt.js';

// 扩展 Express Request，附加解析后的用户信息
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken) {
    return queryToken;
  }
  return null;
}

/**
 * 新认证中间件。
 * - 若 config.server.auth.enabled=false → 注入匿名管理员身份（兼容旧行为）
 * - 否则解析 JWT AT，将 payload 附加到 req.user
 * - 跳过白名单路径（无需认证的公开端点）
 */
export function createAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // 白名单路径（无需认证）
    // 注意：中间件挂载在 app.use('/api', ...) 上，Express 会剥离 /api 前缀
    // 所以这里 req.path 是 /auth/setup，而不是 /api/auth/setup
    const publicPaths = [
      '/auth/setup',     // 首次初始化端点（对应 /api/auth/setup）
      '/auth/check',     // 认证状态检查（对应 /api/auth/check）
    ];

    // 如果路径在白名单中，直接放行
    if (publicPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // 尝试读取配置，如果获取配置失败或 auth 未启用则放行
    let authEnabled = true;
    try {
      const { getConfig } = require('../../../config/loader.js');
      const config = getConfig();
      const authConfig = config?.server?.auth;
      if (!authConfig?.enabled) {
        authEnabled = false;
      }
    } catch {
      // 测试环境中可能无法加载配置，默认启用 auth
    }

    if (!authEnabled) {
      req.user = {
        userId: 'anonymous',
        username: 'anonymous',
        roleId: 'role_admin',
        roleName: '管理员',
        permissions: ['*'] as any,
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 86400,
      };
      return next();
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    try {
      const payload = verifyAccessToken(token);
      req.user = payload;
      return next();
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'TokenExpired', message: 'Token 已过期，请刷新' });
      }
      return res.status(401).json({ error: 'Unauthorized', message: 'Token 无效' });
    }
  };
}
