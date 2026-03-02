import type { Message } from '@nexora-kit/core';
import type { IMemoryStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgMemoryStore implements IMemoryStore {
  constructor(private readonly pool: PgPool) {}

  async get(sessionId: string): Promise<Message[]> {
    const { rows } = await this.pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY seq ASC',
      [sessionId],
    );
    return rows.map((row) => ({
      role: row.role as Message['role'],
      content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    }));
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    const { rows } = await this.pool.query(
      'SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE session_id = $1',
      [sessionId],
    );
    let seq = Number(rows[0].max_seq);

    for (const msg of messages) {
      seq++;
      await this.pool.query(
        'INSERT INTO messages (session_id, role, content, seq) VALUES ($1, $2, $3, $4)',
        [sessionId, msg.role, JSON.stringify(msg.content), seq],
      );
    }
  }

  async clear(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  }
}
