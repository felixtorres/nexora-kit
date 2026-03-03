import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IFileStore, FileRecord, CreateFileInput } from './interfaces.js';

export class SqliteFileStore implements IFileStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateFileInput): FileRecord {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO files (id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.conversationId, input.userId, input.filename, input.mimeType, input.sizeBytes, input.storagePath, metadata);

    return this.get(id)!;
  }

  get(id: string): FileRecord | undefined {
    const row = this.db
      .prepare('SELECT id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata, created_at FROM files WHERE id = ?')
      .get(id) as FileRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  listByConversation(conversationId: string): FileRecord[] {
    const rows = this.db
      .prepare('SELECT id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata, created_at FROM files WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as FileRow[];

    return rows.map(mapRow);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM files WHERE conversation_id = ?').run(conversationId);
  }
}

interface FileRow {
  id: string;
  conversation_id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  metadata: string;
  created_at: string;
}

function mapRow(row: FileRow): FileRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}
