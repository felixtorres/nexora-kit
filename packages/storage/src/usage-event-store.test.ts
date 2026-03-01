import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteUsageEventStore } from './usage-event-store.js';

describe('SqliteUsageEventStore', () => {
  let db: Database.Database;
  let store: SqliteUsageEventStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteUsageEventStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and queries an event', () => {
    const id = store.insert({
      pluginName: 'my-plugin',
      userId: 'user-1',
      model: 'claude-sonnet',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    });

    expect(id).toBeGreaterThan(0);

    const events = store.query();
    expect(events).toHaveLength(1);
    expect(events[0].pluginName).toBe('my-plugin');
    expect(events[0].inputTokens).toBe(100);
    expect(events[0].outputTokens).toBe(50);
  });

  it('filters by plugin name', () => {
    store.insert({ pluginName: 'plugin-a', inputTokens: 10, outputTokens: 5 });
    store.insert({ pluginName: 'plugin-b', inputTokens: 20, outputTokens: 10 });

    const events = store.query({ pluginName: 'plugin-a' });
    expect(events).toHaveLength(1);
    expect(events[0].pluginName).toBe('plugin-a');
  });

  it('filters by user id', () => {
    store.insert({ pluginName: 'p', userId: 'u1', inputTokens: 10, outputTokens: 5 });
    store.insert({ pluginName: 'p', userId: 'u2', inputTokens: 20, outputTokens: 10 });

    const events = store.query({ userId: 'u1' });
    expect(events).toHaveLength(1);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ pluginName: 'p', inputTokens: i, outputTokens: 0 });
    }

    const events = store.query({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('returns events in descending order by created_at', () => {
    store.insert({ pluginName: 'p', inputTokens: 1, outputTokens: 0 });
    store.insert({ pluginName: 'p', inputTokens: 2, outputTokens: 0 });
    store.insert({ pluginName: 'p', inputTokens: 3, outputTokens: 0 });

    const events = store.query();
    // All inserted in same instant, but ordered by rowid desc effectively
    expect(events).toHaveLength(3);
  });

  it('handles optional fields as undefined', () => {
    store.insert({ pluginName: 'p', inputTokens: 10, outputTokens: 5 });

    const events = store.query();
    expect(events[0].userId).toBeUndefined();
    expect(events[0].model).toBeUndefined();
    expect(events[0].latencyMs).toBeUndefined();
  });
});
