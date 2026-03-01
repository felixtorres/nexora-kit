import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteMemoryStore } from './memory-store.js';

describe('SqliteMemoryStore', () => {
  let db: Database.Database;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteMemoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array for unknown session', async () => {
    expect(await store.get('unknown')).toEqual([]);
  });

  it('appends and retrieves messages', async () => {
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);
    await store.append('s1', [{ role: 'assistant', content: 'Hi!' }]);

    const messages = await store.get('s1');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi!' });
  });

  it('preserves message order across appends', async () => {
    await store.append('s1', [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
    ]);
    await store.append('s1', [{ role: 'user', content: 'Third' }]);

    const messages = await store.get('s1');
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.content)).toEqual(['First', 'Second', 'Third']);
  });

  it('isolates sessions', async () => {
    await store.append('s1', [{ role: 'user', content: 'Session 1' }]);
    await store.append('s2', [{ role: 'user', content: 'Session 2' }]);

    expect(await store.get('s1')).toHaveLength(1);
    expect(await store.get('s2')).toHaveLength(1);
    expect((await store.get('s1'))[0].content).toBe('Session 1');
  });

  it('clears messages for a session', async () => {
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);
    await store.append('s2', [{ role: 'user', content: 'Other' }]);

    await store.clear('s1');

    expect(await store.get('s1')).toEqual([]);
    expect(await store.get('s2')).toHaveLength(1);
  });

  it('handles structured content (MessageContent[])', async () => {
    const structured = [
      { type: 'text' as const, text: 'Hello world' },
    ];
    await store.append('s1', [{ role: 'assistant', content: structured as any }]);

    const messages = await store.get('s1');
    expect(messages[0].content).toEqual(structured);
  });

  it('handles empty append gracefully', async () => {
    await store.append('s1', []);
    expect(await store.get('s1')).toEqual([]);
  });

  it('returns copies, not references', async () => {
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);

    const first = await store.get('s1');
    const second = await store.get('s1');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
