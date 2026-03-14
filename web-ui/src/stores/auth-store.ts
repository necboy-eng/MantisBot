// web-ui/src/stores/auth-store.ts
// 全局认证状态，使用 React Context + useReducer（不引入 Zustand）
import { setAccessToken, clearAccessToken } from '../utils/auth.js';

export interface AuthUser {
  userId: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  forcePasswordChange: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authEnabled: boolean;
  authChecked: boolean;
}

export type AuthAction =
  | { type: 'LOGIN_SUCCESS'; payload: { accessToken: string; user: AuthUser } }
  | { type: 'LOGOUT' }
  | { type: 'AUTH_DISABLED' }
  | { type: 'AUTH_CHECKED' }
  | { type: 'TOKEN_REFRESHED'; payload: { accessToken: string } };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      setAccessToken(action.payload.accessToken);
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        authChecked: true,
      };
    case 'TOKEN_REFRESHED': {
      setAccessToken(action.payload.accessToken);
      // 解码新 AT 更新 user 信息
      const updatedUser = decodeAccessToken(action.payload.accessToken);
      return { ...state, user: updatedUser ?? state.user };
    }
    case 'LOGOUT':
      clearAccessToken();
      return {
        ...state,
        user: null,
        isAuthenticated: false,
      };
    case 'AUTH_DISABLED':
      return {
        ...state,
        authEnabled: false,
        isAuthenticated: true,
        authChecked: true,
      };
    case 'AUTH_CHECKED':
      return { ...state, authChecked: true };
    default:
      return state;
  }
}

export const initialAuthState: AuthState = {
  user: null,
  isAuthenticated: false,
  authEnabled: true,
  authChecked: false,
};

/**
 * 从 JWT payload 解码用户信息（不验证签名，仅前端展示用）
 */
export function decodeAccessToken(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      userId: payload.userId,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      forcePasswordChange: false,
    };
  } catch {
    return null;
  }
}
