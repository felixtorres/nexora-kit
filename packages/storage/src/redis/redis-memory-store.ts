import type { Message } from '@nexora-kit/core';
import type { IMessageStore } from '../interfaces.js';
import type { RedisClient } from './redis-client.js';

const PREFIX = 'nxk:messages:';

export class RedisMessageStore implements IMessageStore {
  constructor(private readonly redis: RedisClient) {}

  async get(conversationId: string): Promise<Message[]> {
    const raw = await this.redis.lrange(`${PREFIX}${conversationId}`, 0, -1);
    return raw.map((item) => JSON.parse(item) as Message);
  }

  async append(conversationId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    const values = messages.map((m) => JSON.stringify(m));
    await this.redis.rpush(`${PREFIX}${conversationId}`, ...values);
  }

  async clear(conversationId: string): Promise<void> {
    await this.redis.del(`${PREFIX}${conversationId}`);
  }

  async truncateFrom(conversationId: string, fromSeq: number): Promise<void> {
    // LTRIM keeps elements at indices 0..fromSeq-1
    await this.redis.lrange(`${PREFIX}${conversationId}`, 0, fromSeq - 1).then(async (kept) => {
      await this.redis.del(`${PREFIX}${conversationId}`);
      if (kept.length > 0) {
        await this.redis.rpush(`${PREFIX}${conversationId}`, ...kept);
      }
    });
  }
}
