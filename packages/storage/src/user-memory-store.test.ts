import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteUserMemoryStore } from './user-memory-store.js';

describe('SqliteUserMemoryStore', () => {
  let db: Database.Database;
  let store: SqliteUserMemoryStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteUserMemoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('sets and gets a fact', () => {
    store.set('user-1', { key: 'name', value: 'Alice' });
    const fact = store.get('user-1', 'name');

    expect(fact).toBeDefined();
    expect(fact!.key).toBe('name');
    expect(fact!.value).toBe('Alice');
    expect(fact!.namespace).toBe('global');
    expect(fact!.source).toBe('plugin');
    expect(fact!.createdAt).toBeDefined();
    expect(fact!.updatedAt).toBeDefined();
  });

  it('returns undefined for nonexistent fact', () => {
    const fact = store.get('user-1', 'nonexistent');
    expect(fact).toBeUndefined();
  });

  it('upserts on duplicate key', () => {
    store.set('user-1', { key: 'name', value: 'Alice' });
    store.set('user-1', { key: 'name', value: 'Bob' });

    const fact = store.get('user-1', 'name');
    expect(fact!.value).toBe('Bob');

    const all = store.list('user-1');
    expect(all).toHaveLength(1);
  });

  it('stores optional metadata', () => {
    store.set('user-1', {
      key: 'pref',
      value: 'dark mode',
      namespace: '@support',
      source: 'user',
      pluginNamespace: 'support-bot',
      confidence: 0.95,
    });

    const fact = store.get('user-1', 'pref');
    expect(fact!.namespace).toBe('@support');
    expect(fact!.source).toBe('user');
    expect(fact!.pluginNamespace).toBe('support-bot');
    expect(fact!.confidence).toBe(0.95);
  });

  it('lists all facts for a user', () => {
    store.set('user-1', { key: 'name', value: 'Alice' });
    store.set('user-1', { key: 'role', value: 'engineer' });
    store.set('user-2', { key: 'name', value: 'Bob' });

    const facts = store.list('user-1');
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.key).sort()).toEqual(['name', 'role']);
  });

  it('lists facts filtered by namespace', () => {
    store.set('user-1', { key: 'global-pref', value: 'a', namespace: 'global' });
    store.set('user-1', { key: 'plugin-pref', value: 'b', namespace: '@faq' });

    const globalFacts = store.list('user-1', { namespace: 'global' });
    expect(globalFacts).toHaveLength(1);
    expect(globalFacts[0].key).toBe('global-pref');

    const pluginFacts = store.list('user-1', { namespace: '@faq' });
    expect(pluginFacts).toHaveLength(1);
    expect(pluginFacts[0].key).toBe('plugin-pref');
  });

  it('scopes facts by agentId', () => {
    store.set('user-1', { key: 'name', value: 'Alice' }); // no agent (operator)
    store.set('user-1', { key: 'name', value: 'Alice (support)' }, 'agent-1');

    const operatorFact = store.get('user-1', 'name');
    expect(operatorFact!.value).toBe('Alice');

    const agentFact = store.get('user-1', 'name', 'agent-1');
    expect(agentFact!.value).toBe('Alice (support)');
  });

  it('deletes a specific fact', () => {
    store.set('user-1', { key: 'name', value: 'Alice' });
    store.set('user-1', { key: 'role', value: 'engineer' });

    const deleted = store.delete('user-1', 'name');
    expect(deleted).toBe(true);

    expect(store.get('user-1', 'name')).toBeUndefined();
    expect(store.get('user-1', 'role')).toBeDefined();
  });

  it('returns false when deleting nonexistent fact', () => {
    const deleted = store.delete('user-1', 'nonexistent');
    expect(deleted).toBe(false);
  });

  it('deleteAll removes all facts for a user', () => {
    store.set('user-1', { key: 'a', value: '1' });
    store.set('user-1', { key: 'b', value: '2' });
    store.set('user-2', { key: 'c', value: '3' });

    store.deleteAll('user-1');

    expect(store.list('user-1')).toHaveLength(0);
    expect(store.list('user-2')).toHaveLength(1);
  });

  it('deleteAll respects agent scoping', () => {
    store.set('user-1', { key: 'a', value: '1' }); // operator scope
    store.set('user-1', { key: 'b', value: '2' }, 'agent-1');

    store.deleteAll('user-1', 'agent-1');

    expect(store.list('user-1')).toHaveLength(1); // operator fact remains
    expect(store.list('user-1', undefined, 'agent-1')).toHaveLength(0);
  });

  it('isolates facts between users', () => {
    store.set('user-1', { key: 'secret', value: 'mine' });
    store.set('user-2', { key: 'secret', value: 'yours' });

    expect(store.get('user-1', 'secret')!.value).toBe('mine');
    expect(store.get('user-2', 'secret')!.value).toBe('yours');
  });
});
