import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgMessageStore } from './pg-memory-store.js';
import { PgConfigStore } from './pg-config-store.js';
import { PgPluginStateStore } from './pg-plugin-state-store.js';
import { PgTokenUsageStore } from './pg-token-usage-store.js';
import { PgUsageEventStore } from './pg-usage-event-store.js';
import { PgAuditEventStore } from './pg-audit-event-store.js';
import type { PgPool } from './pg-pool.js';

function makeMockPool(): PgPool & { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PgMessageStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgMessageStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgMessageStore(pool);
  });

  it('gets messages for a conversation', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { role: 'user', content: '"Hello"' },
        { role: 'assistant', content: '"Hi"' },
      ],
      rowCount: 2,
    });

    const msgs = await store.get('conv-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT role, content'),
      ['conv-1'],
    );
  });

  it('appends messages', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ max_seq: 0 }], rowCount: 1 });
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await store.append('conv-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);

    // 1 for max_seq + 2 for inserts
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('skips append with empty messages', async () => {
    await store.append('conv-1', []);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('clears messages', async () => {
    await store.clear('conv-1');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['conv-1'],
    );
  });
});

describe('PgConfigStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgConfigStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgConfigStore(pool);
  });

  it('persists a config entry', async () => {
    await store.persist({ key: 'theme', value: 'dark', layer: 1 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO config_entries'),
      ['theme', '"dark"', 1, '', ''],
    );
  });

  it('gets all config entries', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ key: 'theme', value: '"dark"', layer: 1, plugin_namespace: '', user_id: '' }],
      rowCount: 1,
    });
    const entries = await store.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('theme');
  });

  it('loads into resolver', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ key: 'k', value: '"v"', layer: 1, plugin_namespace: '', user_id: '' }],
      rowCount: 1,
    });
    const resolver = { set: vi.fn() } as any;
    await store.loadInto(resolver);
    expect(resolver.set).toHaveBeenCalledWith('k', 'v', 1, {
      pluginNamespace: undefined,
      userId: undefined,
    });
  });
});

describe('PgPluginStateStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgPluginStateStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgPluginStateStore(pool);
  });

  it('saves plugin state', async () => {
    await store.save({ namespace: 'my-plugin', state: 'enabled', version: '1.0.0' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO plugin_states'),
      ['my-plugin', 'enabled', '1.0.0', null],
    );
  });

  it('gets plugin state', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ namespace: 'p1', state: 'enabled', version: '1.0', error: null, installed_at: '2026-01-01' }],
      rowCount: 1,
    });
    const result = await store.get('p1');
    expect(result?.namespace).toBe('p1');
    expect(result?.state).toBe('enabled');
  });

  it('returns undefined for missing plugin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await store.get('missing');
    expect(result).toBeUndefined();
  });

  it('removes plugin state', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const removed = await store.remove('p1');
    expect(removed).toBe(true);
  });

  it('returns false when removing non-existent plugin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const removed = await store.remove('missing');
    expect(removed).toBe(false);
  });

  it('gets all plugin states', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { namespace: 'p1', state: 'enabled', version: '1.0', error: null, installed_at: '2026-01-01' },
        { namespace: 'p2', state: 'disabled', version: '2.0', error: 'err', installed_at: '2026-01-02' },
      ],
      rowCount: 2,
    });
    const all = await store.getAll();
    expect(all).toHaveLength(2);
  });
});

describe('PgTokenUsageStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgTokenUsageStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgTokenUsageStore(pool);
  });

  it('saves token usage', async () => {
    await store.save({ pluginNamespace: 'p1', used: 100, limit: 1000, periodStart: '2026-01-01' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO token_usage'),
      ['p1', 100, 1000, '2026-01-01'],
    );
  });

  it('gets token usage', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ plugin_namespace: 'p1', used: 50, limit_val: 500, period_start: '2026-01-01' }],
      rowCount: 1,
    });
    const result = await store.get('p1');
    expect(result?.used).toBe(50);
    expect(result?.limit).toBe(500);
  });

  it('returns undefined for missing namespace', async () => {
    const result = await store.get('missing');
    expect(result).toBeUndefined();
  });

  it('resets token usage', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const reset = await store.reset('p1');
    expect(reset).toBe(true);
  });
});

describe('PgUsageEventStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgUsageEventStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgUsageEventStore(pool);
  });

  it('inserts usage event', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
    const id = await store.insert({
      pluginName: 'test-plugin',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(id).toBe(42);
  });

  it('queries with filters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await store.query({ pluginName: 'test', limit: 10 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('plugin_name = $1');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual(['test', 10]);
  });

  it('queries without filters', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        plugin_name: 'p1',
        user_id: null,
        model: 'gpt-4',
        input_tokens: 10,
        output_tokens: 5,
        latency_ms: null,
        created_at: '2026-01-01',
      }],
      rowCount: 1,
    });
    const events = await store.query();
    expect(events).toHaveLength(1);
    expect(events[0].pluginName).toBe('p1');
    expect(events[0].model).toBe('gpt-4');
  });
});

describe('PgAuditEventStore', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let store: PgAuditEventStore;

  beforeEach(() => {
    pool = makeMockPool();
    store = new PgAuditEventStore(pool);
  });

  it('inserts audit event', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });
    const id = await store.insert({
      actor: 'admin',
      action: 'enable',
      target: 'plugin-x',
      result: 'success',
    });
    expect(id).toBe(7);
  });

  it('queries with filters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await store.query({ actor: 'admin', action: 'enable' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('actor = $1');
    expect(sql).toContain('action = $2');
    expect(params).toEqual(['admin', 'enable']);
  });

  it('deletes older than N days', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 5 });
    const count = await store.deleteOlderThan(30);
    expect(count).toBe(5);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INTERVAL'),
      [30],
    );
  });

  it('counts events', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ cnt: 42 }], rowCount: 1 });
    const count = await store.count();
    expect(count).toBe(42);
  });
});
