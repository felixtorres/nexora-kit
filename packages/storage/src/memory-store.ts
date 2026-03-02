import type { MemoryStore, Message } from '@nexora-kit/core';
import type Database from 'better-sqlite3';
import type { IMemoryStore } from './interfaces.js';

export class SqliteMemoryStore implements MemoryStore, IMemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async get(sessionId: string): Promise<Message[]> {
    const rows = this.db
      .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as { role: string; content: string }[];

    return rows.map((row) => ({
      role: row.role as Message['role'],
      content: JSON.parse(row.content),
    }));
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    const transaction = this.db.transaction(() => {
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE session_id = ?')
        .get(sessionId) as { max_seq: number };
      let seq = maxRow.max_seq;

      const insert = this.db.prepare(
        'INSERT INTO messages (session_id, role, content, seq) VALUES (?, ?, ?, ?)',
      );

      for (const msg of messages) {
        seq++;
        insert.run(sessionId, msg.role, JSON.stringify(msg.content), seq);
      }
    });

    transaction();
  }

  async clear(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  }
}
