import type { Message } from './types.js';

export interface MessageStore {
  get(conversationId: string): Promise<Message[]>;
  append(conversationId: string, messages: Message[]): Promise<void>;
  clear(conversationId: string): Promise<void>;
  truncateFrom(conversationId: string, fromSeq: number): Promise<void>;
}

/**
 * In-memory store for development and testing.
 * Production would use PostgreSQL or SQLite.
 */
export class InMemoryMessageStore implements MessageStore {
  private store = new Map<string, Message[]>();

  async get(conversationId: string): Promise<Message[]> {
    return [...(this.store.get(conversationId) ?? [])];
  }

  async append(conversationId: string, messages: Message[]): Promise<void> {
    const existing = this.store.get(conversationId) ?? [];
    existing.push(...messages);
    this.store.set(conversationId, existing);
  }

  async clear(conversationId: string): Promise<void> {
    this.store.delete(conversationId);
  }

  async truncateFrom(conversationId: string, fromSeq: number): Promise<void> {
    const existing = this.store.get(conversationId);
    if (existing && fromSeq < existing.length) {
      existing.length = fromSeq;
    }
  }
}
