// src/channels/http-ws/middleware/file-access-guard.ts
import type { Request, Response, NextFunction } from 'express';
import { resolveAccess } from '../../../auth/path-acl-store.js';

/**
 * 文件访问守卫中间件工厂。
 * 依赖 authenticate 中间件先附加 req.user。
 *
 * 路由格式：/files/:storageId/* 或 /files/:storageId/:path
 * storageId 从 req.params.storageId 读取；
 * 文件路径从路由剩余部分（/*）拼接，规范化为 '/...' 格式。
 */
export function fileAccessGuard(requiredPermission: 'read' | 'write' = 'read') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
    }

    // 从路由参数提取 storageId 和路径
    const storageId = req.params.storageId ?? 'local';
    // Express wildcard param is '0' for /*
    const rawPath = req.params[0] ?? '';
    const requestPath = '/' + rawPath.replace(/^\/+/, '');

    const result = resolveAccess({
      roleId: user.roleId,
      userId: user.userId,
      storageId,
      requestPath,
      requiredPermission,
    });

    if (!result.granted) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `无访问权限: ${requestPath}`,
      });
    }

    return next();
  };
}
