export { StorageDatabase, type StorageDatabaseOptions } from './database.js';
export { initSchema } from './schema.js';
export { SqliteMessageStore } from './memory-store.js';
export { SqliteConversationStore } from './conversation-store.js';
export { SqliteConfigStore } from './config-store.js';
export { SqlitePluginStateStore, type PluginStateRecord } from './plugin-state-store.js';
export { SqliteTokenUsageStore, type TokenUsageRecord } from './token-usage-store.js';
export { SqliteUsageEventStore, type UsageEvent, type UsageEventFilter } from './usage-event-store.js';
export { SqliteAuditEventStore, type AuditEvent, type AuditEventFilter } from './audit-event-store.js';

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
export { initPgSchema } from './postgres/schema.js';
export type { PgPool } from './postgres/pg-pool.js';

// Redis stores
export { RedisMessageStore } from './redis/redis-memory-store.js';
export { RedisTokenUsageStore } from './redis/redis-token-usage-store.js';
export type { RedisClient } from './redis/redis-client.js';
