/**
 * Core shared types for NexoraKit.
 * All packages import these types from @nexora-kit/core.
 */

// --- Messages ---

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  role: Role;
  content: string | MessageContent[];
}

// --- Tools ---

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// --- Sessions ---

export interface Session {
  id: string;
  teamId: string;
  userId: string;
  pluginNamespaces: string[];
  messages: Message[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// --- Context ---

export interface Context {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  metadata: Record<string, unknown>;
}

// --- Chat ---

export interface ChatRequest {
  sessionId: string;
  message: string;
  teamId: string;
  userId: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
}

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' };

// --- Permissions ---

export type Permission =
  | 'llm:invoke'
  | 'mcp:connect'
  | 'storage:read'
  | 'storage:write'
  | 'code:execute'
  | 'fs:read'
  | 'fs:write'
  | 'network:connect'
  | 'env:read'
  | 'secret:read';

// --- Model Info ---

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapability[];
}

export type ModelCapability = 'chat' | 'tools' | 'vision' | 'streaming';

// --- Plugins ---

export interface PluginDependency {
  namespace: string;
  version: string;
}

export interface PluginSandboxConfig {
  tier: 'none' | 'basic' | 'strict';
  limits?: { memoryMb?: number; timeoutMs?: number };
  allowedModules?: string[];
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  description: string;
  default?: unknown;
  required?: boolean;
}

export interface PluginConfigSchema {
  schema: Record<string, PluginConfigField>;
}

export interface PluginToolsConfig {
  pinned: string[];
}

export interface PluginManifest {
  name: string;
  version: string;
  namespace: string;
  description?: string;
  permissions: Permission[];
  dependencies: PluginDependency[];
  sandbox: PluginSandboxConfig;
  tools?: PluginToolsConfig;
  config?: PluginConfigSchema;
}

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'errored';

export interface PluginInstance {
  manifest: PluginManifest;
  state: PluginState;
  tools: ToolDefinition[];
  error?: string;
}

// --- Tool Registry ---

export interface ToolSearchQuery {
  text: string;
  namespaces?: string[];
  limit?: number;
}

export interface RankedTool {
  tool: ToolDefinition;
  score: number;
  namespace: string;
  source: string;
}

export interface ToolSelectionRequest {
  query: string;
  namespaces: string[];
  tokenBudget: number;
  recentToolNames?: string[];
}

export interface SelectedTools {
  tools: ToolDefinition[];
  totalTokens: number;
  droppedCount: number;
  selectionTimeMs: number;
}

export interface ToolSelectorInterface {
  select(request: ToolSelectionRequest): SelectedTools;
}

// --- Commands ---

export interface CommandDispatcherInterface {
  isCommand(input: string): boolean;
  dispatch(input: string, session?: { id: string; userId: string; teamId: string }): Promise<{ content: string; isError?: boolean }>;
}

// --- Observability ---

export interface ObservabilityHooks {
  onTraceStart(traceId: string, input: { sessionId: string; message: string }): void;
  onGeneration(data: {
    model: string;
    input: Message[];
    output?: string;
    usage?: { input: number; output: number };
    durationMs: number;
  }): void;
  onToolCall(data: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError: boolean;
    durationMs: number;
  }): void;
  onToolSelection(data: {
    query: string;
    selected: number;
    dropped: number;
    tokensUsed: number;
    timeMs: number;
  }): void;
  onTraceEnd(traceId: string, output: {
    totalTokens: number;
    turns: number;
    durationMs: number;
  }): void;
  flush(): Promise<void>;
}
