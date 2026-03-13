# MantisBot 用户权限管理体系设计文档

**日期**：2026-03-14
**状态**：待实现
**适用版本**：MantisBot v1.3+

---

## 1. 背景与目标

### 1.1 背景

MantisBot 当前仅支持单用户认证（`config.json` 中配置单一 admin 账号，HMAC 无状态 Token）。随着企业内部部署需求增长（20-200 人规模），需要设计一套完整的多用户权限管理体系。

### 1.2 设计目标

- 支持多用户登录，基于 RBAC 角色模型进行权限控制
- 支持对 FileManager 中的文件/目录进行路径级 ACL 控制
- 采用 JWT Access Token + Refresh Token 混合会话方案
- 用户数据存储于独立的 SQLite 系统库（`data/system.db`）
- 预留 SSO（OIDC/LDAP）扩展点，当前阶段仅实现本地认证
- 向后兼容现有单用户配置

### 1.3 不在本期范围内

- SSO / OIDC / LDAP 集成
- 多租户隔离
- 用户配额与计费控制

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Web UI / API Client               │
└──────────────────────┬──────────────────────────────┘
                       │ Bearer Token
┌──────────────────────▼──────────────────────────────┐
│              Auth Middleware（鉴权层）                │
│  1. 提取 Access Token                                │
│  2. 验证签名 + 过期时间                               │
│  3. 注入 req.user（角色、userId、permissions）        │
│  4. Permission Guard：检查当前路由所需权限             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Auth Service（认证服务）                 │
│  login() / logout() / refreshToken()                │
│  createUser() / updateUser() / deleteUser()         │
│  resolveFilePermission()                            │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│         System SQLite DB（独立系统数据库）             │
│  data/system.db                                     │
│  表：users / roles / refresh_tokens /               │
│      path_acl / audit_logs                         │
└─────────────────────────────────────────────────────┘
```

**核心分层原则：**
- **鉴权层**：无状态，每请求验证 Access Token，不查 DB
- **认证服务**：有状态操作（登录、刷新、用户管理）才查 DB
- **系统库**：`data/system.db`，与 memory 的 `data/memory.db` 完全隔离

---

## 3. 数据模型

### 3.1 `roles` 表

```sql
CREATE TABLE roles (
  id           TEXT PRIMARY KEY,        -- role_admin / role_member 等
  name         TEXT UNIQUE NOT NULL,    -- 显示名
  description  TEXT,
  is_builtin   INTEGER DEFAULT 0,       -- 内置角色不可删除
  permissions  TEXT NOT NULL,           -- JSON: {"chat":true,"viewHistory":true,...}
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

**内置角色预设（首次初始化写入）：**

| role_id | name | 核心权限 |
|---------|------|---------|
| `role_admin` | 管理员 | 全部 true |
| `role_member` | 普通成员 | chat / viewHistory / useAgentTeams / useFileManager |
| `role_viewer` | 访客 | chat（只读）/ viewHistory |

**权限位定义：**

| 权限 key | 说明 |
|---------|------|
| `chat` | 发起对话 |
| `viewHistory` | 查看历史记录 |
| `useAgentTeams` | 使用 Agent 团队 |
| `editModelConfig` | 编辑模型配置 |
| `editServerConfig` | 编辑服务器配置 |
| `manageUsers` | 管理用户 |
| `useFileManager` | 使用文件管理器 |
| `accessStorage` | 访问存储配置 |
| `installSkills` | 安装技能 |
| `managePlugins` | 管理插件 |

### 3.2 `users` 表

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,        -- u_xxxxxxxx
  username        TEXT UNIQUE NOT NULL,
  password        TEXT NOT NULL,           -- "sha256:<hex>"
  display_name    TEXT,
  role_id         TEXT NOT NULL DEFAULT 'role_member',
  enabled         INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_login_at   INTEGER,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);
