// web-ui/src/hooks/usePermission.ts
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';

/**
 * 检查当前用户是否具有指定权限。
 * 在 auth.enabled=false 时始终返回 true（匿名管理员）。
 */
export function usePermission(permission: string): boolean {
  const { state } = useContext(AuthContext);
  if (!state.authEnabled) return true;
  if (!state.user) return false;
  const perms = state.user.permissions;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}
