import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqlitePluginStateStore } from './plugin-state-store.js';

describe('SqlitePluginStateStore', () => {
  let db: Database.Database;
  let store: SqlitePluginStateStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqlitePluginStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns undefined for unknown namespace', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('saves and retrieves a plugin state', () => {
    store.save({ namespace: 'my-plugin', state: 'installed', version: '1.0.0' });

    const record = store.get('my-plugin');
    expect(record).toBeDefined();
    expect(record!.state).toBe('installed');
    expect(record!.version).toBe('1.0.0');
    expect(record!.error).toBeUndefined();
    expect(record!.installedAt).toBeDefined();
  });

  it('upserts on conflict', () => {
    store.save({ namespace: 'my-plugin', state: 'installed', version: '1.0.0' });
    store.save({ namespace: 'my-plugin', state: 'enabled', version: '1.1.0' });

    const record = store.get('my-plugin');
    expect(record!.state).toBe('enabled');
    expect(record!.version).toBe('1.1.0');
  });

  it('stores error information', () => {
    store.save({ namespace: 'bad-plugin', state: 'errored', version: '0.1.0', error: 'Missing dependency' });

    const record = store.get('bad-plugin');
    expect(record!.error).toBe('Missing dependency');
  });

  it('lists all plugin states', () => {
    store.save({ namespace: 'plugin-a', state: 'enabled', version: '1.0.0' });
    store.save({ namespace: 'plugin-b', state: 'disabled', version: '2.0.0' });

    const all = store.getAll();
    expect(all).toHaveLength(2);
  });

  it('removes a plugin state', () => {
    store.save({ namespace: 'my-plugin', state: 'installed', version: '1.0.0' });
    expect(store.remove('my-plugin')).toBe(true);
    expect(store.get('my-plugin')).toBeUndefined();
  });

  it('returns false when removing non-existent namespace', () => {
    expect(store.remove('ghost')).toBe(false);
  });
});
