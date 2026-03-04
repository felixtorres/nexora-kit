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

export interface BlocksContent {
  type: 'blocks';
  blocks: ResponseBlock[];
}

export interface FileContent {
  type: 'file';
  fileId: string;
  mimeType: string;
  name: string;
}

export interface ArtifactContent {
  type: 'artifact';
  artifactId: string;
  operation: ArtifactOperation;
}

export type MessageContent =
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | BlocksContent
  | FileContent
  | ArtifactContent;

export interface Message {
  role: Role;
  content: string | MessageContent[];
}

// --- Response Blocks ---

export interface Action {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  payload?: Record<string, unknown>;
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
  required?: boolean;
  options?: string[];
  default?: unknown;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface CardBlock {
  type: 'card';
  title: string;
  body?: string;
  imageUrl?: string;
  actions?: Action[];
}

export interface ActionBlock {
  type: 'action';
  actions: Action[];
}

export interface SuggestedRepliesBlock {
  type: 'suggested_replies';
  replies: string[];
}

export interface TableBlock {
  type: 'table';
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
}

export interface CodeBlock {
  type: 'code';
  code: string;
  language?: string;
}

export interface FormBlock {
  type: 'form';
  id: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface ProgressBlock {
  type: 'progress';
  label: string;
  value?: number;
  max?: number;
}

export interface CustomBlock {
  type: `custom:${string}`;
  data: unknown;
}

export type ResponseBlock =
  | TextBlock
  | CardBlock
  | ActionBlock
  | SuggestedRepliesBlock
  | TableBlock
  | ImageBlock
  | CodeBlock
  | FormBlock
  | ProgressBlock
  | CustomBlock;

// --- Artifacts ---

export type ArtifactType = 'code' | 'document' | 'diagram' | 'data' | 'image';

export interface ArtifactOperation {
  type: 'create' | 'update';
  artifactId: string;
  title?: string;
  content?: string;
  artifactType?: ArtifactType;
  language?: string;
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
  blocks?: ResponseBlock[];
  artifacts?: ArtifactOperation[];
}

// --- Conversations (was Sessions) ---

export interface Conversation {
  id: string;
  teamId: string;
  userId: string;
  title: string | null;
  systemPrompt?: string;
  templateId?: string;
  workspaceId?: string;
  model?: string;
  agentId?: string;
  pluginNamespaces: string[];
  messages: Message[];
  messageCount: number;
  lastMessageAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

// --- Context ---

export interface Context {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  metadata: Record<string, unknown>;
}

// --- Chat ---

export interface ChatInputText {
  type: 'text';
  text: string;
}

export interface ChatInputAction {
  type: 'action';
  actionId: string;
  payload: Record<string, unknown>;
}

export interface ChatInputFile {
  type: 'file';
  fileId: string;
  text?: string;
}

export type ChatInput = ChatInputText | ChatInputAction | ChatInputFile;

export interface ChatRequest {
  conversationId: string;
  input: ChatInput;
  teamId: string;
  userId: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
  model?: string;
  workspaceId?: string;
}

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' }
  | { type: 'blocks'; blocks: ResponseBlock[] }
  | { type: 'artifact_create'; artifactId: string; title: string; content: string }
  | { type: 'artifact_stream'; artifactId: string; delta: string }
  | { type: 'artifact_update'; artifactId: string; title?: string; content?: string }
  | { type: 'artifact_done'; artifactId: string }
  | { type: 'cancelled' };

// --- Bots ---

export interface Bot {
  id: string;
  teamId: string;
  name: string;
  description: string;
  systemPrompt: string;
  pluginNamespaces: string[];
  model: string;
  temperature?: number;
  maxTurns?: number;
  workspaceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BotResponse {
  botId: string;
  botName: string;
  content: string;
  tokensUsed?: number;
  durationMs?: number;
}

// --- Agents ---

export type OrchestrationStrategy = 'single' | 'orchestrate' | 'route';

export interface AgentAppearance {
  displayName?: string;
  avatarUrl?: string;
  description?: string;
  welcomeMessage?: string;
  placeholder?: string;
}

export interface EndUserAuthConfig {
  mode?: 'anonymous' | 'token' | 'jwt';
  jwtSecret?: string;
  tokenPrefix?: string;
}

export interface AgentRateLimits {
  messagesPerMinute?: number;
  conversationsPerDay?: number;
}

export interface AgentFeatures {
  artifacts?: boolean;
  fileUpload?: boolean;
  feedback?: boolean;
  memory?: boolean;
}

export interface Agent {
  id: string;
  teamId: string;
  slug: string;
  name: string;
  description: string;
  orchestrationStrategy: OrchestrationStrategy;
  orchestratorModel?: string;
  orchestratorPrompt?: string;
  botId?: string;
  fallbackBotId?: string;
  appearance: AgentAppearance;
  endUserAuth: EndUserAuthConfig;
  rateLimits: AgentRateLimits;
  features: AgentFeatures;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentBotBinding {
  agentId: string;
  botId: string;
  priority: number;
  description: string;
  keywords: string[];
}

// --- End Users ---

export interface EndUser {
  id: string;
  agentId: string;
  externalId: string | null;
  displayName: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string | null;
}

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
  dispatch(input: string, session?: { id: string; userId: string; teamId: string }): Promise<{ content: string; isError?: boolean; isPrompt?: boolean }>;
}

// --- Observability ---

export interface ObservabilityHooks {
  onTraceStart(traceId: string, input: { conversationId: string; message: string }): void;
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
