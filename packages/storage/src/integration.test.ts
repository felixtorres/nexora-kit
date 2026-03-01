import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteMemoryStore } from './memory-store.js';
import { SqlitePluginStateStore } from './plugin-state-store.js';
import { SqliteTokenUsageStore } from './token-usage-store.js';
import { SqliteUsageEventStore } from './usage-event-store.js';
import { SqliteConfigStore } from './config-store.js';
import { ConfigResolver, ConfigLayer } from '@nexora-kit/config';

describe('Storage integration', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-storage-'));
    dbPath = path.join(tmpDir, 'nexora.db');
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function openDb(): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    return db;
  }

  it('persists messages across DB close and reopen', async () => {
    // Write
    const db1 = openDb();
    initSchema(db1);
    const store1 = new SqliteMemoryStore(db1);
    await store1.append('session-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
    db1.close();

    // Reopen and verify
    const db2 = new Database(dbPath);
    const store2 = new SqliteMemoryStore(db2);
    const messages = await store2.get('session-1');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    db2.close();
  });

  it('persists plugin state across DB close and reopen', () => {
    const db1 = openDb();
    initSchema(db1);
    const stateStore1 = new SqlitePluginStateStore(db1);
    stateStore1.save({ namespace: 'analytics', state: 'enabled', version: '2.1.0' });
    db1.close();

    const db2 = new Database(dbPath);
    const stateStore2 = new SqlitePluginStateStore(db2);
    const record = stateStore2.get('analytics');
    expect(record!.state).toBe('enabled');
    expect(record!.version).toBe('2.1.0');
    db2.close();
  });

  it('persists config entries across DB close and reopen', () => {
    const db1 = openDb();
    initSchema(db1);
    const configStore1 = new SqliteConfigStore(db1);
    configStore1.persist({ key: 'theme', value: 'dark', layer: ConfigLayer.InstanceDefaults });
    configStore1.persist({ key: 'lang', value: 'en', layer: ConfigLayer.UserPreferences, userId: 'u1' });
    db1.close();

    const db2 = new Database(dbPath);
    const configStore2 = new SqliteConfigStore(db2);
    const resolver = new ConfigResolver();
    configStore2.loadInto(resolver);
    expect(resolver.get('theme', {})).toBe('dark');
    expect(resolver.get('lang', { userId: 'u1' })).toBe('en');
    db2.close();
  });

  it('persists token usage across DB close and reopen', () => {
    const db1 = openDb();
    initSchema(db1);
    const tokenStore1 = new SqliteTokenUsageStore(db1);
    tokenStore1.saveInstanceUsage(5000, 100000, '2026-03-01');
    tokenStore1.save({ pluginNamespace: 'chat', used: 1200, limit: 50000, periodStart: '2026-03-01' });
    db1.close();

    const db2 = new Database(dbPath);
    const tokenStore2 = new SqliteTokenUsageStore(db2);
    const instance = tokenStore2.getInstanceUsage();
    expect(instance!.used).toBe(5000);
    const plugin = tokenStore2.get('chat');
    expect(plugin!.used).toBe(1200);
    db2.close();
  });

  it('persists usage events across DB close and reopen', () => {
    const db1 = openDb();
    initSchema(db1);
    const eventStore1 = new SqliteUsageEventStore(db1);
    eventStore1.insert({ pluginName: 'summarizer', inputTokens: 500, outputTokens: 200, model: 'claude-haiku' });
    db1.close();

    const db2 = new Database(dbPath);
    const eventStore2 = new SqliteUsageEventStore(db2);
    const events = eventStore2.query({ pluginName: 'summarizer' });
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe('claude-haiku');
    db2.close();
  });

  it('all stores coexist in single DB file', async () => {
    const db = openDb();
    initSchema(db);

    const memoryStore = new SqliteMemoryStore(db);
    const configStore = new SqliteConfigStore(db);
    const pluginStore = new SqlitePluginStateStore(db);
    const tokenStore = new SqliteTokenUsageStore(db);
    const eventStore = new SqliteUsageEventStore(db);

    await memoryStore.append('s1', [{ role: 'user', content: 'test' }]);
    configStore.persist({ key: 'k', value: 'v', layer: ConfigLayer.InstanceDefaults });
    pluginStore.save({ namespace: 'p', state: 'enabled', version: '1.0.0' });
    tokenStore.save({ pluginNamespace: 'p', used: 10, limit: 100, periodStart: '2026-03-01' });
    eventStore.insert({ pluginName: 'p', inputTokens: 5, outputTokens: 3 });

    expect(await memoryStore.get('s1')).toHaveLength(1);
    expect(configStore.getAll()).toHaveLength(1);
    expect(pluginStore.getAll()).toHaveLength(1);
    expect(tokenStore.getAll()).toHaveLength(1);
    expect(eventStore.query()).toHaveLength(1);

    db.close();
  });
});
