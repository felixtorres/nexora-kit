import type { Message } from '@nexora-kit/core';
import type { IMemoryStore } from '../interfaces.js';
import type { RedisClient } from './redis-client.js';

const PREFIX = 'nxk:messages:';

export class RedisMemoryStore implements IMemoryStore {
  constructor(private readonly redis: RedisClient) {}

  async get(sessionId: string): Promise<Message[]> {
    const raw = await this.redis.lrange(`${PREFIX}${sessionId}`, 0, -1);
    return raw.map((item) => JSON.parse(item) as Message);
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    const values = messages.map((m) => JSON.stringify(m));
    await this.redis.rpush(`${PREFIX}${sessionId}`, ...values);
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(`${PREFIX}${sessionId}`);
  }
}
