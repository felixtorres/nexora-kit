export { StorageDatabase, type StorageDatabaseOptions } from './database.js';
export { initSchema } from './schema.js';
export { SqliteMessageStore } from './memory-store.js';
export { SqliteConversationStore } from './conversation-store.js';
export { SqliteConfigStore } from './config-store.js';
export { SqlitePluginStateStore, type PluginStateRecord } from './plugin-state-store.js';
export { SqliteTokenUsageStore, type TokenUsageRecord } from './token-usage-store.js';
export { SqliteUsageEventStore, type UsageEvent, type UsageEventFilter } from './usage-event-store.js';
export { SqliteAuditEventStore, type AuditEvent, type AuditEventFilter } from './audit-event-store.js';
export { SqliteBotStore } from './bot-store.js';
export { SqliteAgentStore } from './agent-store.js';
export { SqliteAgentBotBindingStore } from './agent-bot-binding-store.js';
export { SqliteEndUserStore } from './end-user-store.js';
export { SqliteFeedbackStore } from './feedback-store.js';
export { SqliteUserMemoryStore } from './user-memory-store.js';
export { SqliteConversationTemplateStore } from './conversation-template-store.js';
export { SqliteFileStore } from './file-store.js';
export { SqliteWorkspaceStore } from './workspace-store.js';
export { SqliteContextDocumentStore } from './context-document-store.js';
export { SqliteArtifactStore } from './artifact-store.js';

// Interfaces
export type {
  IMessageStore,
  IConversationStore,
  ConversationRecord,
  CreateConversationInput,
  ConversationPatch,
  ListConversationsOptions,
  PaginatedResult,
  IConfigStore,
  IPluginStateStore,
  ITokenUsageStore,
  IUsageEventStore,
  IAuditEventStore,
  IBotStore,
  BotRecord,
  CreateBotInput,
  BotPatch,
  IAgentStore,
  AgentRecord,
  CreateAgentInput,
  AgentPatch,
  IAgentBotBindingStore,
  BindingRecord,
  BindingInput,
  IEndUserStore,
  EndUserRecord,
  CreateEndUserInput,
  IFeedbackStore,
  FeedbackRecord,
  SubmitFeedbackInput,
  FeedbackQueryOptions,
  FeedbackSummaryOptions,
  FeedbackSummary,
  IUserMemoryStore,
  UserFact,
  SetFactInput,
  ListFactsOptions,
  IConversationTemplateStore,
  ConversationTemplateRecord,
  CreateConversationTemplateInput,
  ConversationTemplatePatch,
  IFileStore,
  FileRecord,
  CreateFileInput,
  IWorkspaceStore,
  WorkspaceRecord,
  CreateWorkspaceInput,
  WorkspacePatch,
  IContextDocumentStore,
  ContextDocumentRecord,
  CreateContextDocumentInput,
  ContextDocumentPatch,
  IArtifactStore,
  ArtifactRecord,
  ArtifactVersionRecord,
  CreateArtifactInput,
  ArtifactType,
} from './interfaces.js';

// Backend factory
export { createStorageBackend, type StorageBackendConfig, type StorageBackend } from './backend.js';

// PostgreSQL stores
export { PgMessageStore } from './postgres/pg-memory-store.js';
export { PgConversationStore } from './postgres/pg-conversation-store.js';
export { PgConfigStore } from './postgres/pg-config-store.js';
export { PgPluginStateStore } from './postgres/pg-plugin-state-store.js';
export { PgTokenUsageStore } from './postgres/pg-token-usage-store.js';
export { PgUsageEventStore } from './postgres/pg-usage-event-store.js';
export { PgAuditEventStore } from './postgres/pg-audit-event-store.js';
export { PgBotStore } from './postgres/pg-bot-store.js';
export { PgAgentStore } from './postgres/pg-agent-store.js';
export { PgAgentBotBindingStore } from './postgres/pg-agent-bot-binding-store.js';
export { PgEndUserStore } from './postgres/pg-end-user-store.js';
export { PgFeedbackStore } from './postgres/pg-feedback-store.js';
export { PgUserMemoryStore } from './postgres/pg-user-memory-store.js';
export { PgConversationTemplateStore } from './postgres/pg-conversation-template-store.js';
export { PgFileStore } from './postgres/pg-file-store.js';
export { PgWorkspaceStore } from './postgres/pg-workspace-store.js';
export { PgContextDocumentStore } from './postgres/pg-context-document-store.js';
export { PgArtifactStore } from './postgres/pg-artifact-store.js';
export { initPgSchema } from './postgres/schema.js';
export type { PgPool } from './postgres/pg-pool.js';

// Redis stores
export { RedisMessageStore } from './redis/redis-memory-store.js';
export { RedisTokenUsageStore } from './redis/redis-token-usage-store.js';
export type { RedisClient } from './redis/redis-client.js';
