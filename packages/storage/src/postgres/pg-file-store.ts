import { randomUUID } from 'node:crypto';
import type { IFileStore, FileRecord, CreateFileInput } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgFileStore implements IFileStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateFileInput): Promise<FileRecord> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});

    const { rows } = await this.pool.query(
      `INSERT INTO files (id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata, created_at`,
      [id, input.conversationId, input.userId, input.filename, input.mimeType, input.sizeBytes, input.storagePath, metadata],
    );

    return mapRow(rows[0]);
  }

  async get(id: string): Promise<FileRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata, created_at FROM files WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<FileRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT id, conversation_id, user_id, filename, mime_type, size_bytes, storage_path, metadata, created_at FROM files WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId],
    );
    return rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM files WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await this.pool.query('DELETE FROM files WHERE conversation_id = $1', [conversationId]);
  }
}

function mapRow(row: Record<string, unknown>): FileRecord {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    userId: row.user_id as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    sizeBytes: row.size_bytes as number,
    storagePath: row.storage_path as string,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
  };
}
