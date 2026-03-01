import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteTokenUsageStore } from './token-usage-store.js';

describe('SqliteTokenUsageStore', () => {
  let db: Database.Database;
  let store: SqliteTokenUsageStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteTokenUsageStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns undefined for unknown namespace', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('saves and retrieves plugin token usage', () => {
    store.save({
      pluginNamespace: 'my-plugin',
      used: 5000,
      limit: 100000,
      periodStart: '2026-03-01',
    });

    const record = store.get('my-plugin');
    expect(record).toBeDefined();
    expect(record!.used).toBe(5000);
    expect(record!.limit).toBe(100000);
    expect(record!.periodStart).toBe('2026-03-01');
  });

  it('upserts on conflict', () => {
    store.save({ pluginNamespace: 'my-plugin', used: 100, limit: 1000, periodStart: '2026-03-01' });
    store.save({ pluginNamespace: 'my-plugin', used: 500, limit: 1000, periodStart: '2026-03-01' });

    const record = store.get('my-plugin');
    expect(record!.used).toBe(500);
  });

  it('saves and retrieves instance-level usage', () => {
    store.saveInstanceUsage(10000, 1000000, '2026-03-01');

    const record = store.getInstanceUsage();
    expect(record).toBeDefined();
    expect(record!.pluginNamespace).toBe('__instance__');
    expect(record!.used).toBe(10000);
  });

  it('lists all token usage records', () => {
    store.save({ pluginNamespace: 'plugin-a', used: 100, limit: 1000, periodStart: '2026-03-01' });
    store.save({ pluginNamespace: 'plugin-b', used: 200, limit: 2000, periodStart: '2026-03-01' });
    store.saveInstanceUsage(300, 5000, '2026-03-01');

    const all = store.getAll();
    expect(all).toHaveLength(3);
  });

  it('resets a specific namespace', () => {
    store.save({ pluginNamespace: 'my-plugin', used: 100, limit: 1000, periodStart: '2026-03-01' });
    expect(store.reset('my-plugin')).toBe(true);
    expect(store.get('my-plugin')).toBeUndefined();
  });

  it('returns false when resetting non-existent namespace', () => {
    expect(store.reset('ghost')).toBe(false);
  });
});
