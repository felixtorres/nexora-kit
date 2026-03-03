import type { Message } from '@nexora-kit/core';
import type { IMessageStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgMessageStore implements IMessageStore {
  constructor(private readonly pool: PgPool) {}

  async get(conversationId: string): Promise<Message[]> {
    const { rows } = await this.pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY seq ASC',
      [conversationId],
    );
    return rows.map((row) => ({
      role: row.role as Message['role'],
      content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    }));
  }

  async append(conversationId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    const { rows } = await this.pool.query(
      'SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE conversation_id = $1',
      [conversationId],
    );
    let seq = Number(rows[0].max_seq);

    for (const msg of messages) {
      seq++;
      await this.pool.query(
        'INSERT INTO messages (conversation_id, role, content, seq) VALUES ($1, $2, $3, $4)',
        [conversationId, msg.role, JSON.stringify(msg.content), seq],
      );
    }
  }

  async clear(conversationId: string): Promise<void> {
    await this.pool.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
  }

  async truncateFrom(conversationId: string, fromSeq: number): Promise<void> {
    await this.pool.query('DELETE FROM messages WHERE conversation_id = $1 AND seq > $2', [conversationId, fromSeq]);
  }
}
