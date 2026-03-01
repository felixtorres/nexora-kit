import { z } from 'zod';

// --- Server configuration ---

export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  name: string;
  transport: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

// --- Server status ---

export type McpServerStatus = 'starting' | 'healthy' | 'degraded' | 'unhealthy' | 'stopped';

// --- Tool definitions from MCP servers ---

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// --- Health reporting ---

export interface McpHealthReport {
  serverName: string;
  namespace: string;
  status: McpServerStatus;
  consecutiveFailures: number;
  lastCheckAt?: Date;
  error?: string;
}

// --- Lifecycle events ---

export type McpServerEventType =
  | 'server:starting'
  | 'server:healthy'
  | 'server:degraded'
  | 'server:unhealthy'
  | 'server:stopped'
  | 'server:restarting'
  | 'server:error';

export interface McpServerEvent {
  type: McpServerEventType;
  serverName: string;
  namespace: string;
  timestamp: Date;
  error?: string;
}

// --- JSON-RPC ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// --- Zod schemas for mcp.yaml ---

export const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
}).refine(
  (data) => {
    if (data.transport === 'stdio') return !!data.command;
    return true;
  },
  { message: 'stdio transport requires "command" field' },
).refine(
  (data) => {
    if (data.transport === 'sse') return !!data.url;
    return true;
  },
  { message: 'sse transport requires "url" field' },
).refine(
  (data) => {
    if (data.transport === 'http') return !!data.url;
    return true;
  },
  { message: 'http transport requires "url" field' },
);

export const mcpConfigSchema = z.object({
  servers: z.array(mcpServerConfigSchema).min(1),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;

// --- Circuit breaker config ---

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccesses: number;
}

// --- Manager config ---

export interface McpManagerConfig {
  healthCheckIntervalMs: number;
  maxRestartAttempts: number;
  requestTimeoutMs: number;
  circuitBreaker: CircuitBreakerConfig;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccesses: 2,
};

export const DEFAULT_MCP_MANAGER_CONFIG: McpManagerConfig = {
  healthCheckIntervalMs: 30_000,
  maxRestartAttempts: 3,
  requestTimeoutMs: 30_000,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
};
