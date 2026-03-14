// web-ui/src/contexts/AuthContext.tsx
import { createContext, useReducer, useEffect, ReactNode } from 'react';
import { authReducer, initialAuthState, AuthState, AuthAction, decodeAccessToken } from '../stores/auth-store.js';
import { refreshToken } from '../utils/auth.js';

interface AuthContextValue {
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
}

export const AuthContext = createContext<AuthContextValue>({
  state: initialAuthState,
  dispatch: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  useEffect(() => {
    // 启动时检查 auth 状态：尝试刷新 token（利用 RT Cookie）
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/check');
        const data = await res.json();

        if (!data.enabled) {
          dispatch({ type: 'AUTH_DISABLED' });
          return;
        }
      } catch {
        // 如果检查失败，继续尝试刷新
      }

      // 尝试用 RT Cookie 刷新 AT
      const token = await refreshToken();
      if (token) {
        const user = decodeAccessToken(token);
        if (user) {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { accessToken: token, user } });
          return;
        }
      }

      dispatch({ type: 'AUTH_CHECKED' });
    };

    checkAuth();

    // 监听 auth:unauthorized 事件（authFetch 触发）
    const handler = () => dispatch({ type: 'LOGOUT' });
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  return (
    <AuthContext.Provider value={{ state, dispatch }}>
      {children}
    </AuthContext.Provider>
  );
}
