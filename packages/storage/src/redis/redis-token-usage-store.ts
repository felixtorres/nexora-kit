import type { TokenUsageRecord } from '../token-usage-store.js';
import type { ITokenUsageStore } from '../interfaces.js';
import type { RedisClient } from './redis-client.js';

const PREFIX = 'nxk:token_usage:';

export class RedisTokenUsageStore implements ITokenUsageStore {
  constructor(private readonly redis: RedisClient) {}

  async save(record: TokenUsageRecord): Promise<void> {
    const key = `${PREFIX}${record.pluginNamespace}`;
    await this.redis.hset(key, 'used', String(record.used));
    await this.redis.hset(key, 'limit', String(record.limit));
    await this.redis.hset(key, 'periodStart', record.periodStart);
  }

  async get(pluginNamespace: string): Promise<TokenUsageRecord | undefined> {
    const data = await this.redis.hgetall(`${PREFIX}${pluginNamespace}`);
    if (!data || !data.used) return undefined;
    return {
      pluginNamespace,
      used: Number(data.used),
      limit: Number(data.limit),
      periodStart: data.periodStart,
    };
  }

  async getAll(): Promise<TokenUsageRecord[]> {
    // Redis doesn't have a built-in way to list all hash keys by prefix.
    // This is a known limitation — production use requires key tracking.
    // For now, this returns an empty array. Users should maintain a set of namespaces.
    return [];
  }

  async reset(pluginNamespace: string): Promise<boolean> {
    const count = await this.redis.del(`${PREFIX}${pluginNamespace}`);
    return count > 0;
  }
}
