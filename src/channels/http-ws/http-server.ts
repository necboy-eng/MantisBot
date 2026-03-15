// src/channels/http-ws/http-server.ts

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';
import AdmZip from 'adm-zip';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { SessionManager } from '../../session/manager.js';
import type { ToolRegistry } from '../../agents/tools/registry.js';
import { getConfig, loadConfig, saveConfig } from '../../config/loader.js';
import type { Config, ModelConfig, EmailAccount, EmailConfig, AgentTeam } from '../../config/schema.js';
import { AgentTeamSchema, modelSupportsVision } from '../../config/schema.js';
import { PRESET_TEAMS } from '../../agents/agent-teams.js';
import cookieParser from 'cookie-parser';
import { createAuthMiddleware } from './middleware/authenticate.js';
import { requirePermission } from './middleware/require-permission.js';
import { authRouter } from './routes/auth-routes.js';
import { usersRouter } from './routes/users-routes.js';
import { pathAclRouter } from './routes/path-acl-routes.js';
import { initSystemDb, getSystemDb } from '../../auth/db.js';
import { initBuiltinRoles } from '../../auth/roles-store.js';
import { validateJwtSecret, verifyAccessToken } from '../../auth/jwt.js';
// auth-middleware.ts 已废弃，旧 computeToken/hashPassword/verifyPassword 不再使用
import { EMAIL_PROVIDERS } from '../../config/schema.js';
import type { Message, FileAttachment } from '../../types.js';
// AgentRunner 已移除，统一使用 ClaudeAgentRunner
import { getFileStorage } from '../../files/index.js';
import { getLLMClient, clearLLMClientCache } from '../../agents/llm-client.js';
import { resetEmbeddingsService } from '../../memory/embeddings.js';
import type { MemoryManager } from '../../memory/manager.js';
import { registerPendingImages, VISION_INJECT_ENV_KEY } from '../../agents/openai-proxy.js';
import type { ImageBlock } from '../../agents/openai-proxy.js';
import exploreRouter from './explore-api.js';
import storageRouter from './storage-api.js';
import { createCronRoutes } from './cron-routes.js';
import type { CronService } from '../../cron/service.js';
import {
  getAccounts,
  listMailboxes,
  listEmails,
  getEmail,
  getAttachment,
  markAsRead,
  markAsUnread,
} from '../../services/email-service.js';
import type { TunnelManager } from '../../tunnel/index.js';
import { createTunnelRoutes } from './tunnel-routes.js';
import profileRoutes from './profile-routes.js';
import evolutionRoutes from './evolution-routes.js';
import { broadcastToClients } from './ws-server.js';
import { startEmailPoller } from '../../services/email-poller.js';
import type { SkillsLoader } from '../../agents/skills/loader.js';
import { installSkillFromSource } from '../../agents/skills/github-installer.js';
import { preferenceDetector } from '../../agents/preference-detector.js';
import { evolutionProposer } from '../../agents/evolution-proposer.js';
import { evolutionStore } from '../../agents/evolution-store.js';
import { channelDefinitions, getChannelDefinition } from '../definitions/index.js';
import { hotStartChannel, hotStopChannel } from '../initializer.js';
import { CommandRegistry, registerHelpCommand } from '../../auto-reply/commands/registry.js';
import { registerClearCommand } from '../../auto-reply/commands/clear.js';
import { registerMemoryCommand } from '../../auto-reply/commands/memory.js';
import { registerStatusCommand } from '../../auto-reply/commands/status.js';
import { registerWhoamiCommand } from '../../auto-reply/commands/whoami.js';
import { registerModelCommand } from '../../auto-reply/commands/model.js';
import { registerLearningCommand } from '../../auto-reply/commands/learning.js';
import { workDirManager } from '../../workdir/manager.js';
import { PluginLoader } from '../../plugins/loader.js';
import { createPluginRoutes } from './plugin-routes.js';
import { UnifiedAgentRunner, type IAgentRunner } from '../../agents/unified-runner.js';
import { isFallbackableError } from '../../agents/model-error-detector.js';

// ─── 模块级常量 ───────────────────────────────────────────────────────────────
/** 视觉图片注入：单张图片最大允许大小（2MB） */
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

// 存储活动的 Agent Runner 实例（用于权限请求响应）
// Key: sessionId, Value: agentRunner instance
const activeAgentRunners = new Map<string, IAgentRunner>();

/**
 * Find the next available model for fallback
 * Returns null if no other models are available
 */
function findNextModel(
  config: Config,
  currentModel: string,
  triedModels: Set<string>
): { name: string; model: ModelConfig } | null {
  const models = config.models;
  for (const m of models) {
    if (m.enabled === false) continue;
    if (m.name === currentModel) continue;
    if (triedModels.has(m.name)) continue;
    return { name: m.name, model: m };
  }
  return null;
}

// Initialize evolution store
evolutionStore.load().catch(err => {
  console.error('[HTTPServer] Failed to load evolution store:', err);
});

/**
 * 检测用户偏好并生成演变提议
 */
async function detectPreferencesAndPropose(sessionMessages: Message[]): Promise<void> {
  try {
    // 获取配置，检查是否禁用
    const config = getConfig();

    // 检查是否禁用 PreferenceDetector
    if (config.agent?.disablePreferenceDetector) {
      console.log('[PreferenceDetector] Disabled by config, skipping');
      return;
    }

    // 检测偏好 (LLM async analysis)
    const preferences = await preferenceDetector.detectPreferences(sessionMessages as any);

    // 检查是否需要触发演变
    if (preferenceDetector.shouldTriggerEvolution(preferences)) {
      console.log('[PreferenceDetector] Detected preferences that should trigger evolution:', preferences);

      // 检查是否禁用 EvolutionProposer
      if (config.agent?.disableEvolutionProposer) {
        console.log('[EvolutionProposer] Disabled by config, skipping proposal generation');
        return;
      }

      // 生成提议
      let proposal = null;
      try {
        proposal = await evolutionProposer.generateProposal(preferences);
      } catch (err) {
        console.error('[EvolutionProposer] Failed to generate proposal:', err);
      }

      if (proposal) {
        // 存储提议
        try {
          await evolutionStore.addProposal(proposal);
          console.log('[EvolutionStore] Created new proposal:', proposal.id);

          // 通过 WebSocket 通知前端
          broadcastToClients('evolution-proposal', {
            proposal: {
              id: proposal.id,
              profileName: proposal.profileName,
              file: proposal.file,
              reason: proposal.reason,
              status: proposal.status,
              createdAt: proposal.createdAt,
            }
          });
        } catch (err) {
          console.error('[EvolutionStore] Failed to save proposal:', err);
        }
      }
    }
  } catch (err) {
    console.error('[PreferenceDetector] Error detecting preferences:', err);
  }
}

export interface HTTPServerOptions {
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;
  skillsLoader: SkillsLoader;
  pluginLoader?: PluginLoader;
  onMessage: (message: any) => Promise<void>;
  memoryManager?: MemoryManager;
  cronService?: CronService;
  tunnelManager?: TunnelManager;
}