```

### 3.3 `path_acl` 表

```sql
CREATE TABLE path_acl (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type  TEXT NOT NULL,   -- 'role' | 'user'
  subject_id    TEXT NOT NULL,   -- role_id 或 user_id
  storage_id    TEXT NOT NULL,   -- 存储提供商 id（如 'local' / 'nas-1'）
  path          TEXT NOT NULL,   -- 授权路径，如 '/documents' 或 '/'
  permission    TEXT NOT NULL,   -- 'read' | 'write' | 'none'
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_path_acl
  ON path_acl(subject_type, subject_id, storage_id, path);
```

**权限解析优先级（从高到低）：**
```
用户级 ACL  >  角色级 ACL  >  默认拒绝
```

**路径匹配**：最长前缀匹配，`/docs/private` 比 `/docs` 更优先。

### 3.4 `refresh_tokens` 表

```sql
CREATE TABLE refresh_tokens (
  token       TEXT PRIMARY KEY,       -- 随机 64 字节 hex
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,       -- Unix 时间戳
  created_at  INTEGER NOT NULL,
  revoked     INTEGER DEFAULT 0,
  user_agent  TEXT,                   -- 记录来源设备
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 3.5 `audit_logs` 表

```sql
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  action      TEXT NOT NULL,   -- login/logout/create_user/update_acl 等
  target      TEXT,            -- 操作对象（如被操作的 userId）
  ip          TEXT,
  metadata    TEXT,            -- JSON，记录变更前后值
  created_at  INTEGER NOT NULL
);
```

---

## 4. Token 与会话机制

### 4.1 双层 Token 设计

```
登录成功
    │
    ├─► Access Token（JWT，15分钟有效）
    │     payload: { userId, username, roleId, roleName, permissions, exp, iat }
    │     签名: HS256(JWT_SECRET)
    │     存储: 仅客户端内存（不写 localStorage）
    │
    └─► Refresh Token（随机 hex，7天有效）
          存储: 服务端 refresh_tokens 表 + 客户端 HttpOnly Cookie
```

### 4.2 JWT Payload 结构

```typescript
interface JWTPayload {
  userId: string
  username: string
  roleId: string
  roleName: string
  permissions: Record<string, boolean>  // 权限快照，无需查 DB
  exp: number
  iat: number
}
```

### 4.3 会话生命周期

```
客户端                          服务端
  │                               │
  │── POST /auth/login ──────────►│ 验证密码
  │◄─ { accessToken, 设置Cookie }─│ 写入 refresh_tokens 表
  │                               │
  │── API请求 (Bearer AT) ────────►│ 验证JWT签名+exp（不查DB）
  │◄─ 200 OK ─────────────────────│
  │                               │
  │  [AT即将过期，自动静默刷新]      │
  │── POST /auth/refresh ─────────►│ 验证 Cookie 中的 RT
  │◄─ { 新 accessToken } ──────────│ RT未过期且未revoked → 签发新AT
  │                               │
  │── POST /auth/logout ──────────►│ revoke RT（标记 revoked=1）
  │◄─ 200 OK，清除Cookie ──────────│
```

### 4.4 安全措施

| 措施 | 说明 |
|------|------|
| AT 存内存 | 不写 localStorage/sessionStorage，防 XSS 窃取 |
| RT 存 HttpOnly Cookie | JS 无法读取；配合 SameSite=Strict 防 CSRF |
| AT 15分钟短期有效 | 即使泄露，窗口极小 |
| RT 单次使用轮转 | 每次 refresh 吊销旧 RT 并签发新 RT，检测 Token 复用攻击 |
| 强制下线 | 管理员可 revoke 用户所有 RT，下次 AT 过期后自动踢出 |
| JWT_SECRET 环境变量 | 不写入 config.json，通过 `process.env.JWT_SECRET` 读取 |

### 4.5 SSO 预留扩展点

```typescript
interface AuthProvider {
  type: 'local' | 'oidc' | 'ldap'  // 预留 oidc / ldap
  authenticate(credentials: unknown): Promise<UserEntry>
}
```

---

## 5. 权限校验流程

### 5.1 中间件分层

```
请求进入
    │
    ▼
┌─────────────────────────────┐
│  authenticateMiddleware      │  ← 验证 AT 签名和过期
│  解析 JWT → req.user         │    失败 → 401
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  requirePermission(key)      │  ← 路由级权限守卫
│  检查 req.user.permissions   │    失败 → 403
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  fileAccessGuard（可选）      │  ← 仅文件管理路由启用
│  解析目标路径                 │    查 path_acl 表
│  最长前缀匹配 ACL             │    失败 → 403
└─────────────┬───────────────┘
              │
              ▼
           Route Handler
```

### 5.2 路由权限映射

| 路由前缀 | 所需权限 |
|---------|---------|
| `POST /auth/*` | 无需权限（公开） |
| `GET /api/chat` | `chat` |
| `GET /api/history` | `viewHistory` |
| `GET /api/agent-teams` | `useAgentTeams` |
| `GET/POST /api/storage/*` | `useFileManager` + fileAccessGuard |
| `PUT /api/config/models` | `editModelConfig` |
| `PUT /api/config/server` | `editServerConfig` |
| `GET/POST /api/skills` | `installSkills` |
| `GET/POST /api/plugins` | `managePlugins` |
| `GET/POST /api/users` | `manageUsers` |

### 5.3 文件路径 ACL 解析算法

```
输入: userId, roleId, storageId, requestPath

1. 查询所有匹配规则:
   SELECT * FROM path_acl
   WHERE storage_id = ?
   AND subject_id IN (userId, roleId)
   AND ? LIKE path || '%'        ← 前缀匹配
   ORDER BY length(path) DESC    ← 最长前缀优先

2. 优先级合并:
   user 级规则  >  role 级规则

3. 未匹配任何规则 → 默认拒绝

示例:
  role_member → /public : read
  user_alice  → /public : write

  alice 访问 /public/doc.txt  → write ✓
  bob(member) 访问 /public/doc.txt → read ✓
  bob 访问 /private/secret.txt → 拒绝 ✗
```

---

## 6. Web UI 交互设计

### 6.1 登录页

- 用户名 + 密码表单
- 预留 SSO 登录入口（灰色/即将推出状态）

### 6.2 用户管理页（需 `manageUsers` 权限）

- 用户列表：搜索、角色筛选、启用/停用
- 新建/编辑用户侧滑抽屉：
  - 基本信息（显示名、角色、状态）
  - 文件权限：展示角色继承规则（灰色）+ 用户个人覆盖规则（蓝色），支持添加/删除
  - 危险操作：重置密码、强制下线（revoke 所有 RT）

### 6.3 角色管理页（仅 admin 可见）

- 展示内置角色（不可删除）和自定义角色
- 支持新建/编辑自定义角色，勾选权限位
- 支持删除自定义角色（需先将用户迁移至其他角色）

### 6.4 前端 Auth Store

```typescript
interface AuthStore {
  accessToken: string | null      // 仅存内存
  user: JWTPayload | null         // 解码自 AT
  isAuthenticated: boolean

  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
  refreshToken(): Promise<void>   // 页面加载时、AT 过期前静默调用
}
```

**页面刷新无感处理**：AT 存内存，刷新页面时自动调用 `/auth/refresh`，用 HttpOnly Cookie 中的 RT 换取新 AT，用户无感知。

---

## 7. 目录结构

```
src/
├── auth/                          ← 新增：认证核心模块（不依赖 Express）
│   ├── db.ts                      ← system.db 初始化、Schema 迁移
│   ├── jwt.ts                     ← AT 签发/验证（HS256）
│   ├── password.ts                ← SHA-256 哈希/验证
│   ├── token-store.ts             ← refresh_tokens CRUD
│   ├── users-store.ts             ← users CRUD
│   ├── roles-store.ts             ← roles CRUD + 内置角色初始化
│   ├── path-acl-store.ts          ← path_acl CRUD + 前缀匹配解析
│   ├── audit-logger.ts            ← audit_logs 写入
│   └── auth-service.ts            ← 组合以上，暴露业务方法
│
├── channels/http-ws/
│   ├── middleware/
│   │   ├── authenticate.ts        ← 替换旧 auth-middleware.ts
│   │   ├── require-permission.ts  ← requirePermission(key) 工厂函数
│   │   └── file-access-guard.ts   ← fileAccessGuard 中间件
│   └── routes/
│       ├── auth-routes.ts         ← /auth/login|logout|refresh
│       └── users-routes.ts        ← /api/users /api/roles /api/path-acl
│
web-ui/src/
├── stores/
│   └── auth-store.ts              ← AT 内存管理（Zustand 或 Context）
├── hooks/
│   ├── useAuth.ts                 ← 认证状态 hook
│   └── usePermission.ts           ← 细粒度权限检查 hook
├── components/
│   ├── LoginPage.tsx              ← 登录页（复用并更新）
│   ├── UserManagementSection.tsx  ← 用户管理页（重写）
│   ├── RoleManagementSection.tsx  ← 角色管理页（新增）
│   └── PathAclEditor.tsx          ← 文件权限编辑器（新增）
│
data/
├── system.db                      ← 独立系统库（新增）
└── memory.db                      ← 原有，不变
│
config/
└── config.json                    ← 仅保留 server.auth.enabled 开关
                                      移除 username/password 字段（迁移至 system.db）
```

---

## 8. 向后兼容策略

1. `config.json` 中 `server.auth.enabled = false` 时，完全跳过鉴权（现有行为保留）
2. 首次启动时，若检测到旧的 `server.auth.username/password` 配置，自动迁移为 admin 用户写入 `system.db`
3. 迁移完成后，从 `config.json` 移除 `username/password` 字段
4. `feature/multi-user-auth` 分支的 `users.json` 格式不再支持，一次性迁移脚本处理

---

## 9. 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥（必须设置，否则启动报错） | 无 |
| `JWT_AT_TTL` | Access Token 有效期（秒） | `900`（15分钟） |
| `JWT_RT_TTL` | Refresh Token 有效期（秒） | `604800`（7天） |

---

## 10. 未来扩展点

| 功能 | 扩展方式 |
|------|---------|
| OIDC SSO | 实现 `AuthProvider` 接口，新增 `oidc` provider |
| LDAP 认证 | 实现 `AuthProvider` 接口，新增 `ldap` provider |
| 用户组/部门 | 在 `path_acl.subject_type` 增加 `group`，新增 `groups` 和 `user_groups` 表 |
| 操作审计 UI | 基于 `audit_logs` 表新增审计日志查询页面 |
| 登录失败锁定 | 在 `users` 表增加 `failed_login_count` 和 `locked_until` 字段 |
