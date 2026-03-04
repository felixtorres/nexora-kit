import type { ToolDefinition, ToolParameterProperty, Logger } from '@nexora-kit/core';
import type { McpTransport } from './transports.js';
import { StdioTransport, SseTransport, HttpTransport } from './transports.js';
import { McpServerHandle } from './server-handle.js';
import { HealthMonitor, type HealthEventListener } from './health-monitor.js';
import type {
  McpServerConfig,
  McpToolDefinition,
  McpHealthReport,
  McpManagerConfig,
} from './types.js';
import { DEFAULT_MCP_MANAGER_CONFIG } from './types.js';

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export interface McpToolAdapter {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export interface TransportFactory {
  create(config: McpServerConfig, timeoutMs: number): McpTransport;
}

const defaultTransportFactory: TransportFactory = {
  create(config: McpServerConfig, timeoutMs: number): McpTransport {
    if (config.transport === 'stdio') {
      return new StdioTransport({
        command: config.command!,
        args: config.args,
        env: config.env,
        timeoutMs,
      });
    }
    if (config.transport === 'http') {
      return new HttpTransport({
        url: config.url!,
        headers: config.headers,
        timeoutMs,
      });
    }
    return new SseTransport({
      url: config.url!,
      headers: config.headers,
      timeoutMs,
    });
  },
};

export class McpManager {
  private handles = new Map<string, McpServerHandle[]>();
  private toolMap = new Map<string, { handle: McpServerHandle; mcpToolName: string }>();
  private healthMonitor: HealthMonitor;
  private readonly config: McpManagerConfig;
  private readonly transportFactory: TransportFactory;
  private readonly logger?: Logger;

  constructor(config?: Partial<McpManagerConfig>, transportFactory?: TransportFactory) {
    this.config = { ...DEFAULT_MCP_MANAGER_CONFIG, ...config };
    this.logger = config?.logger;
    this.transportFactory = transportFactory ?? defaultTransportFactory;
    this.healthMonitor = new HealthMonitor({
      intervalMs: this.config.healthCheckIntervalMs,
      maxRestartAttempts: this.config.maxRestartAttempts,
    });
  }

  async startServers(namespace: string, configs: McpServerConfig[]): Promise<void> {
    const handles: McpServerHandle[] = [];

    for (const config of configs) {
      this.logger?.info('mcp.server.starting', {
        namespace,
        server: config.name,
        transport: config.transport,
      });

      const transport = this.transportFactory.create(config, this.config.requestTimeoutMs);
      const handle = new McpServerHandle({
        config,
        transport,
        namespace,
        circuitBreakerConfig: this.config.circuitBreaker,
      });

      try {
        await handle.start();
        const tools = handle.listTools().map((t) => t.name);
        this.logger?.info('mcp.server.started', {
          namespace,
          server: config.name,
          transport: config.transport,
          toolCount: tools.length,
          tools,
        });
      } catch (err) {
        this.logger?.error('mcp.server.start_failed', {
          namespace,
          server: config.name,
          transport: config.transport,
          err: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      handles.push(handle);
      this.healthMonitor.addHandle(handle);

      // Index tools with qualified names
      for (const tool of handle.listTools()) {
        const qualifiedName = `@${namespace}/${config.name}.${tool.name}`;
        this.toolMap.set(qualifiedName, { handle, mcpToolName: tool.name });
      }
    }

    this.handles.set(namespace, handles);
  }

  async stopServers(namespace: string): Promise<void> {
    const handles = this.handles.get(namespace);
    if (!handles) return;

    this.logger?.info('mcp.servers.stopping', { namespace, count: handles.length });

    for (const handle of handles) {
      // Remove indexed tools
      for (const tool of handle.listTools()) {
        const qualifiedName = `@${namespace}/${handle.config.name}.${tool.name}`;
        this.toolMap.delete(qualifiedName);
      }

      this.healthMonitor.removeHandle(handle.config.name);
      await handle.stop();
      this.logger?.info('mcp.server.stopped', { namespace, server: handle.config.name });
    }

    this.handles.delete(namespace);
  }

  getTools(namespace: string): McpToolAdapter[] {
    const handles = this.handles.get(namespace);
    if (!handles) return [];

    const adapters: McpToolAdapter[] = [];

    for (const handle of handles) {
      for (const mcpTool of handle.listTools()) {
        const qualifiedName = `@${namespace}/${handle.config.name}.${mcpTool.name}`;
        adapters.push({
          definition: mcpToolToDefinition(qualifiedName, mcpTool),
          handler: this.createHandler(qualifiedName),
        });
      }
    }

    return adapters;
  }

  async callTool(qualifiedName: string, input: Record<string, unknown>): Promise<unknown> {
    const entry = this.toolMap.get(qualifiedName);
    if (!entry) {
      this.logger?.error('mcp.tool.not_found', { tool: qualifiedName });
      throw new Error(`MCP tool not found: ${qualifiedName}`);
    }

    const start = Date.now();
    try {
      const result = await entry.handle.callTool(entry.mcpToolName, input);
      this.logger?.debug('mcp.tool.called', {
        tool: qualifiedName,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      this.logger?.error('mcp.tool.call_failed', {
        tool: qualifiedName,
        durationMs: Date.now() - start,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  health(namespace: string): McpHealthReport[] {
    const handles = this.handles.get(namespace);
    if (!handles) return [];
    return handles.map((h) => h.getHealth());
  }

  listAll(): Array<{ namespace: string; serverName: string; status: string; toolCount: number }> {
    const result: Array<{
      namespace: string;
      serverName: string;
      status: string;
      toolCount: number;
    }> = [];

    for (const [namespace, handles] of this.handles) {
      for (const handle of handles) {
        result.push({
          namespace,
          serverName: handle.config.name,
          status: handle.getStatus(),
          toolCount: handle.listTools().length,
        });
      }
    }

    return result;
  }

  onHealthEvent(listener: HealthEventListener): void {
    this.healthMonitor.onEvent(listener);
  }

  startHealthChecks(): void {
    this.healthMonitor.start();
  }

  stopHealthChecks(): void {
    this.healthMonitor.stop();
  }

  async shutdown(): Promise<void> {
    this.logger?.info('mcp.manager.shutdown', {});
    this.healthMonitor.stop();
    for (const namespace of [...this.handles.keys()]) {
      await this.stopServers(namespace);
    }
  }

  private createHandler(qualifiedName: string): ToolHandler {
    return async (input: Record<string, unknown>): Promise<string> => {
      const result = await this.callTool(qualifiedName, input);
      if (typeof result === 'string') return result;

      // MCP tools return { content: [{ type, text }] } — extract text
      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as any).content;
        if (Array.isArray(content)) {
          return content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        }
      }

      return JSON.stringify(result);
    };
  }
}

function mcpToolToDefinition(qualifiedName: string, mcpTool: McpToolDefinition): ToolDefinition {
  const properties: Record<string, ToolParameterProperty> = {};

  if (mcpTool.inputSchema?.properties) {
    for (const [key, value] of Object.entries(mcpTool.inputSchema.properties)) {
      const prop = value as Record<string, unknown>;
      properties[key] = {
        type: (prop.type as string) ?? 'string',
        description: prop.description as string | undefined,
      };
    }
  }

  return {
    name: qualifiedName,
    description: mcpTool.description,
    parameters: {
      type: 'object',
      properties,
      required: mcpTool.inputSchema?.required,
    },
  };
}
