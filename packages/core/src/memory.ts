import type { Message } from './types.js';

export interface MemoryStore {
  get(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

/**
 * In-memory store for development and testing.
 * Production would use PostgreSQL.
 */
export class InMemoryStore implements MemoryStore {
  private store = new Map<string, Message[]>();

  async get(sessionId: string): Promise<Message[]> {
    return [...(this.store.get(sessionId) ?? [])];
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const existing = this.store.get(sessionId) ?? [];
    existing.push(...messages);
    this.store.set(sessionId, existing);
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}
