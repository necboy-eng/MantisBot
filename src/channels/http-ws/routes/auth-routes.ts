// src/channels/http-ws/routes/auth-routes.ts
import { Router } from 'express';
import { login, logout, refreshAccessToken } from '../../../auth/auth-service.js';

export const authRouter = Router();

const RT_COOKIE = 'rt';
const RT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天（毫秒）

// COOKIE_SECURE=true 时才启用 Secure 标志。
// 不直接绑定 NODE_ENV=production，因为 Docker HTTP 部署时同样是 production 但无 HTTPS。
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

function setRtCookie(res: import('express').Response, rawToken: string) {
  res.cookie(RT_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: RT_MAX_AGE,
    path: '/auth',
  });
}

function clearRtCookie(res: import('express').Response) {
  res.clearCookie(RT_COOKIE, { path: '/auth' });
}

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少用户名或密码' });
  }

  try {
    const result = await login({
      username,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setRtCookie(res, result.refreshToken);

    return res.json({
      accessToken: result.accessToken,
      forcePasswordChange: result.forcePasswordChange,
    });
  } catch (err: any) {
    const status = ['account_locked', 'account_disabled', 'temp_password_expired'].includes(err.message) ? 403 : 401;
    return res.status(status).json({ error: err.message });
  }
});

// POST /auth/refresh
authRouter.post('/refresh', async (req, res) => {
  const rawRefreshToken = req.cookies?.[RT_COOKIE];

  if (!rawRefreshToken) {
    return res.status(401).json({ error: 'Unauthorized', message: '缺少 Refresh Token' });
  }

  try {
    const result = await refreshAccessToken({ rawRefreshToken, ipAddress: req.ip });

    // 轮换后设置新 RT Cookie
    setRtCookie(res, result.newRefreshToken);

    return res.json({ accessToken: result.accessToken });
  } catch (err: any) {
    clearRtCookie(res);
    return res.status(401).json({ error: err.message });
  }
});

// POST /auth/logout
authRouter.post('/logout', async (req, res) => {
  const rawRefreshToken = req.cookies?.[RT_COOKIE];

  if (rawRefreshToken) {
    await logout({ rawRefreshToken });
  }

  clearRtCookie(res);
  return res.json({ ok: true });
});
