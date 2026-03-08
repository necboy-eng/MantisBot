import type { Tool } from '../../types.js';
import { SkillsLoader } from '../skills/loader.js';
import { broadcastToClients } from '../../channels/http-ws/ws-server.js';
import fs from 'fs';
import path from 'path';

// 导出共享的 SkillsLoader 实例
let skillsLoaderInstance: SkillsLoader | null = null;

export function setSkillsLoader(loader: SkillsLoader): void {
  skillsLoaderInstance = loader;
}

export function getSkillsLoader(): SkillsLoader | null {
  return skillsLoaderInstance;
}

/**
 * 广播 skill 使用事件到前端
 */
export function broadcastSkillUsage(location: string, skillName: string): void {
  broadcastToClients('skill-used', {
    location,
    skillName,
    timestamp: Date.now()
  });
}

/**
 * 安全地读取文件内容，限制大小
 */
function safeReadFile(filePath: string, maxSize: number = 10000): { content: string; truncated: boolean } {
  try {
    if (!fs.existsSync(filePath)) {
      return { content: `文件不存在: ${filePath}`, truncated: false };
    }

    const stats = fs.statSync(filePath);
    if (stats.size > maxSize) {
      // 读取前 maxSize 字节
      const buffer = Buffer.alloc(maxSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, maxSize, 0);
      fs.closeSync(fd);
      return {
        content: buffer.toString('utf-8') + '\n\n[文件内容已截断...]',
        truncated: true
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, truncated: false };
  } catch (error) {
    return { content: `读取文件失败: ${error}`, truncated: false };
  }
}

export const readSkillTool: Tool = {
  name: 'read_skill',
  description: '读取技能文件（SKILL.md）的内容。当你在 <available_skills> 中找到匹配的技能时，使用这个工具读取技能文件，然后按照文件中的指令执行操作。',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: '技能文件的完整路径（从 <location> 标签获取）'
      }
    },
    required: ['location']
  },
  execute: async (params: Record<string, unknown>): Promise<unknown> => {
    const { location } = params;

    if (!location || typeof location !== 'string') {
      return {
        success: false,
        error: '需要提供技能文件路径 (location)'
      };
    }

    // 安全检查：确保路径在 skills 或 plugins 目录下
    // 用 path.resolve 将相对路径转为绝对路径，再做前缀校验
    const normalizedPath = path.resolve(location);
    const cwd = process.cwd();
    const skillsDir = path.normalize(path.join(cwd, 'skills'));
    const pluginsDir = path.normalize(path.join(cwd, 'plugins'));

    // 支持 skills/ 和 plugins/ 目录
    const isValidPath =
      normalizedPath.startsWith(skillsDir) ||
      normalizedPath.includes('/skills/') ||
      normalizedPath.startsWith(pluginsDir) ||
      normalizedPath.includes('/plugins/');

    if (!isValidPath) {
      return {
        success: false,
        error: '只能读取 skills 或 plugins 目录下的文件'
      };
    }

    // 检查文件扩展名
    const ext = path.extname(normalizedPath).toLowerCase();
    if (ext !== '.md' && ext !== '.txt' && ext !== '.json') {
      return {
        success: false,
        error: '只能读取 .md, .txt, .json 文件'
      };
    }

    // 读取文件内容
    const { content, truncated } = safeReadFile(normalizedPath, 15000);

    // 从路径中提取 skill 名称
    let skillName = '';
    if (normalizedPath.includes('/plugins/')) {
      // plugins/productivity/skills/task-management/SKILL.md
      const parts = normalizedPath.split('/plugins/')[1]?.split('/');
      if (parts && parts.length >= 2) {
        skillName = `${parts[0]}/${parts[2]?.replace('.md', '')}`;
      }
    } else if (normalizedPath.includes('/skills/')) {
      // skills/github/SKILL.md
      const parts = normalizedPath.split('/skills/')[1]?.split('/');
      if (parts && parts[0]) {
        skillName = parts[0];
      }
    }

    // 广播 skill 使用事件到前端
    if (skillName) {
      broadcastSkillUsage(normalizedPath, skillName);
    }

    return {
      success: true,
      location: normalizedPath,
      skillName,
      content,
      truncated,
      instruction: '请阅读上面的技能文件内容，然后按照其中的指令执行用户请求。'
    };
  }
};
