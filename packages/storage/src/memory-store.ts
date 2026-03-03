import type { MessageStore, Message } from '@nexora-kit/core';
import type Database from 'better-sqlite3';
import type { IMessageStore } from './interfaces.js';

export class SqliteMessageStore implements MessageStore, IMessageStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async get(conversationId: string): Promise<Message[]> {
    const rows = this.db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
      .all(conversationId) as { role: string; content: string }[];

    return rows.map((row) => ({
      role: row.role as Message['role'],
      content: JSON.parse(row.content),
    }));
  }

  async append(conversationId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    const transaction = this.db.transaction(() => {
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE conversation_id = ?')
        .get(conversationId) as { max_seq: number };
      let seq = maxRow.max_seq;

      const insert = this.db.prepare(
        'INSERT INTO messages (conversation_id, role, content, seq) VALUES (?, ?, ?, ?)',
      );

      for (const msg of messages) {
        seq++;
        insert.run(conversationId, msg.role, JSON.stringify(msg.content), seq);
      }
    });

    transaction();
  }

  async clear(conversationId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }

  async truncateFrom(conversationId: string, fromSeq: number): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ? AND seq > ?').run(conversationId, fromSeq);
  }
}