export async function createHTTPServer(options: HTTPServerOptions) {
  let config: Config = loadConfig();
  const app = express();

  // ─── 系统数据库初始化（用户权限系统）─────────────────────────────────────────
  if ((config as any).server?.auth?.enabled) {
    try {
      validateJwtSecret();
      initSystemDb();
      initBuiltinRoles();
      console.log('[Auth] System database initialized');
    } catch (err: any) {
      console.error('[Auth] Failed to initialize auth system:', err.message);
      throw err;
    }
  }

  // 初始化命令注册表（供 /api/chat/stream 和 /api/chat 使用）
  const commandRegistry = new CommandRegistry();
  registerHelpCommand(commandRegistry);
  registerClearCommand(commandRegistry, options.sessionManager);
  registerStatusCommand(commandRegistry, options.sessionManager);
  registerWhoamiCommand(commandRegistry);
  registerModelCommand(commandRegistry);
  registerMemoryCommand(commandRegistry);
  registerLearningCommand(commandRegistry);

  // Plugin routes (if pluginLoader is provided)
  if (options.pluginLoader) {
    createPluginRoutes(app, options.pluginLoader);
  }

  // Middleware
  if (config.server.cors) {
    app.use(cors());
  }
  app.use(express.json({ limit: '100mb' })); // 增加请求体大小限制以支持大文件上传
  app.use(cookieParser());

  // Health check
  // 检测初始化标记文件（由 docker-entrypoint.sh 在 pip install 期间写入）
  // 存在时返回 'initializing'，前端据此显示"后端初始化中"而非"已连接"
  const INIT_STATUS_FILE = path.join(config.workspace || './data', '.init-status');
  app.get('/health', (_, res) => {
    const isInitializing = fs.existsSync(INIT_STATUS_FILE);
    if (isInitializing) {
      let initMessage = '正在安装 Python 依赖包，首次启动需要几分钟...';
      try {
        const content = fs.readFileSync(INIT_STATUS_FILE, 'utf8').trim();
        if (content) initMessage = content;
      } catch {
        // ignore
      }
      return res.json({ status: 'initializing', message: initMessage, timestamp: Date.now() });
    }
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // ─── 新 JWT 鉴权路由（/auth/*，不受中间件保护）──────────────────────────────
  app.use('/auth', authRouter);

  // /api/auth/check - 检查当前 token 是否有效，兼容旧前端格式
  // 返回 { authenticated: boolean, authEnabled: boolean, enabled: boolean, needsSetup: boolean }
  app.get('/api/auth/check', (req, res) => {
    const cfg = getConfig();
    const authEnabled = (cfg as any).server?.auth?.enabled ?? false;

    if (!authEnabled) {
      return res.json({ authenticated: true, authEnabled: false, enabled: false, needsSetup: false });
    }

    // 检查是否需要初始化（系统中没有任何用户）
    try {
      const db = getSystemDb();
      const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any)?.count ?? 0;
      if (userCount === 0) {
        return res.json({ authenticated: false, authEnabled: true, enabled: true, needsSetup: true });
      }
    } catch {
      // system.db 未初始化时忽略
    }

    // 尝试从 Authorization header 验证 AT
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        verifyAccessToken(authHeader.slice(7));
        return res.json({ authenticated: true, authEnabled: true, enabled: true, needsSetup: false });
      } catch {
        // token 无效或过期
      }
    }

    return res.json({ authenticated: false, authEnabled: true, enabled: true, needsSetup: false });
  });

  // ─── /api/auth/login 兼容端点：App.tsx 仍请求此路径，转发到新 JWT 登录逻辑 ────
  app.post('/api/auth/login', async (req, res) => {
    const cfg = getConfig();
    const authCfg = (cfg as any).server?.auth;

    // 鉴权未启用，直接返回成功（旧格式）
    if (!authCfg?.enabled) {
      return res.json({ token: null, authEnabled: false, authenticated: true });
    }

    // 转发到新 JWT 登录逻辑
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'BadRequest', message: '缺少用户名或密码' });
    }

    try {
      const { login } = await import('../../auth/auth-service.js');
      const result = await login({
        username,
        password,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // 设置 RT Cookie（path=/auth，与 auth-routes 一致）
      // 使用 COOKIE_SECURE 环境变量而非 NODE_ENV，避免 HTTP Docker 部署时 Secure Cookie 被浏览器拒绝发送
      res.cookie('rt', result.refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/auth',
      });

      // 兼容旧格式（返回 token 字段），同时返回新格式字段
      return res.json({
        token: result.accessToken,        // 旧前端读取 token
        accessToken: result.accessToken,  // 新前端读取 accessToken
        authEnabled: true,
        authenticated: true,
        forcePasswordChange: result.forcePasswordChange,
      });
    } catch (err: any) {
      const status = ['account_locked', 'account_disabled', 'temp_password_expired'].includes(err.message) ? 403 : 401;
      return res.status(status).json({ error: err.message, message: err.message });
    }
  });

  // 应用新 JWT 鉴权中间件（保护所有 /api/* 路由，/api/auth/check 已在上方注册不受影响）
  app.use('/api', createAuthMiddleware(), usersRouter);
  app.use('/api', createAuthMiddleware(), pathAclRouter);

  // POST /api/auth/setup - 首次初始化：创建 admin 账号（仅在无用户时可用，无需鉴权）
  app.post('/api/auth/setup', async (req, res) => {
    const cfg = getConfig();
    if (!((cfg as any).server?.auth?.enabled)) {
      return res.status(400).json({ error: 'auth_not_enabled' });
    }
    try {
      const { getSystemDb } = await import('../../auth/db.js');
      const db = getSystemDb();
      const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any)?.count ?? 0;
      if (userCount > 0) {
        return res.status(403).json({ error: 'already_initialized', message: '系统已初始化，请直接登录' });
      }

      // 时间窗口保护：仅在系统启动后 10 分钟内允许初始化
      const uptimeSeconds = process.uptime();
      const setupWindowSeconds = 10 * 60; // 10 分钟
      if (uptimeSeconds > setupWindowSeconds) {
        const uptimeMinutes = Math.floor(uptimeSeconds / 60);
        return res.status(403).json({
          error: 'setup_window_expired',
          message: `初始化窗口已关闭（系统已运行 ${uptimeMinutes} 分钟）。请使用管理员账号登录或重启服务。`
        });
      }

      const { username, password } = req.body ?? {};
      if (!username || !password || password.length < 8) {
        return res.status(400).json({ error: 'invalid_input', message: '用户名和密码（至少8位）不能为空' });
      }
      const { createUser } = await import('../../auth/users-store.js');
      const { hashPassword } = await import('../../auth/password.js');
      createUser({ username, passwordHash: await hashPassword(password), roleId: 'role_admin' });
      // 直接登录
      const { login } = await import('../../auth/auth-service.js');
      const result = await login({ username, password, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      res.cookie('rt', result.refreshToken, {
        httpOnly: true, sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: 7 * 24 * 60 * 60 * 1000, path: '/auth',
      });
      return res.json({ ok: true, token: result.accessToken, accessToken: result.accessToken, authEnabled: true, authenticated: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── 会话归属辅助：auth 开启时返回真实 userId，未开启时返回 undefined（全共享模式）
  const getCallerOwnerId = (req: express.Request): string | undefined => {
    const cfg = getConfig();
    const authEnabled = (cfg as any).server?.auth?.enabled ?? false;
    if (!authEnabled) return undefined;
    return req.user?.userId;
  };

  /** 判断当前请求者是否为管理员（有 manageUsers 权限或 role_admin） */
  const isAdmin = (req: express.Request): boolean => {
    const u = req.user;
    if (!u) return false;
    if (u.roleId === 'role_admin') return true;
    const perms = u.permissions as any;
    if (Array.isArray(perms)) return perms.includes('*');
    if (typeof perms === 'object' && perms !== null) return perms['manageUsers'] === true || perms['*'] === true;
    return false;
  };

  app.get('/api/sessions', async (req, res) => {
    const ownerId = getCallerOwnerId(req);
    const adminView = ownerId !== undefined && isAdmin(req);

    let sessions;
    if (ownerId === undefined) {
      // auth 未开启 → 返回全部（旧行为）
      sessions = options.sessionManager.listByOwner(null);
    } else if (adminView) {
      // 管理员 → 返回全部会话
      sessions = options.sessionManager.listByOwner(null);
    } else {
      // 普通用户 → 只返回自己的
      sessions = options.sessionManager.listByOwner(ownerId);
    }

    // 管理员视图：预取 userId→username 映射表，避免 N+1 查询
    let userMap: Map<string, string> = new Map();
    if (adminView) {
      try {
        const { getAllUsers } = await import('../../auth/users-store.js');
        const allUsers = getAllUsers();
        for (const u of allUsers) {
          userMap.set(u.id, u.displayName || u.username);
        }
      } catch { /* 无 system db 时（auth 未开启）忽略 */ }
    }

    res.json(sessions.map(s => {
      // 检测会话的 platform 和 feishuInstanceId（从第一条消息的 metadata 中获取）
      let platform = 'web'; // 默认
      let feishuInstanceId: string | undefined;
      const firstUserMessage = s.messages.find(m => m.role === 'user');
      if (firstUserMessage?.metadata?.platform) {
        platform = firstUserMessage.metadata.platform as string;
      }
      if (firstUserMessage?.metadata?.feishuInstanceId) {
        feishuInstanceId = firstUserMessage.metadata.feishuInstanceId as string;
      }

      // 智能标题生成：如果没有 name，使用第一条用户消息的前 30 个字符
      let displayName = s.name;
      if (!displayName && firstUserMessage) {
        displayName = firstUserMessage.content.substring(0, 30) + (firstUserMessage.content.length > 30 ? '...' : '');
      }

      return {
        id: s.id,
        name: displayName,
        model: s.model,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        starred: s.starred,
        platform, // 渠道平台标识
        feishuInstanceId, // 飞书实例 ID（仅飞书渠道有效）
        // 归属信息：管理员视图下附带，方便前端区分
        ownerId: adminView ? (s.ownerId ?? null) : undefined,
        ownerName: adminView ? (s.ownerId ? (userMap.get(s.ownerId) ?? s.ownerId) : null) : undefined,
      };
    }));
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = options.sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const ownerId = getCallerOwnerId(req);
    // 管理员可以查看任意 session；普通用户只能查看自己的
    if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId && !isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(session);
  });

  // Update session (包括审批模式)
  app.put('/api/sessions/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { approvalMode, name, model, starred } = req.body;

      const session = options.sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 归属校验
      const ownerId = getCallerOwnerId(req);
      if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // 更新字段
      if (approvalMode && ['auto', 'ask', 'dangerous'].includes(approvalMode)) {
        session.approvalMode = approvalMode;
        // 清除缓存的 AgentRunner，下次请求时创建新的
        const oldRunner = activeAgentRunners.get(id);
        if (oldRunner) {
          console.log('[HTTPServer] Disposing old AgentRunner due to approvalMode change:', id);
          if (oldRunner.dispose) {
            oldRunner.dispose();
          }
          activeAgentRunners.delete(id);
        }
      }
      if (name) {
        session.name = name;
      }
      if (model) {
        session.model = model;
      }
      if (typeof starred === 'boolean') {
        session.starred = starred;
      }

      options.sessionManager.updateSession(session);
      console.log('[HTTPServer] Updated session:', id, 'approvalMode:', session.approvalMode);
      res.json(session);
    } catch (error) {
      console.error('[HTTPServer] Update session error:', error);
      res.status(500).json({ error: 'Failed to update session' });
    }
  });

  app.delete('/api/sessions/:id', (req, res) => {
    try {
      const session = options.sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      // 归属校验
      const ownerId = getCallerOwnerId(req);
      if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      options.sessionManager.deleteSession(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('[HTTPServer] Delete session error:', error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // Delete a single message from a session
  app.delete('/api/sessions/:id/messages/:msgId', (req, res) => {
    try {
      const { id, msgId } = req.params;
      const session = options.sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: 'Session or message not found' });
      const ownerId = getCallerOwnerId(req);
      if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const deleted = options.sessionManager.deleteMessage(id, msgId);
      if (!deleted) {
        return res.status(404).json({ error: 'Session or message not found' });
      }
      res.status(204).send();
    } catch (error) {
      console.error('[HTTPServer] Delete message error:', error);
      res.status(500).json({ error: 'Failed to delete message' });
    }
  });

  // Truncate session messages from a given message onward (for resend)
  app.delete('/api/sessions/:id/messages/:msgId/truncate', (req, res) => {
    try {
      const { id, msgId } = req.params;
      const session = options.sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: 'Session or message not found' });
      const ownerId = getCallerOwnerId(req);
      if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const removed = options.sessionManager.truncateFrom(id, msgId);
      if (removed === -1) {
        return res.status(404).json({ error: 'Session or message not found' });
      }
      res.json({ removed });
    } catch (error) {
      console.error('[HTTPServer] Truncate messages error:', error);
      res.status(500).json({ error: 'Failed to truncate messages' });
    }
  });

  // Create session
  app.post('/api/sessions', (req, res) => {
    const { name, model, approvalMode } = req.body;
    const config = getConfig();
    const ownerId = getCallerOwnerId(req);
    const session = options.sessionManager.createSession(
      uuidv4(),
      model || config.models[0]?.name,
      undefined,
      ownerId,
    );
    if (name) {
      session.name = name;
    }
    // 保存审批模式
    if (approvalMode && ['auto', 'ask', 'dangerous'].includes(approvalMode)) {
      session.approvalMode = approvalMode;
    }
    options.sessionManager.updateSession(session);
    res.status(201).json(session);
  });

  // Chat endpoint
  app.post('/api/chat', async (req, res): Promise<void> => {
    try {
      const { sessionId, message, model } = req.body;

      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      const config = getConfig();
      const chatId = sessionId || uuidv4();
      const ownerId = getCallerOwnerId(req);

      // Get or create session
      let session = sessionId ? options.sessionManager.getSession(sessionId) : null;
      if (!session) {
        session = options.sessionManager.createSession(
          chatId,
          model || config.models[0]?.name,
          undefined,
          ownerId,
        );
      } else {
        // 归属校验：只有 ownerId 一致才能使用
        if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        if (model && session.model !== model) {
          // Update session model if frontend specifies a different model
          session.model = model;
          options.sessionManager.updateSession(session);
        }
      }

      // Use onMessage callback to process through MessageDispatcher
      await options.onMessage({
        id: uuidv4(),
        content: message,
        chatId,
        userId: ownerId ?? req.user?.userId ?? 'web-user',
        platform: 'web',
        timestamp: Date.now()
      });

      // Get updated session
      const updatedSession = options.sessionManager.getSession(chatId);
      if (!updatedSession) {
        throw new Error('Session not found after processing');
      }

      // Get last assistant message
      const lastMessage = updatedSession.messages[updatedSession.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') {
        throw new Error('No assistant response found');
      }

      res.json({
        sessionId: chatId,
        message: lastMessage
      });
    } catch (error) {
      console.error('[HTTPServer] Chat error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // SSE Stream Chat endpoint
  app.post('/api/chat/stream', async (req, res): Promise<void> => {
    try {
      const { sessionId, message, model, teamId, attachments: userAttachments } = req.body;

      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      const config = getConfig();
      const ownerId = getCallerOwnerId(req);

      // 调试日志：显示 session 获取情况
      console.log('[HTTPServer] /api/chat/stream called with sessionId:', sessionId, 'message:', message?.slice(0, 50));

      // Get or create session
      let session = sessionId ? options.sessionManager.getSession(sessionId) : null;
      const chatId = sessionId || uuidv4();
      if (!session) {
        console.log('[HTTPServer] Creating NEW session, chatId:', chatId);
        session = options.sessionManager.createSession(
          chatId,
          model || config.models[0]?.name,
          undefined,
          ownerId,
        );
      } else {
        console.log('[HTTPServer] Using EXISTING session, message count:', session.messages.length);
        // 归属校验：只有 ownerId 一致才能使用
        if (ownerId !== undefined && session.ownerId && session.ownerId !== ownerId) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }

      if (model && session.model !== model) {
        // Update session model if frontend specifies a different model
        session.model = model;
        options.sessionManager.updateSession(session);
      }

      // ── 斜杠命令检测 ──────────────────────────────────────────────
      // Web UI 用流式端点，但命令不需要流式，直接以 SSE done 事件返回即可
      const parsed = commandRegistry.parse(message);
      if (parsed) {
        const command = commandRegistry.get(parsed.command);
        if (command) {
          const cmdContext = { chatId, userId: ownerId ?? req.user?.userId ?? 'web-user', platform: 'http-ws' };
          const response = await command.handler(parsed.args, cmdContext);

          // 把命令响应写入 session（让前端 /api/sessions/:id 能看到历史）
          options.sessionManager.addMessage(chatId, { role: 'user', content: message });
          const assistantMsg = options.sessionManager.addMessage(chatId, { role: 'assistant', content: response });

          // 以 SSE 格式返回（与正常流式响应格式完全一致，前端无需改动）
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.write(`event: chunk\ndata: ${JSON.stringify({ content: response })}\n\n`);
          res.write(`event: done\ndata: ${JSON.stringify({
            messageId: assistantMsg?.id || uuidv4(),
            attachments: undefined,
            sessionName: session.name
          })}\n\n`);
          res.end();
          console.log(`[HTTPServer] Command /${parsed.command} handled for session ${chatId}`);
          return;
        }
      }

      // ── Plugin Command 检测 ──────────────────────────────────────────────
      // 格式: /plugin:command args
      // Plugin command 会将 command 内容作为 prompt 发送给 Agent
      let actualMessage = message;
      // 记录本次请求触发的 plugin 名称，用于后续自动注入该 plugin 的 skills
      let activePluginName: string | null = null;
      if (message.startsWith('/') && message.includes(':') && options.pluginLoader) {
        const pluginParsed = options.pluginLoader.parseCommandMessage(message);
        if (pluginParsed) {
          const { pluginName, commandName, args } = pluginParsed;
          const pluginCommand = options.pluginLoader.getCommand(pluginName, commandName);

          if (pluginCommand) {
            // 构建 command prompt（替换占位符并移除 frontmatter）
            actualMessage = options.pluginLoader.buildCommandPrompt(pluginCommand, args);
            // 记录触发的 plugin，后续 streamRun 时自动注入该 plugin 的所有 skills
            activePluginName = pluginName;
            console.log(`[HTTPServer] Plugin command: /${pluginName}:${commandName}, args: ${args?.slice(0, 50)}`);
            // 把原始用户消息写入 session（显示给用户）
            options.sessionManager.addMessage(chatId, { role: 'user', content: message });
          } else {
            // Plugin command 不存在，返回错误提示
            const availableCommands = options.pluginLoader.getCommands()
              .filter(c => c.pluginName === pluginName)
              .map(c => `  /${pluginName}:${c.name} - ${c.description || '无描述'}`)
              .join('\n');
            const errorResponse = `未找到命令: /${pluginName}:${commandName}\n\n可用的 ${pluginName} 插件命令:\n${availableCommands || '  (无)'}`;

            options.sessionManager.addMessage(chatId, { role: 'user', content: message });
            const assistantMsg = options.sessionManager.addMessage(chatId, { role: 'assistant', content: errorResponse });

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.write(`event: chunk\ndata: ${JSON.stringify({ content: errorResponse })}\n\n`);
            res.write(`event: done\ndata: ${JSON.stringify({
              messageId: assistantMsg?.id || uuidv4(),
              attachments: undefined,
              sessionName: session.name
            })}\n\n`);
            res.end();
            return;
          }
        }
      }
      // ─────────────────────────────────────────────────────────────

      // Validate API key for the selected model — fail fast before any LLM call
      // 校验 session.model 是否在配置中存在（防止旧数据里存了 'default' 等无效值）
      const isValidSessionModel = session.model
        ? (config.models as any[]).some((m: any) => m.name === session.model)
        : false;
      if (!isValidSessionModel && session.model) {
        console.warn(`[HTTPServer] session.model '${session.model}' not found in config, falling back to default`);
        session.model = config.defaultModel || config.models[0]?.name;
        options.sessionManager.updateSession(session);
      }
      const resolvedModelName = session.model || config.defaultModel || config.models[0]?.name;
      const resolvedModelConfig = (config.models as any[]).find((m: any) => m.name === resolvedModelName);
      if (resolvedModelConfig && !resolvedModelConfig.apiKey?.trim()) {
        res.status(422).json({
          error: 'missing_api_key',
          model: resolvedModelName,
          messageKey: 'error.missingApiKey',
          messageArgs: { model: resolvedModelName },
          message: `模型「${resolvedModelName}」未配置 API Key，请前往「设置 → 模型配置」填写后重试。`
        });
        return;
      }

      // 复用已有的 Agent Runner 实例（保持会话上下文）
      // 如果是已存在的 session，尝试复用之前的 runner
      let agentRunner: IAgentRunner;
      const existingRunner = activeAgentRunners.get(session.id);
      // 当前会话应使用的模型
      const modelName = session.model || config.defaultModel || config.models[0]?.name || 'MiniMax-M2.5';

      if (existingRunner && existingRunner.modelName === modelName) {
        console.log('[HTTPServer] Reusing existing UnifiedAgentRunner for session:', session.id);
        agentRunner = existingRunner;
      } else {
        if (existingRunner) {
          console.log('[HTTPServer] Model changed:', existingRunner.modelName, '->', modelName, ', creating new runner for session:', session.id);
          activeAgentRunners.delete(session.id);
        }
        // 获取当前工作目录
        const cwd = workDirManager.getCurrentWorkDir();
        // 从持久化 session 恢复 claudeSessionId（用于 Claude Agent SDK resume）
        const claudeSessionId = session.claudeSessionId;
        if (claudeSessionId) {
          console.log('[HTTPServer] Resuming Claude SDK session:', claudeSessionId);
        }
        // 获取审批模式（默认为 dangerous - 仅危险操作询问）
        const approvalMode = session.approvalMode || 'dangerous';
        console.log('[HTTPServer] Approval mode for session:', session.id, '->', approvalMode);
        agentRunner = new UnifiedAgentRunner(options.toolRegistry, {
          model: modelName,
          maxIterations: 0,
          approvalMode: approvalMode,
          skillsLoader: options.skillsLoader,  // 传入 skillsLoader
          cwd: cwd,  // 传入工作目录
          claudeSessionId: claudeSessionId,  // 恢复 Claude SDK 会话
        });
        // 存储 agentRunner 实例（用于权限请求响应和后续复用）
        activeAgentRunners.set(session.id, agentRunner);
        console.log('[HTTPServer] Created new UnifiedAgentRunner for session:', session.id, 'cwd:', cwd, 'claudeSessionId:', claudeSessionId || '(new)', 'approvalMode:', approvalMode);
      }

      // 注入当前用户的 ACL 上下文（每次请求都更新，保证 roleId 准确）
      if (agentRunner instanceof UnifiedAgentRunner) {
        agentRunner.setUserContext({
          userId: req.user?.userId ?? '',
          roleId: req.user?.roleId ?? 'role_member',
          platform: 'http-ws',
        });
      }

      // 监听权限请求事件（通过 EventEmitter，仅 ClaudeAgentRunner 支持）
      if (agentRunner instanceof UnifiedAgentRunner) {
        agentRunner.on('permissionRequest', (permissionRequest) => {
          console.log('[HTTPServer] Permission request received via EventEmitter:', permissionRequest.requestId);
          res.write(`event: permission\ndata: ${JSON.stringify({
            requestId: permissionRequest.requestId,
            toolName: permissionRequest.toolName,
            toolInput: permissionRequest.toolInput,
            isDangerous: permissionRequest.isDangerous,
            reason: permissionRequest.reason,
          })}\n\n`);
          (res as any).flush?.();
        });
      }

      // Add user message (if not already added by plugin command handling)
      // plugin command 已经在上面添加了用户消息
      const isPluginCommand = message.startsWith('/') && message.includes(':') && options.pluginLoader?.getCommand(
        message.split(':')[0]?.slice(1) || '',
        message.split(':')[1]?.split(' ')[0] || ''
      );
      if (!isPluginCommand) {
        session.messages.push({
          id: uuidv4(),
          role: 'user',
          content: message,
          timestamp: Date.now()
        });
      }

      // 🚀 在用户提交第一条消息后立即生成标题（不等待 AI 响应完成）
      // 这样用户可以更快看到有意义的会话标题
      const needsTitle = !session.name || session.name === 'New Chat' || session.name === '新对话';
      if (needsTitle && message.trim()) {
        const sessionRef = session;
        const modelName = session.model || config.defaultModel || config.models[0]?.name;
        getLLMClient().generateTitle(message, modelName).then(title => {
          sessionRef.name = title;
          options.sessionManager.updateSession(sessionRef);
          // 通过 WebSocket 广播更新后的 session 名称
          broadcastToClients('session-renamed', { sessionId: sessionRef.id, name: title });
          console.log('[HTTPServer] Title generated (early):', title, 'for session:', sessionRef.id);
        }).catch(err => {
          console.error('[HTTPServer] Failed to generate title (early):', err);
        });
      }

      // Setup SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // 调试日志：显示历史消息数量
      console.log('[HTTPServer] Session messages BEFORE adding user message:', session.messages.length, 'messages:', session.messages.map(m => ({ role: m.role, content: m.content?.slice(0, 30) })));

      const history = session.messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // 调试日志：显示构建的 history
      console.log('[HTTPServer] History built, total messages:', history.length, 'roles:', history.map(m => m.role));

      let fullContent = '';
      const attachments: any[] = [];

      // ── 工具调用 & 思考过程收集（用于持久化历史） ───────────────────────────
      // result 截断到 300 字符，避免大文件内容膨胀 sessions.json
      const MAX_TOOL_RESULT_LEN = 300;
      const MAX_THINKING_LEN    = 500;
      let collectedToolStatus: import('../../types.js').PersistedToolStatus[] = [];
      let   collectedThinking = '';

      // 记忆检索：在 streamRun 前搜索相关记忆，构建上下文提示词
      // 对于 plugin command，跳过记忆检索（command prompt 已包含完整上下文）
      let contextualMessage = actualMessage;
      const isPluginCommandMessage = message.startsWith('/') && message.includes(':');
      if (options.memoryManager && !isPluginCommandMessage) {
        try {
          const memories = await options.memoryManager.searchHybrid('default', actualMessage, {
            limit: 7,
            sessionKey: undefined  // 跨 session 搜索
          });
          console.log(`[HTTPServer] Memory search found ${memories.length} memories for stream`);
          if (memories.length > 0) {
            const memoryContext = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
            contextualMessage = `📋 **相关记忆**（请在回答前先参考这些信息）：\n${memoryContext}\n\n---\n\n💬 **用户问题**：\n${actualMessage}\n\n💡 **提示**：请先查看上面的相关记忆，然后回答用户问题。如果记忆中有相关信息，请直接使用。`;
          }
        } catch (err) {
          console.error('[HTTPServer] Memory search failed (stream):', err);
        }
      }

      // Agent Teams：根据 teamId 设置活跃团队
      if (agentRunner instanceof UnifiedAgentRunner && typeof agentRunner.setActiveTeam === 'function') {
        if (teamId) {
          const teams: AgentTeam[] = config.agentTeams || [];
          const activeTeam = teams.find(t => t.id === teamId && t.enabled) || null;
          agentRunner.setActiveTeam(activeTeam);
          if (activeTeam) {
            console.log(`[HTTPServer] Active team set: ${activeTeam.name}`);
          }
        } else {
          agentRunner.setActiveTeam(null);
        }
      }

      // ── 视觉路由：图片附件检测与模型切换 ─────────────────────────────────
      // 检查是否有图片附件
      const incomingAttachments: FileAttachment[] = Array.isArray(userAttachments) ? userAttachments : [];
      const hasImageAttachment = incomingAttachments.some(
        (a: FileAttachment) => a.mimeType?.startsWith('image/')
      );

      // 是否需要临时视觉 runner（图片存在且当前模型不支持视觉）
      let visionRunner: import('../../agents/unified-runner.js').UnifiedAgentRunner | null = null;
      let visionSwitchNotice = '';

      if (hasImageAttachment) {
        const currentModelConfig = (config.models as any[]).find((m: any) => m.name === modelName);
        const currentSupportsVision = currentModelConfig ? modelSupportsVision(currentModelConfig) : false;

        if (!currentSupportsVision) {
          // 查找第一个支持视觉的模型
          const visionModel = (config.models as any[]).find(
            (m: any) => m.enabled !== false && modelSupportsVision(m)
          );

          if (visionModel) {
            console.log(`[HTTPServer] Vision routing: switching from ${modelName} to ${visionModel.name} for image analysis`);
            const cwd = workDirManager.getCurrentWorkDir();
            visionRunner = new UnifiedAgentRunner(options.toolRegistry, {
              model: visionModel.name,
              maxIterations: 0,
              approvalMode: session.approvalMode || 'dangerous',
              skillsLoader: options.skillsLoader,
              cwd,
            });
            visionSwitchNotice = `🔍 已自动切换到 **${visionModel.name}** 进行图像分析`;
          } else {
            // 没有可用视觉模型，直接返回友好提示并终止
            console.warn('[HTTPServer] Vision routing: no vision-capable model found');
            res.write(`event: chunk\ndata: ${JSON.stringify({ content: '⚠️ 当前没有支持图像识别的模型。请在「设置 → 模型配置」中为某个模型开启「视觉理解」能力后重试。' })}\n\n`);
            res.write(`event: done\ndata: ${JSON.stringify({ messageId: uuidv4(), attachments: undefined })}\n\n`);
            res.end();
            return;
          }
        }
      }

      // 如果需要临时视觉 runner，替换本次使用的 runner（不影响会话）
      const effectiveRunner = visionRunner ?? agentRunner;

      // ── 图片路径注入：直接读取图片为 base64 并注入到消息中 ─────────────────────
      if (hasImageAttachment) {
        const imageAttachments = incomingAttachments.filter(
          (a: FileAttachment) => a.mimeType?.startsWith('image/')
        );
        const fileStorage = getFileStorage();

        const imageBlocks: ImageBlock[] = [];
        const failedPaths: string[] = [];  // 记录绝对路径，用于 fallback 提示

        for (const att of imageAttachments) {
          // URL 格式: /api/files/{storedName}
          const storedName = path.basename(att.url || '');
          const absPath = fileStorage.getFilePath(storedName);

          if (!absPath) {
            console.warn(`[HTTPServer] Image path not resolved: ${storedName}`);
            failedPaths.push(storedName);
            continue;
          }

          try {
            // 读取文件（单次 syscall），再检查大小
            const buffer = fs.readFileSync(absPath);
            if (buffer.length > MAX_IMAGE_SIZE) {
              console.warn(`[HTTPServer] Image too large (${buffer.length} bytes): ${storedName}`);
              failedPaths.push(absPath);
              continue;
            }

            // 优先使用 FileAttachment 上已有的 mimeType，否则按扩展名回退
            const mimeType = att.mimeType && att.mimeType.startsWith('image/')
              ? att.mimeType
              : (() => {
                  const ext = absPath.toLowerCase().split('.').pop();
                  return ext === 'png' ? 'image/png'
                    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                    : ext === 'gif' ? 'image/gif'
                    : ext === 'webp' ? 'image/webp'
                    : 'image/png';
                })();

            imageBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') },
            });

            console.log(`[HTTPServer] Image loaded: ${storedName} (${buffer.length} bytes, ${mimeType})`);
          } catch (err) {
            console.error(`[HTTPServer] Failed to read image ${storedName}:`, err);
            failedPaths.push(absPath);
          }
        }

        // 如果成功读取了图片，注册到 Proxy 注入 Map
        // 同进程内通过 process.env 传递 injectId（Proxy 与 Runner 共享同一 Node.js 进程）
        if (imageBlocks.length > 0) {
          const injectId = registerPendingImages(imageBlocks);
          process.env[VISION_INJECT_ENV_KEY] = injectId;
        }

        // 如果有失败的图片，fallback 到 Read 工具提示（给出绝对路径供模型读取）
        if (failedPaths.length > 0) {
          const fallbackNote = failedPaths.length === 1
            ? `\n\n📎 **图片文件路径**：${failedPaths[0]}\n（请使用 Read 工具读取并分析这张图片）`
            : `\n\n📎 **图片文件路径**：\n${failedPaths.map(p => `- ${p}`).join('\n')}\n（请使用 Read 工具读取并分析这些图片）`;
          contextualMessage = contextualMessage + fallbackNote;
          console.log(`[HTTPServer] Fallback to Read tool for ${failedPaths.length} image(s)`);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Stream process
      if (visionSwitchNotice) {
        res.write(`event: system\ndata: ${JSON.stringify({ content: visionSwitchNotice })}\n\n`);
        (res as any).flush?.();
      }

      // Fallback loop: retry with next model on eligible errors
      const triedModels = new Set<string>();
      const initialModelName = effectiveRunner.modelName;
      triedModels.add(initialModelName);
      let currentRunner = effectiveRunner;
      let currentModelName = initialModelName;

      fallbackLoop: while (true) {
        // Reset streaming state for each model attempt
        fullContent = '';
        collectedThinking = '';
        collectedToolStatus = [];

        try {
          // 如果本次请求是由 /plugin:command 触发，自动将该 plugin 的所有 skills 临时注入
          // 这样 command 执行时模型能看到该 plugin 的完整 skills 上下文
          const extraEnabledSkills: string[] = activePluginName && options.pluginLoader
            ? options.pluginLoader.getPlugin(activePluginName)?.skills.map(s => s.name) ?? []
            : [];

          for await (const chunk of currentRunner.streamRun(contextualMessage, history, undefined, { extraEnabledSkills })) {
            const chunkAny = chunk as any;

            // 思考过程事件 - 流式输出思考内容
            if (chunk.type === 'thinking' && chunk.content) {
              collectedThinking += chunk.content;
              console.log('[HTTPServer] Sending thinking event:', chunk.content.slice(0, 50));
              res.write(`event: thinking\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'text' && chunk.content) {
              fullContent += chunk.content;
              console.log('[HTTPServer] Sending chunk event:', chunk.content.slice(0, 50));
              res.write(`event: chunk\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'tool_use') {
              console.log('[HTTPServer] Tool start:', chunk.tool, chunk.args);
              // 收集工具调用 start 条目
              collectedToolStatus.push({
                tool: chunk.tool ?? '',
                toolId: chunk.toolId,
                status: 'start',
                args: chunk.args,
                timestamp: Date.now(),
              });
              res.write(`event: tool\ndata: ${JSON.stringify({
                tool: chunk.tool,
                toolId: chunk.toolId,
                status: 'start',
                args: chunk.args
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'tool_result') {
              console.log('[HTTPServer] Tool end:', chunk.tool, 'Args:', chunk.args, 'Result type:', typeof chunk.result);
              // 将 end 数据合并回对应的 start 条目（按 toolId 反向查找）
              const startIdx = collectedToolStatus.slice().reverse().findIndex(
                t => t.toolId === chunk.toolId && t.status === 'start'
              );
              if (startIdx >= 0) {
                const realIdx = collectedToolStatus.length - 1 - startIdx;
                const raw = chunk.result;
                const truncated = typeof raw === 'string' && raw.length > MAX_TOOL_RESULT_LEN
                  ? raw.slice(0, MAX_TOOL_RESULT_LEN) + '…'
                  : raw;
                collectedToolStatus[realIdx] = {
                  ...collectedToolStatus[realIdx],
                  status: 'end',
                  result: truncated,
                  isError: chunk.isError,
                };
              }
              res.write(`event: tool\ndata: ${JSON.stringify({
                tool: chunk.tool,
                toolId: chunk.toolId,
                status: 'end',
                args: chunk.args,
                result: chunk.result,
                isError: chunk.isError
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'permission') {
              // 权限请求事件
              const perm = chunkAny.permission;
              console.log('[HTTPServer] Permission request:', perm);
              res.write(`event: permission\ndata: ${JSON.stringify({
                requestId: perm.requestId,
                toolName: perm.toolName,
                toolInput: perm.toolInput,
                isDangerous: perm.isDangerous,
                reason: perm.reason,
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'agent_invocation') {
              // Subagent 调用事件（Agent Teams）
              console.log('[HTTPServer] Sending agent event:', { agentName: chunk.agentName, phase: chunk.phase, task: (chunk.content || '').slice(0, 100) });
              res.write(`event: agent\ndata: ${JSON.stringify({
                agentName: chunk.agentName,
                agentId: chunk.agentId,
                phase: chunk.phase,
                task: chunk.content,
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'error') {
              // 错误事件 - 检查是否可以 fallback
              console.log('[HTTPServer] Error:', chunk.content);

              // 检查是否为可 fallback 的错误（如 429、5xx 等）
              if (isFallbackableError(chunk.content)) {
                // 抛出异常让 fallback 逻辑处理
                throw new Error(chunk.content);
              }

              // 非 fallback 错误，直接发送给前端
              res.write(`event: error\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'complete') {
              // Save message to session
              const assistantMessage = {
                id: uuidv4(),
                role: 'assistant' as const,
                content: fullContent,
                timestamp: Date.now(),
                attachments: chunk.attachments,
                // 持久化工具调用时间轴（result 已截断）和思考过程摘要
                ...(collectedToolStatus.length > 0 && { toolStatus: collectedToolStatus }),
                ...(collectedThinking && { thinking: collectedThinking.slice(0, MAX_THINKING_LEN) }),
              };
              session.messages.push(assistantMessage);

              // 保存 Claude SDK 的 sessionId 到持久化 session（用于重启后恢复上下文）
              const newClaudeSessionId = currentRunner.getSessionId?.();
              if (newClaudeSessionId && newClaudeSessionId !== session.claudeSessionId) {
                session.claudeSessionId = newClaudeSessionId;
                console.log('[HTTPServer] Saved claudeSessionId to session:', newClaudeSessionId);
              }

              options.sessionManager.updateSession(session);

              // ⚡ 发送 done 事件（标题已在用户提交消息时提前生成）
              const doneData = {
                messageId: assistantMessage.id,
                attachments: chunk.attachments,
                sessionName: session.name,
                usage: chunk.usage,
                model: currentModelName,  // 当前使用的模型名称
              };
              console.log('[HTTPServer] Sending done event with attachments:', chunk.attachments?.length || 0);
              res.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);

              // 后台异步：检测用户偏好并生成演变提议（不阻塞响应）
              detectPreferencesAndPropose(session.messages).catch(err => {
                console.error('[HTTPServer] Failed to detect preferences (async):', err);
              });

              // Update runner cache if this was a successful fallback
              if (currentModelName !== initialModelName) {
                activeAgentRunners.set(session.id, currentRunner);
                console.log('[HTTPServer] Updated runner cache for session after successful fallback');
              }

              // Successfully completed, exit fallback loop
              break fallbackLoop;
            }
          }
        } catch (error: any) {
          console.error('[HTTPServer] Stream error, checking for fallback:', error?.message || error);

          // Check if error is fallback-eligible
          if (!isFallbackableError(error)) {
            // Not fallbackable, send error event and exit
            console.log('[HTTPServer] Error is not fallbackable, sending error event');
            res.write(`event: error\ndata: ${JSON.stringify({ content: error?.message || 'Unknown error' })}\n\n`);
            (res as any).flush?.();
            break fallbackLoop;
          }

          // Find next available model
          const nextModelInfo = findNextModel(config, currentModelName, triedModels);

          if (!nextModelInfo) {
            // All models exhausted
            console.log('[HTTPServer] All models exhausted, sending error event');
            res.write(`event: error\ndata: ${JSON.stringify({ content: '⚠️ 所有可用模型均无法响应，请稍后重试或检查模型配置。' })}\n\n`);
            (res as any).flush?.();
            break fallbackLoop;
          }

          // Send system event about model fallback
          const fallbackNotice = `⚠️ ${currentModelName} 不可用，已自动切换至 ${nextModelInfo.name}`;
          console.log('[HTTPServer] Model fallback:', currentModelName, '->', nextModelInfo.name);
          res.write(`event: system\ndata: ${JSON.stringify({
            subtype: 'model_fallback',
            content: fallbackNotice,
            from: currentModelName,
            to: nextModelInfo.name
          })}\n\n`);
          (res as any).flush?.();

          // Create new runner with fallback model
          const fallbackRunner = new UnifiedAgentRunner(options.toolRegistry, {
            model: nextModelInfo.name,
            maxIterations: 0,
            approvalMode: session.approvalMode || 'dangerous',
            skillsLoader: options.skillsLoader,
            cwd: workDirManager.getCurrentWorkDir(),
          });

          // Update for next iteration
          currentRunner = fallbackRunner;
          currentModelName = nextModelInfo.name;
          triedModels.add(currentModelName);

          // Continue loop to retry with new model
          console.log('[HTTPServer] Retrying with fallback model:', currentModelName);
          continue;
        }
      }

      res.end();

      // 临时视觉 runner 用完即释放（不影响会话状态）
      if (visionRunner) {
        visionRunner.dispose?.();
        console.log('[HTTPServer] Vision runner disposed');
      }
    } catch (error: any) {
      console.error('[HTTPServer] Stream chat error:', error?.message || error, error?.stack);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Internal server error', detail: error?.message })}\n\n`);
      res.end();
    }
  });

  // Config routes
  app.get('/api/config', (_, res) => {
    try {
      const config = getConfig();
      res.json({
        models: config.models.map(m => ({
          name: m.name,
          provider: m.provider || m.protocol || 'openai',
          protocol: m.protocol,
          model: m.model,
          enabled: (m as any).enabled !== false  // 包含 enabled 字段
        })),
        defaultModel: config.defaultModel || (config.models.length > 0 ? config.models[0].name : null),
        officePreviewServer: config.officePreviewServer  // 添加 Office 预览服务器配置
      });
    } catch (error) {
      console.error('[HTTPServer] Config error:', error);
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  // Allowed paths routes
  app.get('/api/config/allowed-paths', (_, res) => {
    try {
      const config = getConfig();
      res.json({ allowedPaths: config.allowedPaths || [] });
    } catch (error) {
      console.error('[HTTPServer] Allowed paths error:', error);
      res.status(500).json({ error: 'Failed to get allowed paths' });
    }
  });

  app.put('/api/config/allowed-paths', requirePermission('editServerConfig'), (req, res) => {
    try {
      const { allowedPaths } = req.body;
      if (!Array.isArray(allowedPaths)) {
        return res.status(400).json({ error: 'allowedPaths must be an array' });
      }

      const config = getConfig();
      config.allowedPaths = allowedPaths;
      saveConfig(config);

      res.json({ allowedPaths: config.allowedPaths || [] });
    } catch (error) {
      console.error('[HTTPServer] Allowed paths update error:', error);
      res.status(500).json({ error: 'Failed to update allowed paths' });
    }
  });

  // Firecrawl API Key routes
  app.get('/api/config/firecrawl', (_, res) => {
    try {
      const config = getConfig();
      const apiKey = config.firecrawlApiKey || '';
      res.json({ apiKey: apiKey ? '***configured***' : '', configured: !!apiKey });
    } catch (error) {
      console.error('[HTTPServer] Firecrawl config error:', error);
      res.status(500).json({ error: 'Failed to get firecrawl config' });
    }
  });

  app.put('/api/config/firecrawl', requirePermission('editServerConfig'), async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (typeof apiKey !== 'string') {
        return res.status(400).json({ error: 'apiKey must be a string' });
      }

      const config = getConfig();
      if (apiKey.trim()) {
        config.firecrawlApiKey = apiKey.trim();
        // 热加载：立即更新当前进程的环境变量
        process.env.FIRECRAWL_API_KEY = apiKey.trim();
      } else {
        delete config.firecrawlApiKey;
        delete process.env.FIRECRAWL_API_KEY;
      }
      await saveConfig(config);

      res.json({ success: true, configured: !!config.firecrawlApiKey });
    } catch (error) {
      console.error('[HTTPServer] Firecrawl config update error:', error);
      res.status(500).json({ error: 'Failed to update firecrawl config' });
    }
  });

  // Office Preview Server routes
  app.get('/api/config/office-preview', (_, res) => {
    try {
      const config = getConfig();
      res.json({ url: config.officePreviewServer || 'https://officepreview.dsai.vip' });
    } catch (error) {
      console.error('[HTTPServer] Office preview config error:', error);
      res.status(500).json({ error: 'Failed to get office preview config' });
    }
  });

  app.put('/api/config/office-preview', requirePermission('editServerConfig'), async (req, res) => {
    try {
      const { url } = req.body;
      if (typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ error: 'url must be a non-empty string' });
      }
      const config = getConfig();
      config.officePreviewServer = url.trim();
      await saveConfig(config);
      res.json({ success: true, url: config.officePreviewServer });
    } catch (error) {
      console.error('[HTTPServer] Office preview config update error:', error);
      res.status(500).json({ error: 'Failed to update office preview config' });
    }
  });

  // Firecrawl API Key routes
  app.post('/api/config/reload', requirePermission('editServerConfig'), async (_, res) => {
    try {
      config = loadConfig(); // 同时更新局部闭包变量，确保所有路由读到最新配置
      res.json({ success: true, message: 'Configuration reloaded from disk' });
    } catch (error) {
      console.error('[HTTPServer] Config reload error:', error);
      res.status(500).json({ error: 'Failed to reload config' });
    }
  });

  // GET /api/models - Get all models
  app.get('/api/models', (_, res) => {
    try {
      const models = config.models.map(m => {
        const model: any = {
          name: m.name,
          model: m.model,
          apiKey: m.apiKey ? '***' : undefined, // Hide API Key
          baseUrl: m.baseUrl,
          baseURL: m.baseURL,
          endpoint: m.endpoint,
        };
        // 新字段
        if ((m as any).protocol) model.protocol = (m as any).protocol;
        if ((m as any).provider) model.provider = (m as any).provider;
        if ((m as any).enabled !== undefined) model.enabled = (m as any).enabled;
        if ((m as any).capabilities !== undefined) model.capabilities = (m as any).capabilities;
        // 向后兼容：也返回 type 字段
        model.type = (m as any).type || (m as any).protocol || 'openai';
        return model;
      });

      res.json({
        models,
        defaultModel: config.defaultModel || (models.length > 0 ? models[0].name : null)
      });
    } catch (error) {
      console.error('[API] Failed to get models:', error);
      res.status(500).json({ error: 'Failed to get models' });
    }
  });

  // Tools API - 列出所有可用工具
  app.get('/api/tools', (_, res) => {
    try {
      const tools = options.toolRegistry.listTools();
      res.json(tools);
    } catch (error) {
      console.error('[HTTPServer] Tools error:', error);
      res.status(500).json({ error: 'Failed to list tools' });
    }
  });

  // Skills API - 获取所有技能及其启用/禁用状态
  // 使用 enabledSkills 配置：只在列表中的才启用（默认禁用模式）
  app.get('/api/skills', (_, res) => {
    try {
      const allSkills = options.skillsLoader.list();
      const enabledSkills = config.enabledSkills || [];

      const skills = allSkills.map(s => ({
        name: s.name,
        description: s.description,
        enabled: enabledSkills.includes(s.name),
        source: s.skill.source,
        filePath: s.skill.filePath
      }));

      res.json({ skills });
    } catch (error) {
      console.error('[API] Failed to get skills:', error);
      res.status(500).json({ error: 'Failed to get skills' });
    }
  });

  // 热重载 skills：重新扫描 skills 目录，无需重启服务（必须在 /:name/toggle 之前注册）
  app.post('/api/skills/reload', requirePermission('installSkills'), async (_, res) => {
    try {
      const { count } = await options.skillsLoader.reload();
      console.log(`[HTTPServer] Skills reloaded: ${count} skills found`);
      res.json({ success: true, count });
    } catch (error) {
      console.error('[HTTPServer] Failed to reload skills:', error);
      res.status(500).json({ error: 'Failed to reload skills' });
    }
  });

  // 从 GitHub 安装 skill：下载仓库并复制到 skills 目录，随后热重载
  app.post('/api/skills/install', requirePermission('installSkills'), async (req, res) => {
    try {
      const { source } = req.body as { source?: string };
      if (!source?.trim()) {
        res.status(400).json({ success: false, error: 'Missing source parameter' });
        return;
      }

      const skillsDir = options.skillsLoader.getSkillsDir();
      const result = await installSkillFromSource(source.trim(), skillsDir);

      if (result.success) {
        // Hot-reload so the newly installed skills are immediately visible
        await options.skillsLoader.reload();
      }

      res.json(result);
    } catch (error) {
      console.error('[HTTPServer] Failed to install skill:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Toggle skill enabled/disabled status
  // 修改 enabledSkills 列表：添加或移除 skill 名称
  app.post('/api/skills/:name/toggle', requirePermission('installSkills'), async (req, res) => {
    try {
      const skillName = req.params.name;
      const enabledSkills = config.enabledSkills || [];

      // Check if skill exists
      const skill = options.skillsLoader.get(skillName);
      if (!skill) {
        res.status(404).json({ error: `Skill not found: ${skillName}` });
        return;
      }

      const isCurrentlyEnabled = enabledSkills.includes(skillName);

      if (isCurrentlyEnabled) {
        // Disable: remove from enabledSkills
        config.enabledSkills = enabledSkills.filter(s => s !== skillName);
      } else {
        // Enable: add to enabledSkills
        config.enabledSkills = [...enabledSkills, skillName];
      }

      // Save configuration to file
      await saveConfig(config);

      res.json({
        skill: skillName,
        enabled: !isCurrentlyEnabled // Returns new state
      });
    } catch (error) {
      console.error('[API] Failed to toggle skill:', error);
      res.status(500).json({ error: 'Failed to toggle skill' });
    }
  });

  // Download skill as .skill file
  // GET /api/skills/:name/download - 打包并下载 skill 文件
  app.get('/api/skills/:name/download', async (req, res) => {
    const execFileAsync = promisify(execFile);
    let tmpDir: string | null = null;
    try {
      const skillName = req.params.name;
      const loaded = options.skillsLoader.get(skillName);
      if (!loaded) {
        res.status(404).json({ error: `Skill not found: ${skillName}` });
        return;
      }

      const skillFilePath = loaded.skill.filePath;
      if (!skillFilePath) {
        res.status(400).json({ error: 'Skill has no file path' });
        return;
      }

      const skillDir = path.dirname(skillFilePath);
      const skillsDir = options.skillsLoader.getSkillsDir();
      const packageScript = path.join(skillsDir, 'skill-creator/scripts/package_skill.py');
      const packageScriptCwd = path.join(skillsDir, 'skill-creator');

      if (!fs.existsSync(packageScript)) {
        res.status(500).json({ error: 'package_skill.py not found' });
        return;
      }

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pkg-'));
      await execFileAsync('python3', ['-m', 'scripts.package_skill', skillDir, tmpDir], { cwd: packageScriptCwd });

      const outputFile = path.join(tmpDir, `${skillName}.skill`);
      if (!fs.existsSync(outputFile)) {
        res.status(500).json({ error: 'Packaging failed: output file not created' });
        return;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${skillName}.skill"`);
      const stream = fs.createReadStream(outputFile);
      stream.on('end', () => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      });
      stream.pipe(res);
    } catch (error: any) {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      const stderr = error?.stderr || '';
      console.error('[API] Failed to package skill:', error);
      res.status(500).json({ error: `Packaging failed: ${stderr || String(error)}` });
    }
  });

  // Upload .skill file to install
  // POST /api/skills/upload - 从 .skill 文件安装 skill
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() === '.skill') {
        cb(null, true);
      } else {
        cb(new Error('Only .skill files are allowed'));
      }
    }
  });

  app.post('/api/skills/upload', requirePermission('installSkills'), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
      }

      const skillsDir = options.skillsLoader.getSkillsDir();
      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries();

      // .skill 文件内部结构：<skillName>/SKILL.md 等
      // 找到顶层目录名作为 skill 名称
      const topDirs = new Set<string>();
      for (const entry of entries) {
        const parts = entry.entryName.split('/');
        if (parts[0]) topDirs.add(parts[0]);
      }

      if (topDirs.size === 0) {
        res.status(400).json({ success: false, error: 'Invalid .skill file: empty archive' });
        return;
      }

      // 解压到 skills 目录
      zip.extractAllTo(skillsDir, true);

      const installed = Array.from(topDirs);
      await options.skillsLoader.reload();

      console.log(`[API] Installed skill(s) from upload: ${installed.join(', ')}`);
      res.json({ success: true, installed });
    } catch (error: any) {
      console.error('[API] Failed to upload skill:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // List all files in a skill directory
  // GET /api/skills/:name/files
  app.get('/api/skills/:name/files', (req, res) => {
    try {
      const skillName = req.params.name;
      const loaded = options.skillsLoader.get(skillName);
      if (!loaded) {
        res.status(404).json({ error: `Skill not found: ${skillName}` });
        return;
      }
      const skillDir = path.normalize(path.dirname(loaded.skill.filePath));
      const files: string[] = [];
      function walkDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            walkDir(fullPath);
          } else if (!entry.isDirectory()) {
            files.push(path.relative(skillDir, fullPath));
          }
        }
      }
      walkDir(skillDir);
      res.json({ files });
    } catch (error) {
      console.error('[API] Failed to list skill files:', error);
      res.status(500).json({ error: 'Failed to list skill files' });
    }
  });

  // Read a specific file from a skill directory
  // GET /api/skills/:name/file?path=relative/path
  app.get('/api/skills/:name/file', async (req, res) => {
    try {
      const skillName = req.params.name;
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path query parameter' });
        return;
      }
      const loaded = options.skillsLoader.get(skillName);
      if (!loaded) {
        res.status(404).json({ error: `Skill not found: ${skillName}` });
        return;
      }
      const skillDir = path.normalize(path.dirname(loaded.skill.filePath));
      const targetPath = path.normalize(path.resolve(skillDir, filePath));
      if (!targetPath.startsWith(skillDir + path.sep)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (!fs.existsSync(targetPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const content = await fs.promises.readFile(targetPath, 'utf-8');
      res.json({ content });
    } catch (error) {
      console.error('[API] Failed to read skill file:', error);
      res.status(500).json({ error: 'Failed to read skill file' });
    }
  });

  // Save a specific file in a skill directory
  // PUT /api/skills/:name/file?path=relative/path
  app.put('/api/skills/:name/file', requirePermission('installSkills'), async (req, res) => {
    try {
      const skillName = req.params.name;
      const filePath = req.query.path as string;
      const { content } = req.body as { content?: string };
      if (!filePath) {
        res.status(400).json({ error: 'Missing path query parameter' });
        return;
      }
      if (content === undefined) {
        res.status(400).json({ error: 'Missing content in request body' });
        return;
      }
      const loaded = options.skillsLoader.get(skillName);
      if (!loaded) {
        res.status(404).json({ error: `Skill not found: ${skillName}` });
        return;
      }
      const skillDir = path.normalize(path.dirname(loaded.skill.filePath));
      const targetPath = path.normalize(path.resolve(skillDir, filePath));
      if (!targetPath.startsWith(skillDir + path.sep)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      await fs.promises.writeFile(targetPath, content, 'utf-8');
      // Hot-reload if SKILL.md was modified to update skill metadata
      if (path.basename(targetPath) === 'SKILL.md') {
        await options.skillsLoader.reload();
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[API] Failed to save skill file:', error);
      res.status(500).json({ error: 'Failed to save skill file' });
    }
  });

  // Commands API - 获取所有可用命令
  app.get('/api/commands', (_, res) => {
    try {
      const commands: Array<{ name: string; description: string; plugin: string }> = [];

      // 从 CommandRegistry 获取内置命令
      const systemCommands = commandRegistry.list();
      for (const cmd of systemCommands) {
        commands.push({
          name: cmd.name,
          description: cmd.description,
          plugin: 'system'
        });
      }

      // 如果有 pluginLoader，获取 plugin commands
      if (options.pluginLoader) {
        const pluginCommands = options.pluginLoader.getCommands();
        for (const cmd of pluginCommands) {
          commands.push({
            name: `${cmd.pluginName}:${cmd.name}`,
            description: cmd.description,
            plugin: cmd.pluginName
          });
        }
      }

      res.json({ commands });
    } catch (error) {
      console.error('[API] Failed to get commands:', error);
      res.status(500).json({ error: 'Failed to get commands' });
    }
  });

  // POST /api/models - Add new model
  app.post('/api/models', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const { name, protocol, provider, model, apiKey, baseUrl, endpoint, capabilities } = req.body;

      // Validate required fields
      if (!name || !model) {
        res.status(400).json({ error: 'Missing required fields: name, model' });
        return;
      }

      // 需要有 protocol 或 provider
      if (!protocol && !provider) {
        res.status(400).json({ error: 'Missing required fields: protocol or provider' });
        return;
      }

      // Check if name already exists
      if (config.models.some((m: any) => m.name === name)) {
        res.status(409).json({ error: `Model "${name}" already exists` });
        return;
      }

      // Add new model
      const newModel: any = {
        name,
        model,
        apiKey,
      };

      // 新字段
      if (protocol) newModel.protocol = protocol;
      if (provider) newModel.provider = provider;

      // 端点配置（统一使用 baseURL 字段）
      if (baseUrl || endpoint) {
        newModel.baseURL = baseUrl || endpoint;
      }

      // 能力标记
      if (capabilities !== undefined) newModel.capabilities = capabilities;

      config.models.push(newModel);
      await saveConfig(config);
      clearLLMClientCache(); // 清理客户端缓存，实现热加载
      resetEmbeddingsService(); // 同步重置 embedding 服务（配置可能变更）

      res.json({ success: true, model: newModel });
    } catch (error) {
      console.error('[API] Failed to add model:', error);
      res.status(500).json({ error: 'Failed to add model' });
    }
  });

  // PUT /api/models/default - Set default model (must be before /:name)
  app.put('/api/models/default', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const { name } = req.body;

      // Validate model exists
      if (!config.models.some(m => m.name === name)) {
        res.status(404).json({ error: `Model "${name}" not found` });
        return;
      }

      config.defaultModel = name;
      await saveConfig(config);
      clearLLMClientCache(); // 清理客户端缓存，实现热加载
      resetEmbeddingsService(); // 同步重置 embedding 服务（配置可能变更）

      res.json({ success: true, defaultModel: name });
    } catch (error) {
      console.error('[API] Failed to set default model:', error);
      res.status(500).json({ error: 'Failed to set default model' });
    }
  });

  // PUT /api/models/:name - Update model configuration
  app.put('/api/models/:name', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const oldName = req.params.name;
      const { name, protocol, provider, model, apiKey, baseUrl, endpoint, capabilities } = req.body;

      // Find model
      const modelIndex = config.models.findIndex((m: any) => m.name === oldName);
      if (modelIndex === -1) {
        res.status(404).json({ error: `Model "${oldName}" not found` });
        return;
      }

      // Update all fields (允许编辑模式下修改所有字段)
      const existingModel = config.models[modelIndex] as any;
      const updatedModel: any = {
        ...existingModel,
        name: name || existingModel.name,
      };

      // 更新 API Key（如果传入的是 *** 则保留原值）
      if (apiKey && apiKey !== '***') {
        updatedModel.apiKey = apiKey;
      } else if (apiKey === undefined) {
        // 如果没有传 apiKey，保留原值
        updatedModel.apiKey = existingModel.apiKey;
      }
      // 如果 apiKey === '***'，保留原值（不更新）

      // 更新协议和提供商
      if (protocol !== undefined) updatedModel.protocol = protocol;
      if (provider !== undefined) updatedModel.provider = provider;

      // 更新模型 ID
      if (model !== undefined) updatedModel.model = model;

      // 处理端点配置
      const newEndpoint = baseUrl || endpoint;
      if (newEndpoint !== undefined) {
        updatedModel.baseURL = newEndpoint || undefined;
        // 清理旧字段
        delete updatedModel.endpoint;
        delete updatedModel.baseUrl;
      }

      // 更新能力标记（undefined 表示前端未传，不覆盖；null/对象 表示有意设置）
      if (capabilities !== undefined) {
        updatedModel.capabilities = capabilities || undefined;
      }

      config.models[modelIndex] = updatedModel;

      // If name changed, update defaultModel if needed
      if (name && name !== oldName && config.defaultModel === oldName) {
        config.defaultModel = name;
      }

      await saveConfig(config);
      clearLLMClientCache(); // 清理客户端缓存，实现热加载
      resetEmbeddingsService(); // 同步重置 embedding 服务（配置可能变更）

      res.json({ success: true, model: config.models[modelIndex] });
    } catch (error) {
      console.error('[API] Failed to update model:', error);
      res.status(500).json({ error: 'Failed to update model' });
    }
  });

  // DELETE /api/models/:name - Delete model
  app.delete('/api/models/:name', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const name = req.params.name;

      // Find model
      const modelIndex = config.models.findIndex(m => m.name === name);
      if (modelIndex === -1) {
        res.status(404).json({ error: `Model "${name}" not found` });
        return;
      }

      // Check if it's the last model
      if (config.models.length === 1) {
        res.status(400).json({ error: 'Cannot delete the last model' });
        return;
      }

      // Delete model
      config.models.splice(modelIndex, 1);

      // If deleted model was default, switch to first model
      if (config.defaultModel === name) {
        config.defaultModel = config.models[0]?.name;
      }

      await saveConfig(config);
      clearLLMClientCache(); // 清理客户端缓存，实现热加载
      resetEmbeddingsService(); // 同步重置 embedding 服务（配置可能变更）

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Failed to delete model:', error);
      res.status(500).json({ error: 'Failed to delete model' });
    }
  });

  // POST /api/models/:name/toggle - Toggle model enabled state
  app.post('/api/models/:name/toggle', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const name = req.params.name;

      // Find model
      const model = config.models.find(m => m.name === name);
      if (!model) {
        res.status(404).json({ error: `Model "${name}" not found` });
        return;
      }

      // Toggle enabled state (default to true if not set)
      model.enabled = model.enabled === false ? true : false;

      await saveConfig(config);

      res.json({ success: true, model });
    } catch (error) {
      console.error('[API] Failed to toggle model:', error);
      res.status(500).json({ error: 'Failed to toggle model' });
    }
  });

  // POST /api/models/test - Test model configuration
  app.post('/api/models/test', requirePermission('editModelConfig'), async (req, res) => {
    try {
      const { name, protocol, provider, model, apiKey, baseUrl } = req.body;

      // Validate required fields
      if (!model) {
        res.status(400).json({ success: false, error: '模型 ID 不能为空' });
        return;
      }

      // 如果 apiKey 是 ***（前端显示占位符），需要从现有配置中获取真实密钥
      let testApiKey = apiKey;
      if (apiKey === '***' && name) {
        const existingModel = config.models.find((m: any) => m.name === name);
        if (existingModel) {
          testApiKey = existingModel.apiKey;
        }
      }

      if (!testApiKey || testApiKey === '***') {
        res.status(400).json({ success: false, error: 'API 密钥不能为空' });
        return;
      }

      // Determine the protocol to use
      const testProtocol = protocol || 'openai';

      // Determine the endpoint
      let testEndpoint = baseUrl;
      if (!testEndpoint && provider) {
        const { PROVIDER_DEFAULTS } = await import('../../config/schema.js');
        const providerConfig = PROVIDER_DEFAULTS[provider];
        if (providerConfig) {
          testEndpoint = providerConfig[testProtocol as 'openai' | 'anthropic'];
        }
      }

      if (!testEndpoint) {
        res.status(400).json({ success: false, error: 'API 端点不能为空' });
        return;
      }

      console.log(`[API] Testing model config: protocol=${testProtocol}, endpoint=${testEndpoint}, model=${model}`);

      // Test the connection based on protocol
      if (testProtocol === 'anthropic') {
        // Test Anthropic-compatible endpoint
        const Anthropic = (await import('@anthropic-ai/sdk')).default;

        // Check if it's MiniMax, GLM, or Antigravity (need Bearer auth)
        const isMiniMax = testEndpoint.includes('minimaxi.com');
        const isGLM = testEndpoint.includes('bigmodel.cn');
        const isAntigravity = testEndpoint.includes('antigravity');
        const needsBearerAuth = isMiniMax || isGLM || isAntigravity;

        const client = new Anthropic({
          apiKey: needsBearerAuth ? 'placeholder' : testApiKey,
          baseURL: testEndpoint,
          // 必须显式将 authToken 设为 null，否则 SDK 会自动读取
          // ANTHROPIC_AUTH_TOKEN 环境变量（Claude Code 注入的 token）并添加
          // Authorization: Bearer 头，导致第三方 Anthropic 兼容端点鉴权失败
          authToken: needsBearerAuth ? testApiKey : null,
          defaultHeaders: needsBearerAuth ? {
            'Authorization': `Bearer ${testApiKey}`
          } : undefined,
        });

        // Send a minimal test request
        const message = await client.messages.create({
          model: model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });

        res.json({
          success: true,
          message: '连接成功！模型响应正常',
          details: {
            model: message.model,
            responseLength: message.content?.length || 0,
          }
        });
      } else {
        // Test OpenAI-compatible endpoint
        const OpenAI = (await import('openai')).default;

        const client = new OpenAI({
          apiKey: testApiKey,
          baseURL: testEndpoint,
        });

        // Send a minimal test request
        const response = await client.chat.completions.create({
          model: model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });

        res.json({
          success: true,
          message: '连接成功！模型响应正常',
          details: {
            model: response.model,
            responseLength: response.choices?.[0]?.message?.content?.length || 0,
          }
        });
      }
    } catch (error: any) {
      console.error('[API] Model test failed:', error);

      // Extract meaningful error message
      let errorMessage = '连接失败';
      if (error?.message) {
        errorMessage = error.message;
      }
      if (error?.error?.message) {
        errorMessage = error.error.message;
      }
      if (error?.status === 401) {
        errorMessage = 'API 密钥无效或已过期';
      }
      if (error?.status === 404) {
        errorMessage = 'API 端点或模型不存在';
      }
      if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
        errorMessage = '无法连接到 API 端点';
      }

      res.json({
        success: false,
        error: errorMessage,
        details: error?.message || String(error),
      });
    }
  });

  // ========== Email Configuration APIs ==========

  // GET /api/email/config - 获取邮件配置（密码脱敏）
  app.get('/api/email/config', (_, res) => {
    try {
      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      // 密码脱敏
      const sanitizedAccounts = (emailConfig.accounts || []).map((account: EmailAccount) => ({
        ...account,
        password: account.password ? '***' : '',
      }));

      res.json({
        enabled: emailConfig.enabled || false,
        accounts: sanitizedAccounts,
        defaultAccountId: emailConfig.defaultAccountId,
        providers: EMAIL_PROVIDERS,
      });
    } catch (error) {
      console.error('[API] Failed to get email config:', error);
      res.status(500).json({ error: 'Failed to get email configuration' });
    }
  });

  // PUT /api/email/config - 更新邮件配置
  app.put('/api/email/config', async (req, res) => {
    try {
      const { enabled } = req.body;

      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      // 只更新 enabled 字段
      emailConfig.enabled = enabled ?? emailConfig.enabled;

      currentConfig.email = emailConfig;
      await saveConfig(currentConfig);

      res.json({ success: true, enabled: emailConfig.enabled });
    } catch (error) {
      console.error('[API] Failed to update email config:', error);
      res.status(500).json({ error: 'Failed to update email configuration' });
    }
  });

  // POST /api/email/accounts - 添加邮箱账户
  app.post('/api/email/accounts', async (req, res) => {
    try {
      const { name, email, password, provider, imap, smtp, isDefault } = req.body;

      // 验证必填字段
      if (!email || !password) {
        res.status(400).json({ error: 'Missing required fields: email, password' });
        return;
      }

      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      // 生成唯一 ID
      const accountId = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // 获取提供商预设
      const providerPreset = EMAIL_PROVIDERS[provider] || EMAIL_PROVIDERS.custom;

      const newAccount: EmailAccount = {
        id: accountId,
        name: name || email.split('@')[0],
        email,
        password,
        provider: provider || 'custom',
        imap: imap || providerPreset.imap,
        smtp: smtp || providerPreset.smtp,
        enabled: true,
        isDefault: isDefault ?? emailConfig.accounts?.length === 0,
      };

      // 如果设为默认，取消其他账户的默认状态
      if (newAccount.isDefault) {
        emailConfig.accounts?.forEach((a: EmailAccount) => {
          a.isDefault = false;
        });
        emailConfig.defaultAccountId = accountId;
      }

      emailConfig.accounts = emailConfig.accounts || [];
      emailConfig.accounts.push(newAccount);

      // 如果是第一个账户，自动启用邮件功能
      if (emailConfig.accounts.length === 1) {
        emailConfig.enabled = true;
      }

      currentConfig.email = emailConfig;
      await saveConfig(currentConfig);

      // 返回时脱敏密码
      res.json({
        success: true,
        account: {
          ...newAccount,
          password: '***',
        },
      });
    } catch (error) {
      console.error('[API] Failed to add email account:', error);
      res.status(500).json({ error: 'Failed to add email account' });
    }
  });

  // PUT /api/email/accounts/:id - 更新邮箱账户
  app.put('/api/email/accounts/:id', async (req, res) => {
    try {
      const accountId = req.params.id;
      const { name, email, password, provider, imap, smtp, enabled, isDefault } = req.body;

      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      const accountIndex = (emailConfig.accounts || []).findIndex((a: EmailAccount) => a.id === accountId);
      if (accountIndex === -1) {
        res.status(404).json({ error: `Account not found: ${accountId}` });
        return;
      }

      const account = emailConfig.accounts![accountIndex];

      // 更新字段（如果传入了新值）
      if (name !== undefined) account.name = name;
      if (email !== undefined) account.email = email;
      if (password && password !== '***') account.password = password;
      if (provider !== undefined) account.provider = provider;
      if (imap !== undefined) account.imap = imap;
      if (smtp !== undefined) account.smtp = smtp;
      if (enabled !== undefined) account.enabled = enabled;

      // 处理默认账户设置
      if (isDefault === true && !account.isDefault) {
        emailConfig.accounts?.forEach((a: EmailAccount) => {
          a.isDefault = a.id === accountId;
        });
        emailConfig.defaultAccountId = accountId;
      }
      if (isDefault !== undefined) {
        account.isDefault = isDefault;
      }

      currentConfig.email = emailConfig;
      await saveConfig(currentConfig);

      // 返回时脱敏密码
      res.json({
        success: true,
        account: {
          ...account,
          password: '***',
        },
      });
    } catch (error) {
      console.error('[API] Failed to update email account:', error);
      res.status(500).json({ error: 'Failed to update email account' });
    }
  });

  // DELETE /api/email/accounts/:id - 删除邮箱账户
  app.delete('/api/email/accounts/:id', async (req, res) => {
    try {
      const accountId = req.params.id;

      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      const accountIndex = (emailConfig.accounts || []).findIndex((a: EmailAccount) => a.id === accountId);
      if (accountIndex === -1) {
        res.status(404).json({ error: `Account not found: ${accountId}` });
        return;
      }

      // 删除账户
      emailConfig.accounts?.splice(accountIndex, 1);

      // 如果删除的是默认账户，重新设置默认账户
      if (emailConfig.defaultAccountId === accountId) {
        emailConfig.defaultAccountId = emailConfig.accounts?.[0]?.id;
        if (emailConfig.accounts?.[0]) {
          emailConfig.accounts[0].isDefault = true;
        }
      }

      // 如果没有账户了，禁用邮件功能
      if (emailConfig.accounts?.length === 0) {
        emailConfig.enabled = false;
      }

      currentConfig.email = emailConfig;
      await saveConfig(currentConfig);

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Failed to delete email account:', error);
      res.status(500).json({ error: 'Failed to delete email account' });
    }
  });

  // PUT /api/email/accounts/:id/default - 设置默认账户
  app.put('/api/email/accounts/:id/default', async (req, res) => {
    try {
      const accountId = req.params.id;

      const currentConfig = getConfig();
      const emailConfig = currentConfig.email || { enabled: false, accounts: [], defaultAccountId: undefined };

      const account = (emailConfig.accounts || []).find((a: EmailAccount) => a.id === accountId);
      if (!account) {
        res.status(404).json({ error: `Account not found: ${accountId}` });
        return;
      }

      // 取消其他账户的默认状态
      emailConfig.accounts?.forEach((a: EmailAccount) => {
        a.isDefault = a.id === accountId;
      });
      emailConfig.defaultAccountId = accountId;

      currentConfig.email = emailConfig;
      await saveConfig(currentConfig);

      res.json({ success: true, defaultAccountId: accountId });
    } catch (error) {
      console.error('[API] Failed to set default account:', error);
      res.status(500).json({ error: 'Failed to set default account' });
    }
  });

  // POST /api/email/test - 测试邮件账户连接
  app.post('/api/email/test', async (req, res) => {
    try {
      const { email, imap, smtp, accountId } = req.body;
      let { password } = req.body;

      // 若密码未提供（前端掩码显示 ***），从已保存配置中获取
      if (!password && accountId) {
        const currentConfig = loadConfig();
        const savedAccount = (currentConfig.email?.accounts || []).find(
          (a: EmailAccount) => a.id === accountId
        );
        if (savedAccount?.password) {
          password = savedAccount.password;
        }
      }

      if (!email || !password || !imap?.host || !smtp?.host) {
        res.status(400).json({ success: false, error: 'Missing required fields' });
        return;
      }

      const results: {
        imap: { success: boolean; message: string; durationMs?: number };
        smtp: { success: boolean; message: string; durationMs?: number };
      } = {
        imap: { success: false, message: '' },
        smtp: { success: false, message: '' },
      };

      // 测试 IMAP 连接
      const imapStart = Date.now();
      try {
        const Imap = (await import('imap')).default;
        const imapClient = new Imap({
          user: email,
          password,
          host: imap.host,
          port: imap.port || 993,
          tls: imap.tls !== false,
          connTimeout: 10000,
          authTimeout: 10000,
        });

        await new Promise<void>((resolve, reject) => {
          imapClient.once('ready', () => {
            imapClient.end();
            resolve();
          });
          imapClient.once('error', reject);
          imapClient.connect();
        });

        results.imap = {
          success: true,
          message: 'IMAP 连接成功',
          durationMs: Date.now() - imapStart,
        };
      } catch (err: any) {
        results.imap = {
          success: false,
          message: `IMAP 连接失败: ${err.message}`,
          durationMs: Date.now() - imapStart,
        };
      }

      // 测试 SMTP 连接
      const smtpStart = Date.now();
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          host: smtp.host,
          port: smtp.port || 465,
          secure: smtp.secure !== false,
          auth: { user: email, pass: password },
          tls: { rejectUnauthorized: true },
        });

        await transporter.verify();
        transporter.close();

        results.smtp = {
          success: true,
          message: 'SMTP 连接成功',
          durationMs: Date.now() - smtpStart,
        };
      } catch (err: any) {
        results.smtp = {
          success: false,
          message: `SMTP 连接失败: ${err.message}`,
          durationMs: Date.now() - smtpStart,
        };
      }

      const allPassed = results.imap.success && results.smtp.success;

      res.json({
        success: allPassed,
        message: allPassed ? '连接测试成功' : '部分连接失败',
        results,
      });
    } catch (error: any) {
      console.error('[API] Email test failed:', error);
      res.json({
        success: false,
        error: error.message || '连接测试失败',
      });
    }
  });

  // ========== Email Web API ==========

  // GET /api/emails/accounts - 获取邮箱账户列表
  app.get('/api/emails/accounts', (_, res) => {
    try {
      const accounts = getAccounts();
      // 脱敏返回
      res.json(accounts.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        provider: a.provider,
        isDefault: a.isDefault,
      })));
    } catch (error) {
      console.error('[API] Failed to get email accounts:', error);
      res.status(500).json({ error: 'Failed to get email accounts' });
    }
  });

  // GET /api/emails/mailboxes - 获取邮箱文件夹列表
  app.get('/api/emails/mailboxes', async (req, res) => {
    try {
      const accountId = req.query.accountId as string | undefined;
      const mailboxes = await listMailboxes(accountId);
      res.json(mailboxes);
    } catch (error: any) {
      console.error('[API] Failed to get mailboxes:', error);
      res.status(500).json({ error: error.message || 'Failed to get mailboxes' });
    }
  });

  // POST /api/emails/list - 获取邮件列表
  app.post('/api/emails/list', async (req, res) => {
    try {
      const { accountId, mailbox, limit, offset } = req.body;
      const emails = await listEmails(accountId, mailbox, limit || 50, offset || 0);
      res.json(emails);
    } catch (error: any) {
      console.error('[API] Failed to get emails:', error);
      res.status(500).json({ error: error.message || 'Failed to get emails' });
    }
  });

  // GET /api/emails/:uid - 获取邮件详情
  app.get('/api/emails/:uid', async (req, res) => {
    try {
      const uid = parseInt(req.params.uid, 10);
      const accountId = req.query.accountId as string | undefined;
      const mailbox = (req.query.mailbox as string) || 'INBOX';
      const email = await getEmail(accountId, uid, mailbox);
      res.json(email);
    } catch (error: any) {
      console.error('[API] Failed to get email:', error);
      res.status(500).json({ error: error.message || 'Failed to get email' });
    }
  });

  // GET /api/emails/:uid/attachments/:filename - 下载附件
  app.get('/api/emails/:uid/attachments/:filename', async (req, res) => {
    try {
      const uid = parseInt(req.params.uid, 10);
      const filename = req.params.filename;
      const accountId = req.query.accountId as string | undefined;
      const mailbox = (req.query.mailbox as string) || 'INBOX';
      const attachment = await getAttachment(accountId, uid, filename, mailbox);

      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
      res.send(attachment.content);
    } catch (error: any) {
      console.error('[API] Failed to get attachment:', error);
      res.status(500).json({ error: error.message || 'Failed to get attachment' });
    }
  });

  // PUT /api/emails/:uid/read - 标记为已读
  app.put('/api/emails/:uid/read', async (req, res) => {
    try {
      const uid = parseInt(req.params.uid, 10);
      const accountId = req.body.accountId as string | undefined;
      const mailbox = req.body.mailbox || 'INBOX';
      await markAsRead(accountId, uid, mailbox);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[API] Failed to mark as read:', error);
      res.status(500).json({ error: error.message || 'Failed to mark as read' });
    }
  });

  // PUT /api/emails/:uid/unread - 标记为未读
  app.put('/api/emails/:uid/unread', async (req, res) => {
    try {
      const uid = parseInt(req.params.uid, 10);
      const accountId = req.body.accountId as string | undefined;
      const mailbox = req.body.mailbox || 'INBOX';
      await markAsUnread(accountId, uid, mailbox);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[API] Failed to mark as unread:', error);
      res.status(500).json({ error: error.message || 'Failed to mark as unread' });
    }
  });

  // POST /api/emails/poll - 手动触发一次邮件轮询（供前端刷新按钮调用）
  app.post('/api/emails/poll', async (_req, res) => {
    try {
      const { triggerPoll } = await import('../../services/email-poller.js');
      await triggerPoll();
      res.json({ success: true });
    } catch (error: any) {
      console.error('[API] Email poll failed:', error);
      res.status(500).json({ error: error.message || 'Poll failed' });
    }
  });

  // Office 预览服务器代理（必须在 exploreRouter 之前注册，
  // 否则 exploreRouter 的全局认证中间件会拦截 /office-preview/* 请求）
  app.use('/office-preview', async (req, res) => {
    try {
      const config = getConfig();
      const previewServer = config.officePreviewServer;

      if (!previewServer) {
        return res.status(503).json({ error: 'Office preview server not configured' });
      }

      // 构建目标 URL（移除 /office-preview 前缀）
      const pathWithoutPrefix = req.originalUrl.replace(/^\/office-preview/, '') || '/';
      const targetUrl = `${previewServer}${pathWithoutPrefix}`;

      console.log('[HTTPServer] Office preview proxy:', req.originalUrl, '->', targetUrl);

      // 转发请求到 Office 预览服务器
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          ...req.headers as Record<string, string>,
          host: new URL(previewServer).host
        }
      });

      // 转发响应头（移除可能导致冲突的头）
      response.headers.forEach((value, key) => {
        const keyLower = key.toLowerCase();
        // 跳过 Transfer-Encoding，因为我们会用 Content-Length
        // 跳过 Content-Encoding，因为 fetch 已经自动解压了
        // 跳过 Content-Length，我们会重新设置
        if (keyLower === 'transfer-encoding' ||
            keyLower === 'content-encoding' ||
            keyLower === 'content-length') {
          return;
        }
        res.setHeader(key, value);
      });

      // 转发状态码和响应体
      res.status(response.status);
      const buffer = await response.arrayBuffer();
      // 设置正确的 Content-Length（基于解压后的内容）
      res.setHeader('Content-Length', buffer.byteLength);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('[HTTPServer] Office preview proxy error:', error);
      res.status(500).json({ error: 'Failed to proxy to office preview server' });
    }
  });

  // File explore routes
  app.use(exploreRouter);

  // Storage management routes
  app.use(storageRouter);

  // Cron routes
  if (options.cronService) {
    app.use('/api/cron', createCronRoutes(options.cronService));
  }

  // Tunnel routes
  app.use('/api/tunnel', createTunnelRoutes(options.tunnelManager));

  // Profile routes
  app.use('/api', profileRoutes);

  // Evolution routes
  app.use('/api/evolutions', evolutionRoutes);

  // Cron notification routes - 获取 cron 相关的 sessions 作为通知
  app.get('/api/cron/notifications', (req, res) => {
    try {
      const allSessions = options.sessionManager.listSessions();
      // 筛选出 cron 开头的 session
      const cronSessions = allSessions
        .filter(s => s.id.startsWith('cron:'))
        .sort((a, b) => b.updatedAt - a.updatedAt);

      // 获取已读状态（前端通过 localStorage 存储，这里返回所有未读）
      // 前端会维护已读状态，所以后端只需返回消息列表
      const notifications = cronSessions.map(session => {
        const lastMessage = session.messages[session.messages.length - 1];
        return {
          sessionId: session.id,
          jobId: session.id.replace('cron:', ''),
          jobName: session.name || '定时任务',
          message: lastMessage?.content || '',
          preview: lastMessage?.content?.substring(0, 100) || '',
          timestamp: lastMessage?.timestamp || session.updatedAt,
          isRead: false // 前端维护已读状态
        };
      }).filter(n => n.message); // 只返回有消息的

      const unreadCount = notifications.filter(n => !n.isRead).length;

      res.json({ notifications, unreadCount });
    } catch (error) {
      console.error('[HTTPServer] Get notifications error:', error);
      res.status(500).json({ error: 'Failed to get notifications' });
    }
  });

  // 标记通知为已读（后端只需要返回成功，前端自己维护状态）
  app.post('/api/cron/notifications/read', (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }
      // 后端不做额外处理，前端自己维护已读状态
      res.json({ success: true });
    } catch (error) {
      console.error('[HTTPServer] Mark read error:', error);
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });

  // File routes
  // 文件上传 (multipart/form-data) - 比 base64 JSON 快 ~30%，无编码开销
  const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  app.post('/api/files/upload', fileUpload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const fileStorage = getFileStorage();
      const { originalname, buffer, mimetype } = req.file;

      // multer 默认用 latin1 解码文件名，中文会乱码，需重新按 utf-8 解码
      const filename = Buffer.from(originalname, 'latin1').toString('utf8');

      const attachment = fileStorage.saveFile(filename, buffer, mimetype);
      const filePath = fileStorage.getFilePath(`${attachment.id}${path.extname(filename)}`);

      console.log(`[HTTPServer] File uploaded: ${filename} (${Math.round(buffer.length / 1024)}KB)`);

      res.status(201).json({ ...attachment, filePath });
    } catch (error) {
      console.error('[HTTPServer] File upload error:', error);
      res.status(500).json({ error: 'Failed to save file' });
    }
  });

  // 文件下载
  app.get('/api/files/:filename', (req, res) => {
    try {
      const fileStorage = getFileStorage();
      const filename = req.params.filename;

      const fileInfo = fileStorage.getFileInfo(filename);
      if (!fileInfo) {
        return res.status(404).json({ error: 'File not found' });
      }

      const content = fileStorage.readFile(filename);
      if (!content) {
        return res.status(404).json({ error: 'File not found' });
      }

      res.setHeader('Content-Type', fileInfo.mimeType);
      res.setHeader('Content-Length', fileInfo.size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(content);
    } catch (error) {
      console.error('[HTTPServer] File download error:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  // ========== Channel Management APIs ==========

  // 获取所有支持的频道定义
  app.get('/api/channels/definitions', (_, res) => {
    try {
      res.json({
        definitions: channelDefinitions.map(d => ({
          id: d.id,
          name: d.name,
          nameZh: d.nameZh,
          icon: d.icon,
          color: d.color,
          fields: Object.entries(d.configSchema).map(([key, field]) => ({
            key,
            type: field.type,
            label: field.label,
            labelZh: field.labelZh,
            required: field.required,
            placeholder: field.placeholder,
            placeholderZh: field.placeholderZh,
          })),
        })),
      });
    } catch (error) {
      console.error('[HTTPServer] Channel definitions error:', error);
      res.status(500).json({ error: 'Failed to get channel definitions' });
    }
  });

  // 获取所有频道配置和状态
  app.get('/api/channels', (_, res) => {
    try {
      const config = getConfig();
      const channelsConfig = config.channels || {};

      // 非飞书渠道按原有方式返回
      const nonFeishuChannels = channelDefinitions
        .filter(def => def.id !== 'feishu')
        .map(def => {
          const channelConfig = channelsConfig[def.id as keyof typeof channelsConfig];
          return {
            id: def.id,
            name: def.name,
            nameZh: def.nameZh,
            icon: def.icon,
            color: def.color,
            enabled: channelConfig?.enabled ?? (def.id === 'httpWs'),
            config: channelConfig || {},
          };
        });

      // 飞书实例单独展开（每个实例作为一条独立记录）
      const feishuDef = channelDefinitions.find(d => d.id === 'feishu')!;
      const feishuInstances = (config.feishuInstances || []).map(inst => ({
        id: `feishu:${inst.id}`,
        name: `Feishu (${inst.id})`,
        nameZh: `飞书 (${inst.id})`,
        icon: feishuDef.icon,
        color: feishuDef.color,
        enabled: inst.enabled ?? true,
        config: {
          instanceId: inst.id,
          appId: inst.appId,
          appSecret: inst.appSecret,
          verificationToken: inst.verificationToken,
          encryptKey: inst.encryptKey,
          profile: inst.profile,
          team: inst.team,
          workingDirectory: inst.workingDirectory,
        },
      }));

      res.json({ channels: [...nonFeishuChannels, ...feishuInstances] });
    } catch (error) {
      console.error('[HTTPServer] Channels error:', error);
      res.status(500).json({ error: 'Failed to get channels' });
    }
  });

  // 获取指定频道配置
  app.get('/api/channels/:id', (req, res) => {
    try {
      const { id } = req.params;
      const def = getChannelDefinition(id);
      if (!def) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const config = getConfig();
      const channelsConfig = config.channels || {};
      const channelConfig = channelsConfig[id as keyof typeof channelsConfig];

      res.json({
        id: def.id,
        name: def.name,
        nameZh: def.nameZh,
        icon: def.icon,
        color: def.color,
        enabled: channelConfig?.enabled ?? false,
        config: channelConfig || {},
      });
    } catch (error) {
      console.error('[HTTPServer] Channel error:', error);
      res.status(500).json({ error: 'Failed to get channel' });
    }
  });

  // 添加/更新频道配置
  app.post('/api/channels', (req, res) => {
    try {
      const { id, enabled, config: channelConfigInput } = req.body;

      // 飞书多实例：id 为 'feishu'（新建）或 'feishu:xxx'（编辑）
      if (id === 'feishu' || id?.startsWith('feishu:')) {
        const instanceId = id.startsWith('feishu:') ? id.slice('feishu:'.length) : channelConfigInput?.instanceId;
        if (!instanceId) {
          return res.status(400).json({ error: 'Missing instanceId for Feishu instance' });
        }
        if (!channelConfigInput?.appId) {
          return res.status(400).json({ error: 'Missing required field: App ID' });
        }
        if (!channelConfigInput?.appSecret) {
          return res.status(400).json({ error: 'Missing required field: App Secret' });
        }

        let currentConfig = getConfig();
        const instances: any[] = [...(currentConfig.feishuInstances || [])];
        const idx = instances.findIndex(i => i.id === instanceId);
        const newInstance = {
          id: instanceId,
          enabled: enabled ?? true,
          appId: channelConfigInput.appId,
          appSecret: channelConfigInput.appSecret,
          verificationToken: channelConfigInput.verificationToken,
          encryptKey: channelConfigInput.encryptKey,
          profile: channelConfigInput.profile || 'default',
          team: channelConfigInput.team,
          workingDirectory: channelConfigInput.workingDirectory,
        };
        if (idx >= 0) {
          instances[idx] = { ...instances[idx], ...newInstance };
        } else {
          instances.push(newInstance);
        }
        currentConfig = { ...currentConfig, feishuInstances: instances };
        saveConfig(currentConfig);

        const feishuDef = channelDefinitions.find(d => d.id === 'feishu')!;
        return res.json({
          id: `feishu:${instanceId}`,
          name: `Feishu (${instanceId})`,
          nameZh: `飞书 (${instanceId})`,
          icon: feishuDef.icon,
          color: feishuDef.color,
          enabled: enabled ?? true,
          config: newInstance,
        });
      }

      const def = getChannelDefinition(id);
      if (!def) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // 验证必填字段
      for (const [key, field] of Object.entries(def.configSchema)) {
        if (field.required && !channelConfigInput?.[key]) {
          return res.status(400).json({ error: `Missing required field: ${field.label}` });
        }
      }

      // 加载当前配置
      let currentConfig = getConfig();
      const channelsConfig: Record<string, any> = currentConfig.channels || {};

      // 更新指定频道配置
      channelsConfig[id] = {
        ...channelsConfig[id],
        ...channelConfigInput,
        enabled: enabled ?? false,
      };

      // 保存配置
      currentConfig = {
        ...currentConfig,
        channels: channelsConfig,
      };
      saveConfig(currentConfig);

      res.json({
        id,
        name: def.name,
        nameZh: def.nameZh,
        enabled: enabled ?? false,
        config: channelsConfig[id],
      });
    } catch (error) {
      console.error('[HTTPServer] Save channel error:', error);
      res.status(500).json({ error: 'Failed to save channel' });
    }
  });

  // 删除频道配置
  app.delete('/api/channels/:id', (req, res) => {
    try {
      const { id } = req.params;

      if (id === 'httpWs') {
        return res.status(400).json({ error: 'Cannot delete httpWs channel' });
      }

      // 飞书多实例删除
      if (id.startsWith('feishu:')) {
        const instanceId = id.slice('feishu:'.length);
        let currentConfig = getConfig();
        const instances = (currentConfig.feishuInstances || []).filter((i: any) => i.id !== instanceId);
        currentConfig = { ...currentConfig, feishuInstances: instances };
        saveConfig(currentConfig);
        return res.status(204).send();
      }

      const def = getChannelDefinition(id);
      if (!def) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // 加载当前配置
      let currentConfig = getConfig();
      const channelsConfig: Record<string, any> = currentConfig.channels || {};

      // 删除指定频道配置
      delete channelsConfig[id];

      // 保存配置
      currentConfig = {
        ...currentConfig,
        channels: channelsConfig,
      };
      saveConfig(currentConfig);

      res.status(204).send();
    } catch (error) {
      console.error('[HTTPServer] Delete channel error:', error);
      res.status(500).json({ error: 'Failed to delete channel' });
    }
  });

  // 启用/禁用频道（支持热加载）
  app.post('/api/channels/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      // 飞书多实例：仅更新配置，热加载由 initializer 处理
      if (id.startsWith('feishu:')) {
        const instanceId = id.slice('feishu:'.length);
        let currentConfig = getConfig();
        const instances: any[] = [...(currentConfig.feishuInstances || [])];
        const idx = instances.findIndex(i => i.id === instanceId);
        if (idx < 0) {
          return res.status(404).json({ error: `Feishu instance '${instanceId}' not found` });
        }
        instances[idx] = { ...instances[idx], enabled };
        currentConfig = { ...currentConfig, feishuInstances: instances };
        saveConfig(currentConfig);

        // 热启停
        let result;
        if (enabled) {
          result = await hotStartChannel(id);
        } else {
          result = await hotStopChannel(id);
        }

        return res.json({ id, enabled, message: result.message });
      }

      const def = getChannelDefinition(id);
      if (!def) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // 热加载：动态启动或停止频道
      let result;
      if (enabled) {
        result = await hotStartChannel(id);
      } else {
        result = await hotStopChannel(id);
      }

      if (!result.success) {
        // 如果热加载失败，返回错误（但配置已经保存）
        return res.status(400).json({ error: result.message });
      }

      res.json({
        id,
        enabled,
        message: result.message,
      });
    } catch (error) {
      console.error('[HTTPServer] Toggle channel error:', error);
      res.status(500).json({ error: 'Failed to toggle channel' });
    }
  });

  // 测试频道连接
  app.post('/api/channels/:id/test', async (req, res) => {
    try {
      const { id } = req.params;

      // 根据渠道类型执行不同的测试逻辑
      let success = false;
      let message = '';

      if (id === 'feishu' || id.startsWith('feishu:')) {
        // 飞书连接测试（支持单实例和多实例）
        const cfg = getConfig();
        let appId: string | undefined;
        let appSecret: string | undefined;

        if (id.startsWith('feishu:')) {
          const instanceId = id.slice('feishu:'.length);
          const inst = (cfg.feishuInstances || []).find((i: any) => i.id === instanceId);
          appId = inst?.appId;
          appSecret = inst?.appSecret;
        } else {
          appId = cfg.channels?.feishu?.appId;
          appSecret = cfg.channels?.feishu?.appSecret;
        }

        if (!appId || !appSecret) {
          message = 'Feishu is not configured or disabled';
        } else {
          try {
            // 尝试获取 tenant_access_token
            const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
            });
            const data = await response.json() as any;

            if (data.code === 0) {
              success = true;
              message = 'Connection successful';
            } else {
              message = `Feishu API error: ${data.msg}`;
            }
          } catch (err: any) {
            message = `Connection failed: ${err.message}`;
          }
        }
      } else {
        const def = getChannelDefinition(id);
        if (!def) {
          return res.status(404).json({ error: 'Channel not found' });
        }

        if (id === 'slack') {
          // Slack 连接测试
          const cfg = getConfig();
          const slackConfig = cfg.channels?.slack;

          if (!slackConfig?.enabled || !slackConfig?.botToken) {
            message = 'Slack is not configured or disabled';
          } else {
            try {
              const response = await fetch('https://slack.com/api/auth.test', {
                headers: { 'Authorization': `Bearer ${slackConfig.botToken}` },
              });
              const data = await response.json() as any;

              if (data.ok) {
                success = true;
                message = `Connected as ${data.user}`;
              } else {
                message = `Slack API error: ${data.error}`;
              }
            } catch (err: any) {
              message = `Connection failed: ${err.message}`;
            }
          }
        } else if (id === 'httpWs') {
          // Web UI 总是可用的
          success = true;
          message = 'Web UI is always available';
        } else {
          // 其他渠道暂不支持测试
          message = `Connection test not implemented for ${def.name}`;
        }
      }

      res.json({
        success,
        message,
      });
    } catch (error) {
      console.error('[HTTPServer] Test channel error:', error);
      res.status(500).json({ error: 'Failed to test channel' });
    }
  });

  // 工作目录管理 API
  // 获取当前工作目录信息
  app.get('/api/workdir', (_, res) => {
    try {
      const info = workDirManager.getWorkDirInfo();
      res.json(info);
    } catch (error) {
      console.error('[HTTPServer] Get workdir error:', error);
      res.status(500).json({ error: 'Failed to get work directory' });
    }
  });

  // 设置工作目录
  app.post('/api/workdir', (req, res) => {
    try {
      const { path: newDir } = req.body;

      if (!newDir || typeof newDir !== 'string') {
        return res.status(400).json({ error: 'Path is required' });
      }

      const result = workDirManager.setCurrentWorkDir(newDir);

      if (result.success) {
        res.json({
          success: true,
          current: workDirManager.getCurrentWorkDir()
        });
      } else {
        res.status(400).json({
          error: result.error
        });
      }
    } catch (error) {
      console.error('[HTTPServer] Set workdir error:', error);
      res.status(500).json({ error: 'Failed to set work directory' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 权限请求响应 API
  // 用于前端响应 AgentRunner 发出的权限请求
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/permission/respond', async (req, res) => {
    try {
      const { sessionId, requestId, approved, updatedInput } = req.body;

      if (!sessionId || !requestId || approved === undefined) {
        res.status(400).json({
          error: 'Missing required fields: sessionId, requestId, approved'
        });
        return;
      }

      const agentRunner = activeAgentRunners.get(sessionId);
      if (!agentRunner) {
        console.log('[HTTPServer] No active agentRunner found for session:', sessionId);
        res.json({
          success: true,
          message: 'No active permission request (no active runner)'
        });
        return;
      }

      // 响应权限请求（仅 ClaudeAgentRunner 支持此功能）
      if (agentRunner.respondToPermission) {
        await agentRunner.respondToPermission(requestId, approved, updatedInput);
        res.json({ success: true });
      } else {
        res.json({
          success: true,
          message: 'Permission management not supported by current runner'
        });
      }
    } catch (error) {
      console.error('[HTTPServer] Permission respond error:', error);
      res.status(500).json({ error: 'Failed to respond to permission request' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 停止对话 API
  // 用于前端停止当前正在进行的对话
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/chat/stop', (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        res.status(400).json({ error: 'Missing required field: sessionId' });
        return;
      }

      const agentRunner = activeAgentRunners.get(sessionId);
      if (!agentRunner) {
        console.log('[HTTPServer] No active agentRunner found for session:', sessionId);
        res.json({
          success: true,
          message: 'No active conversation to stop'
        });
        return;
      }

      // 调用 abort 方法停止对话
      if (agentRunner instanceof UnifiedAgentRunner) {
        agentRunner.abort();
        console.log('[HTTPServer] Aborted conversation for session:', sessionId);
        res.json({ success: true, message: 'Conversation stopped' });
      } else {
        res.json({
          success: false,
          message: 'Stop not supported by current runner'
        });
      }
    } catch (error) {
      console.error('[HTTPServer] Stop chat error:', error);
      res.status(500).json({ error: 'Failed to stop conversation' });
    }
  });

  // ============================================================
  // Agent Teams API
  // ============================================================

  // GET /api/agent-teams/tools — 返回可用工具列表（供前端 ToolSelector）
  app.get('/api/agent-teams/tools', (_req, res) => {
    res.json({
      tools: [
        { id: 'Read',          group: 'file',    label: 'Read' },
        { id: 'Write',         group: 'file',    label: 'Write' },
        { id: 'Edit',          group: 'file',    label: 'Edit' },
        { id: 'Glob',          group: 'file',    label: 'Glob' },
        { id: 'Grep',          group: 'file',    label: 'Grep' },
        { id: 'Bash',          group: 'exec',    label: 'Bash' },
        { id: 'WebSearch',     group: 'web',     label: 'WebSearch' },
        { id: 'WebFetch',      group: 'web',     label: 'WebFetch' },
        { id: 'firecrawl',     group: 'web',     label: 'Firecrawl' },
        { id: 'remember',      group: 'memory',  label: 'Remember' },
        { id: 'memory_search', group: 'memory',  label: 'Memory Search' },
        { id: 'nas_list',      group: 'storage', label: 'NAS List' },
        { id: 'nas_upload',    group: 'storage', label: 'NAS Upload' },
        { id: 'nas_download',  group: 'storage', label: 'NAS Download' },
        { id: 'send_file',     group: 'other',   label: 'Send File' },
        { id: 'cron_manage',   group: 'other',   label: 'Cron Manage' },
        { id: 'read_skill',    group: 'other',   label: 'Read Skill' },
      ],
    });
  });

  // GET /api/agent-teams/skills — 返回所有已安装的 Skills 列表（供 subagent 预加载选择）
  app.get('/api/agent-teams/skills', (_req, res) => {
    try {
      const allSkills = options.skillsLoader.list().map(s => ({ name: s.name, description: s.description }));
      res.json({ skills: allSkills });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get skills' });
    }
  });

  // GET /api/agent-teams — 列出所有团队（用户配置 + 预置未保存的示例）
  app.get('/api/agent-teams', (_req, res) => {
    try {
      const config = getConfig();
      const userTeams: AgentTeam[] = config.agentTeams || [];
      // 将预置团队中尚未被用户保存的部分作为示例附上（标记 isPreset）
      const userIds = new Set(userTeams.map(t => t.id));
      const presets = PRESET_TEAMS
        .filter(p => !userIds.has(p.id))
        .map(p => ({ ...p, _isPreset: true }));
      res.json({ teams: [...userTeams, ...presets] });
    } catch (error) {
      console.error('[HTTPServer] agent-teams GET error:', error);
      res.status(500).json({ error: 'Failed to get agent teams' });
    }
  });

  // POST /api/agent-teams — 创建团队
  app.post('/api/agent-teams', async (req, res) => {
    try {
      const parsed = AgentTeamSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid team data', details: parsed.error.flatten() });
      }
      const newTeam = parsed.data;
      const config = getConfig();
      const teams: AgentTeam[] = config.agentTeams || [];
      if (teams.some(t => t.id === newTeam.id)) {
        return res.status(409).json({ error: `Team "${newTeam.id}" already exists` });
      }
      await saveConfig({ ...config, agentTeams: [...teams, newTeam] });
      res.json({ success: true, team: newTeam });
    } catch (error) {
      console.error('[HTTPServer] agent-teams POST error:', error);
      res.status(500).json({ error: 'Failed to create agent team' });
    }
  });

  // PUT /api/agent-teams/:id — 更新团队
  app.put('/api/agent-teams/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = AgentTeamSchema.safeParse({ ...req.body, id });
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid team data', details: parsed.error.flatten() });
      }
      const updatedTeam = parsed.data;
      const config = getConfig();
      const teams: AgentTeam[] = config.agentTeams || [];
      const idx = teams.findIndex(t => t.id === id);
      if (idx === -1) {
        // 若不存在（首次保存预置团队），直接追加
        await saveConfig({ ...config, agentTeams: [...teams, updatedTeam] });
      } else {
        const newTeams = [...teams];
        newTeams[idx] = updatedTeam;
        await saveConfig({ ...config, agentTeams: newTeams });
      }
      res.json({ success: true, team: updatedTeam });
    } catch (error) {
      console.error('[HTTPServer] agent-teams PUT error:', error);
      res.status(500).json({ error: 'Failed to update agent team' });
    }
  });

  // DELETE /api/agent-teams/:id — 删除团队
  app.delete('/api/agent-teams/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const config = getConfig();
      const teams: AgentTeam[] = config.agentTeams || [];
      const newTeams = teams.filter(t => t.id !== id);
      if (newTeams.length === teams.length) {
        return res.status(404).json({ error: 'Team not found' });
      }
      await saveConfig({ ...config, agentTeams: newTeams });
      res.json({ success: true });
    } catch (error) {
      console.error('[HTTPServer] agent-teams DELETE error:', error);
      res.status(500).json({ error: 'Failed to delete agent team' });
    }
  });

  // POST /api/agent-teams/:id/toggle — 启用/禁用团队
  app.post('/api/agent-teams/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const config = getConfig();
      const teams: AgentTeam[] = config.agentTeams || [];
      const idx = teams.findIndex(t => t.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Team not found' });
      }
      const newTeams = [...teams];
      newTeams[idx] = { ...newTeams[idx], enabled: !newTeams[idx].enabled };
      await saveConfig({ ...config, agentTeams: newTeams });
      res.json({ success: true, enabled: newTeams[idx].enabled });
    } catch (error) {
      console.error('[HTTPServer] agent-teams toggle error:', error);
      res.status(500).json({ error: 'Failed to toggle agent team' });
    }
  });

  // 启动邮件轮询服务（如果配置了邮箱账户）
  startEmailPoller();

  return app;
}
