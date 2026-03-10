import type { MessageStore } from '@nexora-kit/core';
import type { IConversationStore, IConfigStore, IPluginStateStore, ITokenUsageStore, IUsageEventStore, IAuditEventStore, IBotStore, IAgentStore, IAgentBotBindingStore, IEndUserStore, IExecutionTraceStore, IOptimizedPromptStore } from './interfaces.js';

export type StorageBackendConfig =
  | { type: 'sqlite'; path: string; walMode?: boolean }
  | { type: 'postgres'; connectionString: string; poolSize?: number };

export interface StorageBackend {
  messageStore: MessageStore;
  conversationStore: IConversationStore;
  configStore: IConfigStore;
  pluginStateStore: IPluginStateStore;
  tokenUsageStore: ITokenUsageStore;
  usageEventStore: IUsageEventStore;
  auditEventStore: IAuditEventStore;
  botStore: IBotStore;
  agentStore: IAgentStore;
  agentBotBindingStore: IAgentBotBindingStore;
  endUserStore: IEndUserStore;
  executionTraceStore: IExecutionTraceStore;
  optimizedPromptStore: IOptimizedPromptStore;
  close(): Promise<void>;
}

export async function createStorageBackend(config: StorageBackendConfig): Promise<StorageBackend> {
  if (config.type === 'sqlite') {
    return createSqliteBackend(config);
  }
  if (config.type === 'postgres') {
    return createPostgresBackend(config);
  }
  throw new Error(`Unknown storage backend type: ${(config as any).type}`);
}

async function createSqliteBackend(config: { path: string; walMode?: boolean }): Promise<StorageBackend> {
  const { StorageDatabase } = await import('./database.js');
  const { initSchema } = await import('./schema.js');
  const { SqliteMessageStore } = await import('./memory-store.js');
  const { SqliteConversationStore } = await import('./conversation-store.js');
  const { SqliteConfigStore } = await import('./config-store.js');
  const { SqlitePluginStateStore } = await import('./plugin-state-store.js');
  const { SqliteTokenUsageStore } = await import('./token-usage-store.js');
  const { SqliteUsageEventStore } = await import('./usage-event-store.js');
  const { SqliteAuditEventStore } = await import('./audit-event-store.js');
  const { SqliteBotStore } = await import('./bot-store.js');
  const { SqliteAgentStore } = await import('./agent-store.js');
  const { SqliteAgentBotBindingStore } = await import('./agent-bot-binding-store.js');
  const { SqliteEndUserStore } = await import('./end-user-store.js');
  const { SqliteExecutionTraceStore } = await import('./execution-trace-store.js');
  const { SqliteOptimizedPromptStore } = await import('./optimized-prompt-store.js');

  const storage = new StorageDatabase({ path: config.path, walMode: config.walMode });
  initSchema(storage.db);

  return {
    messageStore: new SqliteMessageStore(storage.db),
    conversationStore: new SqliteConversationStore(storage.db),
    configStore: new SqliteConfigStore(storage.db),
    pluginStateStore: new SqlitePluginStateStore(storage.db),
    tokenUsageStore: new SqliteTokenUsageStore(storage.db),
    usageEventStore: new SqliteUsageEventStore(storage.db),
    auditEventStore: new SqliteAuditEventStore(storage.db),
    botStore: new SqliteBotStore(storage.db),
    agentStore: new SqliteAgentStore(storage.db),
    agentBotBindingStore: new SqliteAgentBotBindingStore(storage.db),
    endUserStore: new SqliteEndUserStore(storage.db),
    executionTraceStore: new SqliteExecutionTraceStore(storage.db),
    optimizedPromptStore: new SqliteOptimizedPromptStore(storage.db),
    async close() {
      storage.close();
    },
  };
}

async function createPostgresBackend(config: { connectionString: string; poolSize?: number }): Promise<StorageBackend> {
  let pg: any;
  try {
    // Dynamic import — pg is an optional peer dependency
    pg = await (Function('return import("pg")')() as Promise<any>);
  } catch {
    throw new Error(
      'PostgreSQL backend requires the "pg" package. Install it with: npm install pg',
    );
  }

  const Pool = pg.default?.Pool ?? pg.Pool;
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolSize ?? 10,
  });

  const { initPgSchema } = await import('./postgres/schema.js');
  await initPgSchema(pool);

  const { PgMessageStore } = await import('./postgres/pg-memory-store.js');
  const { PgConversationStore } = await import('./postgres/pg-conversation-store.js');
  const { PgConfigStore } = await import('./postgres/pg-config-store.js');
  const { PgPluginStateStore } = await import('./postgres/pg-plugin-state-store.js');
  const { PgTokenUsageStore } = await import('./postgres/pg-token-usage-store.js');
  const { PgUsageEventStore } = await import('./postgres/pg-usage-event-store.js');
  const { PgAuditEventStore } = await import('./postgres/pg-audit-event-store.js');
  const { PgBotStore } = await import('./postgres/pg-bot-store.js');
  const { PgAgentStore } = await import('./postgres/pg-agent-store.js');
  const { PgAgentBotBindingStore } = await import('./postgres/pg-agent-bot-binding-store.js');
  const { PgEndUserStore } = await import('./postgres/pg-end-user-store.js');
  const { PgExecutionTraceStore } = await import('./postgres/pg-execution-trace-store.js');
  const { PgOptimizedPromptStore } = await import('./postgres/pg-optimized-prompt-store.js');

  return {
    messageStore: new PgMessageStore(pool),
    conversationStore: new PgConversationStore(pool),
    configStore: new PgConfigStore(pool),
    pluginStateStore: new PgPluginStateStore(pool),
    tokenUsageStore: new PgTokenUsageStore(pool),
    usageEventStore: new PgUsageEventStore(pool),
    auditEventStore: new PgAuditEventStore(pool),
    botStore: new PgBotStore(pool),
    agentStore: new PgAgentStore(pool),
    agentBotBindingStore: new PgAgentBotBindingStore(pool),
    endUserStore: new PgEndUserStore(pool),
    executionTraceStore: new PgExecutionTraceStore(pool),
    optimizedPromptStore: new PgOptimizedPromptStore(pool),
    async close() {
      await pool.end();
    },
  };
}
