// src/plugins/command-registry.ts

import { CommandHandler, CommandContext, CommandResult } from './types.js';

export class CommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();
  private commandMetadata: Map<string, { description: string; pluginName: string }> = new Map();

  /**
   * 注册 command
   * 注册为: /plugin:command
   */
  register(pluginName: string, commandName: string, handler: CommandHandler, description: string): void {
    const fullName = `${pluginName}:${commandName}`;
    this.commands.set(fullName, handler);
    this.commandMetadata.set(fullName, { description, pluginName });
  }

  /**
   * 执行 command
   */
  async execute(fullCommand: string, args: string[], context: CommandContext): Promise<CommandResult> {
    const [pluginName, commandName] = fullCommand.split(':');
    const fullName = `${pluginName}:${commandName}`;

    const handler = this.commands.get(fullName);
    if (!handler) {
      throw new Error(`Command /${fullName} not found`);
    }

    return await handler(args, context);
  }

  /**
   * 获取所有 commands
   */
  getAllCommands(): Array<{ name: string; description: string; pluginName: string }> {
    const result: Array<{ name: string; description: string; pluginName: string }> = [];
    for (const [name, metadata] of Array.from(this.commandMetadata)) {
      result.push({
        name: `/${name}`,
        description: metadata.description,
        pluginName: metadata.pluginName,
      });
    }
    return result;
  }

  /**
   * 检查是否为 plugin command
   */
  isPluginCommand(message: string): boolean {
    return message.startsWith('/') && message.includes(':');
  }

  /**
   * 解析 command
   */
  parseCommand(message: string): { command: string; args: string[] } | null {
    if (!this.isPluginCommand(message)) {
      return null;
    }

    const trimmed = message.slice(1); // 去掉前导 /
    const parts = trimmed.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    return { command, args };
  }

  /**
   * 注册内容命令（用于直接执行 markdown 内容）
   */
  registerContentCommand(pluginName: string, commandName: string, content: string, description: string): void {
    const handler: CommandHandler = async (args: string[], context: CommandContext) => {
      // 内容命令返回内容作为消息
      return {
        message: content,
        attachments: []
      };
    };

    this.register(pluginName, commandName, handler, description);
  }
}
