// src/auth/password.ts
import * as argon2 from 'argon2';

/**
 * 使用 argon2id 算法哈希密码
 * 返回格式：argon2id:$argon2id$v=19$m=65536,t=3,p=4$...
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  const hash = await argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,      // 64 MB
    timeCost: 3,             // 3 iterations
    parallelism: 4,          // 4 threads
  });
  return `argon2id:${hash}`;
}

/**
 * 验证密码是否匹配
 * 仅支持 argon2id 格式，拒绝旧 SHA-256 格式
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string
): Promise<boolean> {
  // 拒绝旧的 SHA-256 格式
  if (storedHash.startsWith('sha256:')) {
    return false;
  }

  // 解析 argon2id: 前缀
  if (!storedHash.startsWith('argon2id:')) {
    return false;
  }

  const actualHash = storedHash.slice('argon2id:'.length);

  try {
    return await argon2.verify(actualHash, plainPassword);
  } catch {
    return false;
  }
}
