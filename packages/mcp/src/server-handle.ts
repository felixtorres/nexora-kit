import type { McpTransport } from './transports.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolDefinition,
  McpHealthReport,
  CircuitBreakerConfig,
} from './types.js';
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from './types.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

export interface ServerHandleOptions {
  config: McpServerConfig;
  transport: McpTransport;
  namespace: string;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
}

export class McpServerHandle {
  readonly config: McpServerConfig;
  readonly namespace: string;
  private readonly transport: McpTransport;
  private readonly circuitBreaker: CircuitBreaker;
  private tools: McpToolDefinition[] = [];
  private serverCapabilities: Record<string, unknown> = {};
  private status: McpServerStatus = 'stopped';

  constructor(options: ServerHandleOptions) {
    this.config = options.config;
    this.namespace = options.namespace;
    this.transport = options.transport;
    this.circuitBreaker = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...options.circuitBreakerConfig,
    });
  }

  async start(): Promise<void> {
    this.status = 'starting';

    try {
      await this.transport.connect();

      // Initialize handshake
      const initResult = await this.transport.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'nexora-kit', version: '0.1.0' },
      }) as { capabilities?: Record<string, unknown> };

      this.serverCapabilities = initResult?.capabilities ?? {};

      // Notify that we're initialized
      this.transport.notify('notifications/initialized');

      // Fetch tool list
      await this.refreshTools();

      this.status = 'healthy';
      this.circuitBreaker.reset();
    } catch (error) {
      this.status = 'unhealthy';
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.transport.isConnected()) {
        this.transport.notify('notifications/cancelled');
      }
    } finally {
      await this.transport.close();
      this.status = 'stopped';
      this.tools = [];
    }
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error(`Circuit breaker open for server '${this.config.name}'`);
    }

    try {
      const result = await this.transport.request('tools/call', { name, arguments: input });
      this.circuitBreaker.recordSuccess();
      this.updateStatus();
      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.updateStatus();
      throw error;
    }
  }

  async refreshTools(): Promise<McpToolDefinition[]> {
    const result = await this.transport.request('tools/list') as { tools?: McpToolDefinition[] };
    this.tools = result?.tools ?? [];
    return this.tools;
  }

  async ping(): Promise<boolean> {
    try {
      await this.transport.request('ping');
      this.circuitBreaker.recordSuccess();
      this.updateStatus();
      return true;
    } catch {
      this.circuitBreaker.recordFailure();
      this.updateStatus();
      return false;
    }
  }

  listTools(): McpToolDefinition[] {
    return [...this.tools];
  }

  getStatus(): McpServerStatus {
    return this.status;
  }

  getHealth(): McpHealthReport {
    return {
      serverName: this.config.name,
      namespace: this.namespace,
      status: this.status,
      consecutiveFailures: this.circuitBreaker.getConsecutiveFailures(),
      lastCheckAt: new Date(),
    };
  }

  getCapabilities(): Record<string, unknown> {
    return { ...this.serverCapabilities };
  }

  isRunning(): boolean {
    return this.transport.isConnected() && this.status !== 'stopped';
  }

  private updateStatus(): void {
    const state = this.circuitBreaker.getState();
    if (state === 'closed') {
      this.status = 'healthy';
    } else if (state === 'half-open') {
      this.status = 'degraded';
    } else {
      this.status = 'unhealthy';
    }
  }
}
