/**
 * Minimal Redis client interface for compile-time safety without requiring ioredis.
 * At runtime, the actual Redis instance from 'ioredis' is used.
 */
export interface RedisClient {
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string | string[]): Promise<number>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  quit(): Promise<string>;
}
