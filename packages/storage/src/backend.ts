import type { MemoryStore } from '@nexora-kit/core';
import type { IConfigStore, IPluginStateStore, ITokenUsageStore, IUsageEventStore, IAuditEventStore } from './interfaces.js';

export type StorageBackendConfig =
  | { type: 'sqlite'; path: string; walMode?: boolean }
  | { type: 'postgres'; connectionString: string; poolSize?: number };

export interface StorageBackend {
  memoryStore: MemoryStore;
  configStore: IConfigStore;
  pluginStateStore: IPluginStateStore;
  tokenUsageStore: ITokenUsageStore;
  usageEventStore: IUsageEventStore;
  auditEventStore: IAuditEventStore;
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
  const { SqliteMemoryStore } = await import('./memory-store.js');
  const { SqliteConfigStore } = await import('./config-store.js');
  const { SqlitePluginStateStore } = await import('./plugin-state-store.js');
  const { SqliteTokenUsageStore } = await import('./token-usage-store.js');
  const { SqliteUsageEventStore } = await import('./usage-event-store.js');
  const { SqliteAuditEventStore } = await import('./audit-event-store.js');

  const storage = new StorageDatabase({ path: config.path, walMode: config.walMode });
  initSchema(storage.db);

  return {
    memoryStore: new SqliteMemoryStore(storage.db),
    configStore: new SqliteConfigStore(storage.db),
    pluginStateStore: new SqlitePluginStateStore(storage.db),
    tokenUsageStore: new SqliteTokenUsageStore(storage.db),
    usageEventStore: new SqliteUsageEventStore(storage.db),
    auditEventStore: new SqliteAuditEventStore(storage.db),
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

  const { PgMemoryStore } = await import('./postgres/pg-memory-store.js');
  const { PgConfigStore } = await import('./postgres/pg-config-store.js');
  const { PgPluginStateStore } = await import('./postgres/pg-plugin-state-store.js');
  const { PgTokenUsageStore } = await import('./postgres/pg-token-usage-store.js');
  const { PgUsageEventStore } = await import('./postgres/pg-usage-event-store.js');
  const { PgAuditEventStore } = await import('./postgres/pg-audit-event-store.js');

  return {
    memoryStore: new PgMemoryStore(pool),
    configStore: new PgConfigStore(pool),
    pluginStateStore: new PgPluginStateStore(pool),
    tokenUsageStore: new PgTokenUsageStore(pool),
    usageEventStore: new PgUsageEventStore(pool),
    auditEventStore: new PgAuditEventStore(pool),
    async close() {
      await pool.end();
    },
  };
}
