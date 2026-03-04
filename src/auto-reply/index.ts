// src/auto-reply/index.ts

import { MessageDispatcher, DispatchResult } from './dispatch.js';
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

export { MessageDispatcher } from './dispatch.js';
export type { DispatchResult } from './dispatch.js';

export class AutoReply {
  private dispatcher: MessageDispatcher;
  private commandRegistry: CommandRegistry;

  constructor(
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    memoryManager: MemoryManager,
    agentRunner?: IAgentRunner
  ) {
    const runner = agentRunner || new UnifiedAgentRunner(toolRegistry);
    this.dispatcher = new MessageDispatcher(runner, sessionManager, memoryManager);
    this.commandRegistry = new CommandRegistry();

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
      // Handle plugin command - return null to let caller handle it
      // Plugin commands are handled separately via PluginCommandHandler
      return null;
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
}
