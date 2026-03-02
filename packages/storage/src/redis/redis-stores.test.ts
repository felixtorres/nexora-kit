import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisMemoryStore } from './redis-memory-store.js';
import { RedisTokenUsageStore } from './redis-token-usage-store.js';
// RedisClient type not used directly — mock inferred via vi.fn()

function makeMockRedis() {
  return {
    rpush: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hgetall: vi.fn().mockResolvedValue({}),
    hdel: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  } as any;
}

describe('RedisMemoryStore', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let store: RedisMemoryStore;

  beforeEach(() => {
    redis = makeMockRedis();
    store = new RedisMemoryStore(redis);
  });

  it('gets messages for a session', async () => {
    redis.lrange.mockResolvedValueOnce([
      JSON.stringify({ role: 'user', content: 'Hello' }),
      JSON.stringify({ role: 'assistant', content: 'Hi' }),
    ]);

    const msgs = await store.get('sess-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(redis.lrange).toHaveBeenCalledWith('nxk:messages:sess-1', 0, -1);
  });

  it('appends messages', async () => {
    await store.append('sess-1', [
      { role: 'user', content: 'Hello' },
    ]);
    expect(redis.rpush).toHaveBeenCalledWith(
      'nxk:messages:sess-1',
      JSON.stringify({ role: 'user', content: 'Hello' }),
    );
  });

  it('skips append with empty messages', async () => {
    await store.append('sess-1', []);
    expect(redis.rpush).not.toHaveBeenCalled();
  });

  it('clears messages', async () => {
    await store.clear('sess-1');
    expect(redis.del).toHaveBeenCalledWith('nxk:messages:sess-1');
  });
});

describe('RedisTokenUsageStore', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let store: RedisTokenUsageStore;

  beforeEach(() => {
    redis = makeMockRedis();
    store = new RedisTokenUsageStore(redis);
  });

  it('saves token usage', async () => {
    await store.save({ pluginNamespace: 'p1', used: 100, limit: 1000, periodStart: '2026-01-01' });
    expect(redis.hset).toHaveBeenCalledWith('nxk:token_usage:p1', 'used', '100');
    expect(redis.hset).toHaveBeenCalledWith('nxk:token_usage:p1', 'limit', '1000');
    expect(redis.hset).toHaveBeenCalledWith('nxk:token_usage:p1', 'periodStart', '2026-01-01');
  });

  it('gets token usage', async () => {
    redis.hgetall.mockResolvedValueOnce({
      used: '50',
      limit: '500',
      periodStart: '2026-01-01',
    });
    const result = await store.get('p1');
    expect(result?.used).toBe(50);
    expect(result?.limit).toBe(500);
    expect(result?.periodStart).toBe('2026-01-01');
  });

  it('returns undefined for missing namespace', async () => {
    redis.hgetall.mockResolvedValueOnce({});
    const result = await store.get('missing');
    expect(result).toBeUndefined();
  });

  it('resets token usage', async () => {
    redis.del.mockResolvedValueOnce(1);
    const result = await store.reset('p1');
    expect(result).toBe(true);
    expect(redis.del).toHaveBeenCalledWith('nxk:token_usage:p1');
  });

  it('returns false when reset finds no key', async () => {
    redis.del.mockResolvedValueOnce(0);
    const result = await store.reset('missing');
    expect(result).toBe(false);
  });

  it('getAll returns empty (known limitation)', async () => {
    const all = await store.getAll();
    expect(all).toEqual([]);
  });
});
