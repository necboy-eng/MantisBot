// src/cli.ts
// 命令行工具：重置 admin 用户密码
// 用法：node --import tsx/esm src/cli.ts reset-admin-password [--username admin]

import { parseArgs } from 'util';
import { initSystemDb, closeSystemDb } from './auth/db.js';
import { initBuiltinRoles } from './auth/roles-store.js';
import { getUserByUsername, createUser, updateUser } from './auth/users-store.js';
import { hashPassword } from './auth/password.js';
import { randomBytes } from 'crypto';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    username: { type: 'string', short: 'u', default: 'admin' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help || positionals[0] === 'help') {
  console.log(`
MantisBot CLI

Usage:
  node --import tsx/esm src/cli.ts reset-admin-password [--username <username>]

Options:
  --username, -u  Admin username to reset (default: admin)
  --help, -h      Show this help
  `);
  process.exit(0);
}

if (positionals[0] === 'reset-admin-password') {
  (async () => {
    initSystemDb();
    initBuiltinRoles();

    const username = values.username as string;
    const tempPassword = randomBytes(9).toString('base64url');
    const existing = getUserByUsername(username);

    if (existing) {
      updateUser(existing.id, {
        passwordHash: await hashPassword(tempPassword),
        forcePasswordChange: 1,
        tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
        isEnabled: 1,
      });
      console.log(`✅ 已重置用户 '${username}' 的密码`);
    } else {
      // 用户不存在则创建
      createUser({
        username,
        passwordHash: await hashPassword(tempPassword),
        roleId: 'role_admin',
        forcePasswordChange: 1,
        tempPasswordExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      console.log(`✅ 已创建 admin 用户 '${username}'`);
    }

    console.log(`\n临时密码（24小时内有效，首次登录须修改）：`);
    console.log(`  ${tempPassword}\n`);

    closeSystemDb();
    process.exit(0);
  })();
} else {
  console.error(`未知命令: ${positionals[0] ?? '(none)'}`);
  console.error('运行 --help 查看帮助');
  process.exit(1);
}
