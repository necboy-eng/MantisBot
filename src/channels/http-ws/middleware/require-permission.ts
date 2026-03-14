// src/channels/http-ws/middleware/require-permission.ts
import type { Request, Response, NextFunction } from 'express';

/**
 * 权限检查中间件工厂。
 * 依赖 authenticate 中间件先附加 req.user。
 *
 * JWT payload 的 permissions 字段：
 * - role_admin: ['*']（表示超级权限）
 * - 其他角色: 具体权限列表，如 ['chat', 'viewHistory']
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    // permissions 可能是 string[] 或 Record<string, boolean>
    const permissions: string[] = Array.isArray(user.permissions)
      ? user.permissions
      : Object.keys(user.permissions ?? {}).filter(k => (user.permissions as any)[k]);

    // 超级权限（admin 角色）
    if (permissions.includes('*')) {
      return next();
    }

    if (!permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `缺少权限: ${permission}`,
      });
    }

    return next();
  };
}
