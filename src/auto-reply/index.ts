// src/auto-reply/index.ts

import { MessageDispatcher, DispatchResult, StreamGenerator } from './dispatch.js';
import { CommandRegistry, registerHelpCommand } from './commands/registry.js';
import { registerClearCommand } from './commands/clear.js';
import { registerStatusCommand } from './commands/status.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { registerModelCommand } from './commands/model.js';
import { registerLearningCommand } from './commands/learning.js';
import { ChannelMessage, ChannelContext } from '../channels/channel.interface.js';
import type { IAgentRunner } from '../agents/unified-runner.js';
import { UnifiedAgentRunner } from '../agents/unified-runner.js';
import { SessionManager } from '../session/manager.js';
import { MemoryManager } from '../memory/manager.js';
import { ToolRegistry } from '../agents/tools/registry.js';
import type { PluginLoader } from '../plugins/loader.js';

export { MessageDispatcher } from './dispatch.js';
export type { DispatchResult, StreamGenerator } from './dispatch.js';

export class AutoReply {
  private dispatcher: MessageDispatcher;
  private commandRegistry: CommandRegistry;
  private pluginLoader?: PluginLoader;

  constructor(
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    memoryManager: MemoryManager,
    agentRunner?: IAgentRunner,
    pluginLoader?: PluginLoader
  ) {
    const runner = agentRunner || new UnifiedAgentRunner(toolRegistry);
    this.dispatcher = new MessageDispatcher(runner, sessionManager, memoryManager);
    this.commandRegistry = new CommandRegistry();
    this.pluginLoader = pluginLoader;

    // Register commands
    registerHelpCommand(this.commandRegistry);
    registerClearCommand(this.commandRegistry, sessionManager);
    registerStatusCommand(this.commandRegistry, sessionManager);
    registerWhoamiCommand(this.commandRegistry);
    registerModelCommand(this.commandRegistry);
    registerLearningCommand(this.commandRegistry);
  }

  /**
   * 获取命令注册表（用于 plugin commands）
   */
  getCommandRegistry(): CommandRegistry {
    return this.commandRegistry;
  }

  async handleMessage(
    content: string,
    context: { platform: string; chatId: string; userId: string }
  ): Promise<DispatchResult | null> {
    // Check for plugin commands first (/plugin:command format)
    if (content.startsWith('/') && content.includes(':')) {
      const result = await this.handlePluginCommand(content, context);
      if (result) {
        return result;
      }
      // 如果不是有效的 plugin command，继续处理其他逻辑
    }

    // Check for built-in commands
    const parsed = this.commandRegistry.parse(content);
    if (parsed) {
      const command = this.commandRegistry.get(parsed.command);
      if (command) {
        // 将 context 传给命令处理器，让命令可以感知当前会话
        const response = await command.handler(parsed.args, context);
        return { response, success: true };
      }
    }

    // Build ChannelMessage
    const message: ChannelMessage = {
      id: `${Date.now()}`,
      content,
      chatId: context.chatId,
      userId: context.userId,
      platform: context.platform,
      timestamp: Date.now(),
    };

    // Build ChannelContext
    const channelContext: ChannelContext = {
      platform: context.platform,
      chatId: context.chatId,
      userId: context.userId,
    };

    // Handle as regular message
    return this.dispatcher.dispatch(message, channelContext);
  }

  /**
   * 处理 plugin command (/plugin:command 格式)
   */
  private async handlePluginCommand(
    content: string,
    context: { platform: string; chatId: string; userId: string }
  ): Promise<DispatchResult | null> {
    if (!this.pluginLoader) {
      console.log('[AutoReply] PluginLoader not available, skipping plugin command');
      return null;
    }

    const parsed = this.pluginLoader.parseCommandMessage(content);
    if (!parsed) {
      return null;
    }

    const { pluginName, commandName, args } = parsed;
    const command = this.pluginLoader.getCommand(pluginName, commandName);

    if (!command) {
      console.log(`[AutoReply] Command not found: ${pluginName}:${commandName}`);
      return {
        response: `未找到命令: /${pluginName}:${commandName}\n\n可用的 ${pluginName} 插件命令:\n${this.listPluginCommands(pluginName)}`,
        success: false,
      };
    }

    console.log(`[AutoReply] Executing plugin command: ${pluginName}:${commandName}, args: ${args}`);

    // 构建 command prompt
    const commandPrompt = this.pluginLoader.buildCommandPrompt(command, args);

    // Build ChannelMessage with command prompt
    const message: ChannelMessage = {
      id: `${Date.now()}`,
      content: commandPrompt,
      chatId: context.chatId,
      userId: context.userId,
      platform: context.platform,
      timestamp: Date.now(),
    };

    // 标记这是一个 plugin command 消息（用于显示）
    (message as any)._pluginCommand = `/${pluginName}:${commandName}`;
    (message as any)._originalContent = args;

    // Build ChannelContext
    const channelContext: ChannelContext = {
      platform: context.platform,
      chatId: context.chatId,
      userId: context.userId,
    };

    // 分发处理
    return this.dispatcher.dispatch(message, channelContext);
  }

  /**
   * 列出指定插件的可用命令
   */
  private listPluginCommands(pluginName: string): string {
    if (!this.pluginLoader) return '';

    const plugin = this.pluginLoader.getPlugin(pluginName);
    if (!plugin) {
      return `插件 "${pluginName}" 不存在`;
    }

    return plugin.commands
      .map(c => `  /${pluginName}:${c.name} - ${c.description || '无描述'}`)
      .join('\n');
  }

  /**
   * 流式处理消息（支持飞书等平台的流式输出）
   */
  async *handleMessageStream(
    content: string,
    context: { platform: string; chatId: string; userId: string; attachments?: import('../types.js').FileAttachment[] }
  ): StreamGenerator {
    // Check for plugin commands first
    if (content.startsWith('/') && content.includes(':')) {
      // Plugin commands don't support streaming, return as regular message
      const result = await this.handleMessage(content, context);
      if (result) {
        yield { type: 'text', content: result.response };
        yield { type: 'done', files: result.files };
      }
      return;
    }

    // Check for built-in commands
    const parsed = this.commandRegistry.parse(content);
    if (parsed) {
      const command = this.commandRegistry.get(parsed.command);
      if (command) {
        // Commands don't support streaming
        const response = await command.handler(parsed.args, context);
        yield { type: 'text', content: response };
        yield { type: 'done' };
        return;
      }
    }

    // Build ChannelMessage
    const message: ChannelMessage = {
      id: `${Date.now()}`,
      content,
      chatId: context.chatId,
      userId: context.userId,
      platform: context.platform,
      timestamp: Date.now(),
      attachments: context.attachments,
    };

    // Build ChannelContext
    const channelContext: ChannelContext = {
      platform: context.platform,
      chatId: context.chatId,
      userId: context.userId,
    };

    // Handle as streaming message
    yield* this.dispatcher.dispatchStream(message, channelContext);
  }
}
