// src/channels/registry.ts

import type { IChannel } from './channel.interface.js';

export class ChannelRegistry {
  private channels: Map<string, IChannel> = new Map();

  register(channel: IChannel): void {
    if (this.channels.has(channel.name)) {
      throw new Error(`Channel ${channel.name} already registered`);
    }
    this.channels.set(channel.name, channel);
    console.log(`[ChannelRegistry] Registered channel: ${channel.name}`);
  }

  unregister(name: string): void {
    this.channels.delete(name);
    console.log(`[ChannelRegistry] Unregistered channel: ${name}`);
  }

  get(name: string): IChannel | undefined {
    return this.channels.get(name);
  }

  getByPlatform(platform: string): IChannel | undefined {
    for (const channel of this.channels.values()) {
      if (channel.platform === platform) {
        return channel;
      }
    }
    return undefined;
  }

  getAllByPlatform(platform: string): IChannel[] {
    return Array.from(this.channels.values()).filter(c => c.platform === platform);
  }

  getAll(): IChannel[] {
    return Array.from(this.channels.values());
  }

  getEnabled(): IChannel[] {
    return this.getAll().filter(c => c.enabled);
  }
}

// 单例实例
let registryInstance: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!registryInstance) {
    registryInstance = new ChannelRegistry();
  }
  return registryInstance;
}
