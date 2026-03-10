import type {
  Message,
  AgentAppearance,
  EndUserAuthConfig,
  AgentRateLimits,
  AgentFeatures,
  OrchestrationStrategy,
} from '@nexora-kit/core';
import type { ConfigResolver, ConfigEntry } from '@nexora-kit/config';
import type { PluginStateRecord } from './plugin-state-store.js';
import type { TokenUsageRecord } from './token-usage-store.js';
import type { UsageEvent, UsageEventFilter } from './usage-event-store.js';
import type { AuditEvent, AuditEventFilter } from './audit-event-store.js';

export interface IMessageStore {
  get(conversationId: string): Promise<Message[]>;
  append(conversationId: string, messages: Message[]): Promise<void>;
  clear(conversationId: string): Promise<void>;
  truncateFrom(conversationId: string, fromSeq: number): Promise<void>;
}

// --- Conversation Store ---

export interface ConversationRecord {
  id: string;
  teamId: string;
  userId: string;
  title: string | null;
  systemPrompt?: string | null;
  templateId?: string | null;
  workspaceId?: string | null;
  model?: string | null;
  agentId?: string | null;
  pluginNamespaces: string[];
  messageCount: number;
  lastMessageAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateConversationInput {
  teamId: string;
  userId: string;
  title?: string;
  systemPrompt?: string;
  templateId?: string;
  workspaceId?: string;
  model?: string;
  agentId?: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConversationPatch {
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ListConversationsOptions {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface IConversationStore {
  create(input: CreateConversationInput): ConversationRecord | Promise<ConversationRecord>;
  get(
    id: string,
    userId: string,
  ): ConversationRecord | undefined | Promise<ConversationRecord | undefined>;
  list(
    userId: string,
    opts?: ListConversationsOptions,
  ): PaginatedResult<ConversationRecord> | Promise<PaginatedResult<ConversationRecord>>;
  update(
    id: string,
    userId: string,
    patch: ConversationPatch,
  ): ConversationRecord | undefined | Promise<ConversationRecord | undefined>;
  softDelete(id: string, userId: string): boolean | Promise<boolean>;
  updateMessageStats(id: string, count: number, lastMessageAt: string): void | Promise<void>;
}

// --- Conversation Template Store ---

export interface ConversationTemplateRecord {
  id: string;
  teamId: string;
  name: string;
  description: string;
  systemPrompt: string | null;
  pluginNamespaces: string[];
  model: string | null;
  temperature: number | null;
  maxTurns: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationTemplateInput {
  teamId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  pluginNamespaces?: string[];
  model?: string;
  temperature?: number;
  maxTurns?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationTemplatePatch {
  name?: string;
  description?: string;
  systemPrompt?: string | null;
  pluginNamespaces?: string[];
  model?: string | null;
  temperature?: number | null;
  maxTurns?: number | null;
  metadata?: Record<string, unknown>;
}

export interface IConversationTemplateStore {
  create(
    input: CreateConversationTemplateInput,
  ): ConversationTemplateRecord | Promise<ConversationTemplateRecord>;
  get(
    id: string,
    teamId: string,
  ): ConversationTemplateRecord | undefined | Promise<ConversationTemplateRecord | undefined>;
  list(teamId: string): ConversationTemplateRecord[] | Promise<ConversationTemplateRecord[]>;
  update(
    id: string,
    teamId: string,
    patch: ConversationTemplatePatch,
  ): ConversationTemplateRecord | undefined | Promise<ConversationTemplateRecord | undefined>;
  delete(id: string, teamId: string): boolean | Promise<boolean>;
}

// --- Other Stores ---

export interface IConfigStore {
  loadInto(resolver: ConfigResolver): void | Promise<void>;
  persist(entry: ConfigEntry): void | Promise<void>;
  persistAll(entries: ConfigEntry[]): void | Promise<void>;
  getAll(): ConfigEntry[] | Promise<ConfigEntry[]>;
}

export interface IPluginStateStore {
  save(record: PluginStateRecord): void | Promise<void>;
  get(namespace: string): PluginStateRecord | undefined | Promise<PluginStateRecord | undefined>;
  getAll(): PluginStateRecord[] | Promise<PluginStateRecord[]>;
  remove(namespace: string): boolean | Promise<boolean>;
}

export interface ITokenUsageStore {
  save(record: TokenUsageRecord): void | Promise<void>;
  get(
    pluginNamespace: string,
  ): TokenUsageRecord | undefined | Promise<TokenUsageRecord | undefined>;
  getAll(): TokenUsageRecord[] | Promise<TokenUsageRecord[]>;
  reset(pluginNamespace: string): boolean | Promise<boolean>;
}

export interface IUsageEventStore {
  insert(event: UsageEvent): number | Promise<number>;
  query(filter?: UsageEventFilter): UsageEvent[] | Promise<UsageEvent[]>;
}

export interface IAuditEventStore {
  insert(event: AuditEvent): number | Promise<number>;
  query(filter?: AuditEventFilter): AuditEvent[] | Promise<AuditEvent[]>;
  deleteOlderThan(days: number): number | Promise<number>;
  count(): number | Promise<number>;
}

// --- User Memory Store ---

export interface UserFact {
  key: string;
  value: string;
  namespace: string;
  source: 'user' | 'plugin' | 'llm';
  pluginNamespace: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetFactInput {
  key: string;
  value: string;
  namespace?: string;
  source?: 'user' | 'plugin' | 'llm';
  pluginNamespace?: string;
  confidence?: number;
}

export interface ListFactsOptions {
  namespace?: string;
}

export interface IUserMemoryStore {
  get(
    userId: string,
    key: string,
    agentId?: string,
  ): UserFact | undefined | Promise<UserFact | undefined>;
  list(userId: string, opts?: ListFactsOptions, agentId?: string): UserFact[] | Promise<UserFact[]>;
  set(userId: string, fact: SetFactInput, agentId?: string): void | Promise<void>;
  delete(userId: string, key: string, agentId?: string): boolean | Promise<boolean>;
  deleteAll(userId: string, agentId?: string): void | Promise<void>;
}

// --- Feedback Store ---

export interface FeedbackRecord {
  id: string;
  conversationId: string;
  messageSeq: number;
  userId: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  tags: string[];
  pluginNamespace: string | null;
  model: string | null;
  createdAt: string;
}

export interface SubmitFeedbackInput {
  conversationId: string;
  messageSeq: number;
  userId: string;
  rating: 'positive' | 'negative';
  comment?: string;
  tags?: string[];
  pluginNamespace?: string;
  model?: string;
}

export interface FeedbackQueryOptions {
  conversationId?: string;
  userId?: string;
  pluginNamespace?: string;
  rating?: 'positive' | 'negative';
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface FeedbackSummaryOptions {
  pluginNamespace?: string;
  model?: string;
  from?: string;
  to?: string;
}

export interface FeedbackSummary {
  totalCount: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
  byPlugin: { pluginNamespace: string; positive: number; negative: number }[];
  byModel: { model: string; positive: number; negative: number }[];
  topTags: { tag: string; count: number }[];
}

// --- Workspace Store ---

export interface WorkspaceRecord {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  teamId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspacePatch {
  name?: string;
  description?: string | null;
  systemPrompt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IWorkspaceStore {
  create(input: CreateWorkspaceInput): WorkspaceRecord | Promise<WorkspaceRecord>;
  get(
    id: string,
    teamId: string,
  ): WorkspaceRecord | undefined | Promise<WorkspaceRecord | undefined>;
  list(teamId: string): WorkspaceRecord[] | Promise<WorkspaceRecord[]>;
  update(
    id: string,
    teamId: string,
    patch: WorkspacePatch,
  ): WorkspaceRecord | undefined | Promise<WorkspaceRecord | undefined>;
  delete(id: string, teamId: string): boolean | Promise<boolean>;
}

// --- Context Document Store ---

export interface ContextDocumentRecord {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  priority: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContextDocumentInput {
  workspaceId: string;
  title: string;
  content: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextDocumentPatch {
  title?: string;
  content?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface IContextDocumentStore {
  create(input: CreateContextDocumentInput): ContextDocumentRecord | Promise<ContextDocumentRecord>;
  get(id: string): ContextDocumentRecord | undefined | Promise<ContextDocumentRecord | undefined>;
  listByWorkspace(workspaceId: string): ContextDocumentRecord[] | Promise<ContextDocumentRecord[]>;
  update(
    id: string,
    patch: ContextDocumentPatch,
  ): ContextDocumentRecord | undefined | Promise<ContextDocumentRecord | undefined>;
  delete(id: string): boolean | Promise<boolean>;
  deleteByWorkspace(workspaceId: string): void | Promise<void>;
}

// --- Artifact Store ---

export type ArtifactType = 'code' | 'document' | 'diagram' | 'data' | 'image';

export interface ArtifactRecord {
  id: string;
  conversationId: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  currentVersion: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersionRecord {
  artifactId: string;
  version: number;
  content: string;
  createdAt: string;
}

export interface CreateArtifactInput {
  conversationId: string;
  title: string;
  type?: ArtifactType;
  language?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface IArtifactStore {
  create(input: CreateArtifactInput): ArtifactRecord | Promise<ArtifactRecord>;
  update(
    id: string,
    content: string,
  ): ArtifactRecord | undefined | Promise<ArtifactRecord | undefined>;
  get(id: string): ArtifactRecord | undefined | Promise<ArtifactRecord | undefined>;
  listByConversation(conversationId: string): ArtifactRecord[] | Promise<ArtifactRecord[]>;
  getVersion(
    id: string,
    version: number,
  ): ArtifactVersionRecord | undefined | Promise<ArtifactVersionRecord | undefined>;
  listVersions(id: string): ArtifactVersionRecord[] | Promise<ArtifactVersionRecord[]>;
  delete(id: string): boolean | Promise<boolean>;
  deleteByConversation(conversationId: string): void | Promise<void>;
}

// --- File Store ---

export interface FileRecord {
  id: string;
  conversationId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateFileInput {
  conversationId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  metadata?: Record<string, unknown>;
}

export interface IFileStore {
  create(input: CreateFileInput): FileRecord | Promise<FileRecord>;
  get(id: string): FileRecord | undefined | Promise<FileRecord | undefined>;
  listByConversation(conversationId: string): FileRecord[] | Promise<FileRecord[]>;
  delete(id: string): boolean | Promise<boolean>;
  deleteByConversation(conversationId: string): void | Promise<void>;
}

// --- Feedback Store ---

export interface IFeedbackStore {
  submit(input: SubmitFeedbackInput): FeedbackRecord | Promise<FeedbackRecord>;
  get(
    conversationId: string,
    messageSeq: number,
    userId: string,
  ): FeedbackRecord | undefined | Promise<FeedbackRecord | undefined>;
  query(
    opts?: FeedbackQueryOptions,
  ): PaginatedResult<FeedbackRecord> | Promise<PaginatedResult<FeedbackRecord>>;
  summary(opts?: FeedbackSummaryOptions): FeedbackSummary | Promise<FeedbackSummary>;
  deleteByConversation(conversationId: string): void | Promise<void>;
  deleteFromSeq(conversationId: string, fromSeq: number): void | Promise<void>;
}

// --- Bot Store ---

export interface CreateBotInput {
  teamId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  pluginNamespaces?: string[];
  model: string;
  temperature?: number;
  maxTurns?: number;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface BotPatch {
  name?: string;
  description?: string;
  systemPrompt?: string;
  pluginNamespaces?: string[];
  model?: string;
  temperature?: number | null;
  maxTurns?: number | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BotRecord {
  id: string;
  teamId: string;
  name: string;
  description: string;
  systemPrompt: string;
  pluginNamespaces: string[];
  model: string;
  temperature: number | null;
  maxTurns: number | null;
  workspaceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IBotStore {
  create(input: CreateBotInput): BotRecord | Promise<BotRecord>;
  get(id: string, teamId: string): BotRecord | undefined | Promise<BotRecord | undefined>;
  list(teamId: string): BotRecord[] | Promise<BotRecord[]>;
  update(
    id: string,
    teamId: string,
    patch: BotPatch,
  ): BotRecord | undefined | Promise<BotRecord | undefined>;
  delete(id: string, teamId: string): boolean | Promise<boolean>;
}

// --- Agent Store ---

export interface CreateAgentInput {
  teamId: string;
  slug: string;
  name: string;
  description?: string;
  orchestrationStrategy?: OrchestrationStrategy;
  orchestratorModel?: string;
  orchestratorPrompt?: string;
  botId?: string;
  fallbackBotId?: string;
  appearance?: AgentAppearance;
  endUserAuth?: EndUserAuthConfig;
  rateLimits?: AgentRateLimits;
  features?: AgentFeatures;
  enabled?: boolean;
}

export interface AgentPatch {
  slug?: string;
  name?: string;
  description?: string;
  orchestrationStrategy?: OrchestrationStrategy;
  orchestratorModel?: string | null;
  orchestratorPrompt?: string | null;
  botId?: string | null;
  fallbackBotId?: string | null;
  appearance?: AgentAppearance;
  endUserAuth?: EndUserAuthConfig;
  rateLimits?: AgentRateLimits;
  features?: AgentFeatures;
  enabled?: boolean;
}

export interface AgentRecord {
  id: string;
  teamId: string;
  slug: string;
  name: string;
  description: string;
  orchestrationStrategy: OrchestrationStrategy;
  orchestratorModel: string | null;
  orchestratorPrompt: string | null;
  botId: string | null;
  fallbackBotId: string | null;
  appearance: AgentAppearance;
  endUserAuth: EndUserAuthConfig;
  rateLimits: AgentRateLimits;
  features: AgentFeatures;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IAgentStore {
  create(input: CreateAgentInput): AgentRecord | Promise<AgentRecord>;
  get(id: string, teamId: string): AgentRecord | undefined | Promise<AgentRecord | undefined>;
  getBySlug(
    slug: string,
    teamId: string,
  ): AgentRecord | undefined | Promise<AgentRecord | undefined>;
  getBySlugGlobal?(slug: string): AgentRecord | undefined | Promise<AgentRecord | undefined>;
  list(teamId: string): AgentRecord[] | Promise<AgentRecord[]>;
  update(
    id: string,
    teamId: string,
    patch: AgentPatch,
  ): AgentRecord | undefined | Promise<AgentRecord | undefined>;
  delete(id: string, teamId: string): boolean | Promise<boolean>;
}

// --- Agent Bot Binding Store ---

export interface BindingInput {
  agentId: string;
  botId: string;
  priority?: number;
  description?: string;
  keywords?: string[];
}

export interface BindingRecord {
  agentId: string;
  botId: string;
  priority: number;
  description: string;
  keywords: string[];
}

export interface IAgentBotBindingStore {
  set(input: BindingInput): BindingRecord | Promise<BindingRecord>;
  list(agentId: string): BindingRecord[] | Promise<BindingRecord[]>;
  remove(agentId: string, botId: string): boolean | Promise<boolean>;
  removeAll(agentId: string): number | Promise<number>;
}

// --- End User Store ---

export interface CreateEndUserInput {
  agentId: string;
  externalId?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface EndUserRecord {
  id: string;
  agentId: string;
  externalId: string | null;
  displayName: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string | null;
}

export interface IEndUserStore {
  create(input: CreateEndUserInput): EndUserRecord | Promise<EndUserRecord>;
  get(id: string): EndUserRecord | undefined | Promise<EndUserRecord | undefined>;
  getByExternalId(
    agentId: string,
    externalId: string,
  ): EndUserRecord | undefined | Promise<EndUserRecord | undefined>;
  getOrCreate(
    agentId: string,
    externalId: string,
    displayName?: string,
  ): EndUserRecord | Promise<EndUserRecord>;
  list(agentId: string): EndUserRecord[] | Promise<EndUserRecord[]>;
  updateLastSeen(id: string): void | Promise<void>;
}

// --- Execution Trace Store ---

export interface ExecutionTraceRecord {
  id: string;
  conversationId: string;
  traceId: string;
  skillName: string | null;
  botId: string | null;
  model: string | null;
  prompt: string;
  toolCalls: { name: string; input: Record<string, unknown>; output?: string; isError: boolean }[];
  retrievedDocs: string[];
  agentReasoning: string | null;
  finalAnswer: string;
  score: number | null;
  scoreFeedback: string | null;
  userFeedback: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: string;
}

export interface CreateExecutionTraceInput {
  conversationId: string;
  traceId: string;
  skillName?: string;
  botId?: string;
  model?: string;
  prompt: string;
  toolCalls?: ExecutionTraceRecord['toolCalls'];
  retrievedDocs?: string[];
  agentReasoning?: string;
  finalAnswer: string;
  score?: number;
  scoreFeedback?: string;
  userFeedback?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface ExecutionTraceFilter {
  conversationId?: string;
  skillName?: string;
  botId?: string;
  model?: string;
  hasScore?: boolean;
  hasNegativeScore?: boolean;
  since?: string;
  limit?: number;
}

export interface IExecutionTraceStore {
  insert(trace: CreateExecutionTraceInput): string | Promise<string>;
  get(id: string): ExecutionTraceRecord | undefined | Promise<ExecutionTraceRecord | undefined>;
  query(filter?: ExecutionTraceFilter): ExecutionTraceRecord[] | Promise<ExecutionTraceRecord[]>;
  count(filter?: ExecutionTraceFilter): number | Promise<number>;
  updateScore(id: string, score: number, feedback?: string): void | Promise<void>;
  averageScore(
    componentName: string,
    botId: string | null,
    days: number,
  ): number | null | Promise<number | null>;
  deleteOlderThan(days: number): number | Promise<number>;
}

// --- Optimized Prompt Store ---

export type OptimizedPromptComponentType =
  | 'skill'
  | 'tool_description'
  | 'system_prompt'
  | 'compaction';
export type OptimizedPromptStatus =
  | 'candidate'
  | 'approved'
  | 'active'
  | 'unvalidated'
  | 'rolled_back';

export interface OptimizedPromptRecord {
  id: string;
  componentType: OptimizedPromptComponentType;
  componentName: string;
  botId: string | null;
  originalPrompt: string;
  optimizedPrompt: string;
  score: number;
  scoreImprovement: number;
  paretoRank: number;
  evolutionDepth: number;
  parentId: string | null;
  reflectionLog: string;
  optimizedForModel: string;
  status: OptimizedPromptStatus;
  rollingScore: number | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface CreateOptimizedPromptInput {
  componentType: OptimizedPromptComponentType;
  componentName: string;
  botId?: string;
  originalPrompt: string;
  optimizedPrompt: string;
  score: number;
  scoreImprovement: number;
  paretoRank?: number;
  evolutionDepth?: number;
  parentId?: string;
  reflectionLog: string;
  optimizedForModel: string;
}

export interface OptimizedPromptFilter {
  componentType?: OptimizedPromptComponentType;
  componentName?: string;
  botId?: string;
  status?: OptimizedPromptStatus;
  optimizedForModel?: string;
  limit?: number;
}

export interface IOptimizedPromptStore {
  insert(prompt: CreateOptimizedPromptInput): string | Promise<string>;
  get(id: string): OptimizedPromptRecord | undefined | Promise<OptimizedPromptRecord | undefined>;
  query(filter?: OptimizedPromptFilter): OptimizedPromptRecord[] | Promise<OptimizedPromptRecord[]>;
  updateStatus(
    id: string,
    status: OptimizedPromptStatus,
    approvedBy?: string,
  ): void | Promise<void>;
  updateRollingScore(id: string, score: number): void | Promise<void>;
  getActive(
    componentType: OptimizedPromptComponentType,
    componentName: string,
    botId?: string,
  ): OptimizedPromptRecord | undefined | Promise<OptimizedPromptRecord | undefined>;
  deleteOlderThan(days: number): number | Promise<number>;
}
