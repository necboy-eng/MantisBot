// src/plugins/mcp-client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPServerConfig, MCPTool, MCPConnection } from './types.js';

/**
 * MCP Client for connecting to MCP servers
 *
 * Uses @modelcontextprotocol/sdk for full MCP protocol support.
 * Supports stdio, SSE, and HTTP transports.
 */
export class MCPClient {
  private connections: Map<string, MCPConnection> = new Map();

  /**
   * Connect to an MCP server
   */
  async connect(serverName: string, config: MCPServerConfig): Promise<MCPConnection> {
    // Check if already connected
    const existing = this.connections.get(serverName);
    if (existing?.client) {
      console.log(`[MCP] Already connected to server: ${serverName}`);
      return existing;
    }

    const client = new Client(
      { name: 'mantisbot', version: '1.0.0' },
      { capabilities: {} }
    );

    try {
      let transport;

      switch (config.type) {
        case 'stdio':
          transport = await this.createStdioTransport(config);
          break;
        case 'sse':
          transport = await this.createSSETransport(config);
          break;
        case 'http':
          transport = await this.createHTTPTransport(config);
          break;
        default:
          throw new Error(`Unknown MCP server type: ${(config as any).type}`);
      }

      await client.connect(transport);

      const connection: MCPConnection = { serverName, config, client };
      this.connections.set(serverName, connection);

      console.log(`[MCP] Connected to server: ${serverName}`);
      return connection;
    } catch (error) {
      console.error(`[MCP] Failed to connect to ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Create stdio transport for local process MCP servers
   */
  private async createStdioTransport(config: MCPServerConfig): Promise<StdioClientTransport> {
    if (!config.command) {
      throw new Error('stdio MCP server requires "command" field');
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...process.env as Record<string, string>,
        ...config.env,
      },
    });
  }

  /**
   * Create SSE transport for Server-Sent Events MCP servers
   * @deprecated SSE is deprecated, prefer HTTP transport
   */
  private async createSSETransport(config: MCPServerConfig): Promise<SSEClientTransport> {
    if (!config.url) {
      throw new Error('sse MCP server requires "url" field');
    }

    const url = new URL(config.url);

    // Build request init with auth headers if provided
    const requestInit: RequestInit = {};

    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            'Authorization': `Bearer ${config.auth.token}`,
          };
          break;
        case 'api_key':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            [config.auth.header || 'X-API-Key']: config.auth.value || config.auth.token || '',
          };
          break;
        case 'basic':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            'Authorization': `Basic ${Buffer.from(config.auth.token || '').toString('base64')}`,
          };
          break;
      }
    }

    return new SSEClientTransport(url, { requestInit });
  }

  /**
   * Create HTTP transport for Streamable HTTP MCP servers
   */
  private async createHTTPTransport(config: MCPServerConfig): Promise<StreamableHTTPClientTransport> {
    if (!config.url) {
      throw new Error('http MCP server requires "url" field');
    }

    const url = new URL(config.url);

    // Build request init with auth headers if provided
    const requestInit: RequestInit = {};

    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            'Authorization': `Bearer ${config.auth.token}`,
          };
          break;
        case 'api_key':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            [config.auth.header || 'X-API-Key']: config.auth.value || config.auth.token || '',
          };
          break;
        case 'basic':
          requestInit.headers = {
            ...requestInit.headers as Record<string, string>,
            'Authorization': `Basic ${Buffer.from(config.auth.token || '').toString('base64')}`,
          };
          break;
      }
    }

    return new StreamableHTTPClientTransport(url, { requestInit });
  }

  /**
   * List available tools from a connected MCP server
   */
  async listTools(serverName: string): Promise<MCPTool[]> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    if (!connection.client) {
      return [];
    }

    try {
      const { tools } = await connection.client.listTools();
      return tools.map((tool: { name: string; description?: string; inputSchema: object }) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as object,
      }));
    } catch (error) {
      console.error(`[MCP] Failed to list tools from ${serverName}:`, error);
      return [];
    }
  }

  /**
   * Call an MCP tool
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    if (!connection.client) {
      throw new Error(`MCP server ${serverName} not initialized`);
    }

    try {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (error) {
      console.error(`[MCP] Failed to call tool ${toolName} on ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      if (connection.client) {
        try {
          await connection.client.close();
        } catch (error) {
          console.error(`[MCP] Error closing connection to ${serverName}:`, error);
        }
      }
      this.connections.delete(serverName);
      console.log(`[MCP] Disconnected from server: ${serverName}`);
    }
  }

  /**
   * Disconnect all servers for a plugin
   */
  async disconnectAll(pluginName: string): Promise<void> {
    for (const [serverName] of Array.from(this.connections.keys())) {
      if (serverName.startsWith(`${pluginName}_`)) {
        await this.disconnect(serverName);
      }
    }
  }

  /**
   * Disconnect all servers
   */
  async disconnectAllServers(): Promise<void> {
    for (const serverName of Array.from(this.connections.keys())) {
      await this.disconnect(serverName);
    }
  }

  /**
   * Check if a server is connected
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }

  /**
   * Get all connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get all tools from all connected servers
   */
  async getAllTools(): Promise<Map<string, MCPTool[]>> {
    const allTools = new Map<string, MCPTool[]>();

    for (const serverName of this.connections.keys()) {
      const tools = await this.listTools(serverName);
      allTools.set(serverName, tools);
    }

    return allTools;
  }

  /**
   * Get connection for a server
   */
  getConnection(serverName: string): MCPConnection | undefined {
    return this.connections.get(serverName);
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(serverName: string): any {
    const connection = this.connections.get(serverName);
    if (!connection?.client) {
      return undefined;
    }
    return connection.client.getServerCapabilities();
  }
}