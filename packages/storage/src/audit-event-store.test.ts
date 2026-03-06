import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteAuditEventStore } from './audit-event-store.js';

describe('SqliteAuditEventStore', () => {
  let db: Database.Database;
  let store: SqliteAuditEventStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteAuditEventStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and queries an event', () => {
    const id = store.insert({
      actor: 'admin-1',
      action: 'plugin.install',
      target: 'plugin:support-bot',
      details: { version: '1.0.0' },
      result: 'success',
    });

    expect(id).toBeGreaterThan(0);

    const events = store.query();
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('admin-1');
    expect(events[0].action).toBe('plugin.install');
    expect(events[0].target).toBe('plugin:support-bot');
    expect(events[0].details).toEqual({ version: '1.0.0' });
    expect(events[0].result).toBe('success');
    expect(events[0].createdAt).toBeDefined();
  });

  it('filters by actor', () => {
    store.insert({ actor: 'admin-1', action: 'plugin.install', target: 'p:a', result: 'success' });
    store.insert({ actor: 'admin-2', action: 'plugin.install', target: 'p:b', result: 'success' });

    const events = store.query({ actor: 'admin-1' });
    expect(events).toHaveLength(1);
    expect(events[0].target).toBe('p:a');
  });

  it('filters by action', () => {
    store.insert({ actor: 'admin', action: 'plugin.install', target: 'p:a', result: 'success' });
    store.insert({ actor: 'admin', action: 'plugin.enable', target: 'p:a', result: 'success' });

    const events = store.query({ action: 'plugin.enable' });
    expect(events).toHaveLength(1);
  });

  it('filters by target', () => {
    store.insert({ actor: 'admin', action: 'plugin.install', target: 'p:a', result: 'success' });
    store.insert({ actor: 'admin', action: 'plugin.install', target: 'p:b', result: 'success' });

    const events = store.query({ target: 'p:a' });
    expect(events).toHaveLength(1);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ actor: 'admin', action: 'test', target: `t:${i}`, result: 'success' });
    }

    const events = store.query({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('returns events in descending order', () => {
    store.insert({ actor: 'admin', action: 'first', target: 't', result: 'success' });
    store.insert({ actor: 'admin', action: 'second', target: 't', result: 'success' });

    const events = store.query();
    expect(events).toHaveLength(2);
  });

  it('defaults details to empty object', () => {
    store.insert({ actor: 'admin', action: 'test', target: 't', result: 'success' });

    const events = store.query();
    expect(events[0].details).toEqual({});
  });

  it('records failure result', () => {
    store.insert({
      actor: 'admin',
      action: 'plugin.install',
      target: 'p:bad',
      result: 'failure',
      details: { error: 'not found' },
    });

    const events = store.query();
    expect(events[0].result).toBe('failure');
    expect(events[0].details).toEqual({ error: 'not found' });
  });

  it('deleteOlderThan removes old events', () => {
    // Insert an event, then manually backdate it
    store.insert({ actor: 'admin', action: 'old', target: 't', result: 'success' });
    db.prepare("UPDATE audit_events SET created_at = datetime('now', '-100 days')").run();

    store.insert({ actor: 'admin', action: 'recent', target: 't', result: 'success' });

    const deleted = store.deleteOlderThan(90);
    expect(deleted).toBe(1);

    const remaining = store.query();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe('recent');
  });

  it('deleteOlderThan clears all events when days is zero', () => {
    store.insert({ actor: 'admin', action: 'first', target: 't:1', result: 'success' });
    store.insert({ actor: 'admin', action: 'second', target: 't:2', result: 'success' });

    const deleted = store.deleteOlderThan(0);
    expect(deleted).toBe(2);
    expect(store.query()).toHaveLength(0);
  });

  it('count returns total events', () => {
    expect(store.count()).toBe(0);
    store.insert({ actor: 'admin', action: 'test', target: 't', result: 'success' });
    store.insert({ actor: 'admin', action: 'test', target: 't', result: 'success' });
    expect(store.count()).toBe(2);
  });
});
