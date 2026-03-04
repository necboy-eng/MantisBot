// src/auto-reply/commands/learning.ts

import type { CommandRegistry } from './registry.js';
import { selfImproving } from '../../hooks/self-improving.js';

/**
 * 注册 /learning 命令
 *
 * 记录和查看学习日志（self-improving-agent 集成）
 *
 * 用法：
 *   /learning                        → 查看最近的学习记录
 *   /learning add <内容>             → 记录新的学习
 *   /learning error <内容>           → 记录错误
 *   /learning feature <内容>         → 记录功能请求
 *   /learning clear                  → 清空所有日志（暂不实现）
 */
export function registerLearningCommand(registry: CommandRegistry): void {
  registry.register({
    name: 'learning',
    description: '记录和查看学习日志',
    aliases: ['learn', 'log'],
    handler: async (args, _context) => {
      const argsStr = Array.isArray(args) ? args.join(' ') : args;
      const parts = argsStr.trim().split(/\s+/);
      const subCommand = parts[0]?.toLowerCase();
      const content = parts.slice(1).join(' ');

      // 无参数：显示帮助和最近记录
      if (!subCommand) {
        return showRecentLearnings();
      }

      switch (subCommand) {
        case 'add':
        case 'new':
          if (!content) {
            return '❌ 请提供学习内容，例如：`/learning add 用户喜欢简洁的代码风格`';
          }
          await selfImproving.logLearning('learning', content);
          return `✅ 已记录学习：${content}`;

        case 'error':
        case 'err':
          if (!content) {
            return '❌ 请提供错误内容，例如：`/learning error npm install 权限不足`';
          }
          await selfImproving.logLearning('error', content, { category: 'runtime' });
          return `✅ 已记录错误：${content}`;

        case 'feature':
        case 'req':
          if (!content) {
            return '❌ 请提供功能描述，例如：`/learning feature 添加深色模式支持`';
          }
          await selfImproving.logLearning('feature', content);
          return `✅ 已记录功能请求：${content}`;

        case 'list':
        case 'ls':
          return showRecentLearnings();

        default:
          // 如果没有子命令，把整个 args 当作学习内容
          const fullContent = argsStr.trim();
          if (fullContent) {
            await selfImproving.logLearning('learning', fullContent);
            return `✅ 已记录学习：${fullContent}`;
          }
          return showHelp();
      }
    },
  });
}

/**
 * 显示帮助信息
 */
function showHelp(): string {
  return `📝 **Learning 命令帮助**

用法：
• \`/learning\` - 查看最近的学习记录
• \`/learning <内容>\` - 快速记录学习
• \`/learning add <内容>\` - 记录学习
• \`/learning error <内容>\` - 记录错误
• \`/learning feature <内容>\` - 记录功能请求

示例：
• \`/learning 用户喜欢简洁的代码风格\`
• \`/learning error Docker 容器启动失败\`
• \`/learning feature 添加深色模式\``;
}

/**
 * 显示最近的学习记录
 */
async function showRecentLearnings(): Promise<string> {
  try {
    const [learnings, errors, features] = await Promise.all([
      selfImproving.readLearnings('learnings'),
      selfImproving.readLearnings('errors'),
      selfImproving.readLearnings('features'),
    ]);

    const sections: string[] = ['📝 **学习日志**\n'];

    // 学习记录
    const learningLines = extractRecentEntries(learnings, 3);
    if (learningLines.length > 0) {
      sections.push('**📚 最近学习：**');
      sections.push(learningLines.map(l => `• ${l}`).join('\n'));
    }

    // 错误记录
    const errorLines = extractRecentEntries(errors, 2);
    if (errorLines.length > 0) {
      sections.push('\n**⚠️ 最近错误：**');
      sections.push(errorLines.map(e => `• ${e}`).join('\n'));
    }

    // 功能请求
    const featureLines = extractRecentEntries(features, 2);
    if (featureLines.length > 0) {
      sections.push('\n**💡 功能请求：**');
      sections.push(featureLines.map(f => `• ${f}`).join('\n'));
    }

    if (learningLines.length === 0 && errorLines.length === 0 && featureLines.length === 0) {
      sections.push('暂无记录。使用 `/learning add <内容>` 开始记录。');
    }

    sections.push('\n---\n`/learning <内容>` 快速记录 | `/learning help` 查看帮助');

    return sections.join('\n');
  } catch (error) {
    return `❌ 读取学习日志失败：${error}`;
  }
}

/**
 * 从 Markdown 内容中提取最近的条目
 */
function extractRecentEntries(content: string, limit: number): string[] {
  if (!content || content.includes('No ') && content.includes('logged yet')) {
    return [];
  }

  // 按 --- 分割，提取最近的条目
  const entries = content.split(/---/)
    .map(e => e.trim())
    .filter(e => e && !e.startsWith('#')) // 过滤掉标题
    .slice(-limit); // 取最近的几条

  return entries.map(entry => {
    // 提取时间戳后的内容
    const lines = entry.split('\n').filter(l => l.trim());
    if (lines.length === 0) return entry.slice(0, 100);

    // 第一行通常是时间戳和分类，取后面的内容
    const contentLines = lines.slice(1).join(' ').trim();
    if (contentLines.startsWith('**Context:**')) {
      return lines.slice(2).join(' ').trim().slice(0, 100) || entry.slice(0, 100);
    }
    return contentLines.slice(0, 100) || entry.slice(0, 100);
  }).filter(e => e);
}
