import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IContextDocumentStore, ContextDocumentRecord, CreateContextDocumentInput, ContextDocumentPatch } from './interfaces.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class SqliteContextDocumentStore implements IContextDocumentStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateContextDocumentInput): ContextDocumentRecord {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const tokenCount = estimateTokens(input.content);

    this.db
      .prepare(
        `INSERT INTO context_documents (id, workspace_id, title, content, priority, token_count, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.workspaceId, input.title, input.content, input.priority ?? 0, tokenCount, metadata);

    return this.get(id)!;
  }

  get(id: string): ContextDocumentRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM context_documents WHERE id = ?')
      .get(id) as DocRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  listByWorkspace(workspaceId: string): ContextDocumentRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM context_documents WHERE workspace_id = ? ORDER BY priority DESC, title ASC')
      .all(workspaceId) as DocRow[];

    return rows.map(mapRow);
  }

  update(id: string, patch: ContextDocumentPatch): ContextDocumentRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
      sets.push('token_count = ?');
      params.push(estimateTokens(patch.content));
    }
    if (patch.priority !== undefined) { sets.push('priority = ?'); params.push(patch.priority); }
    if (patch.metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(patch.metadata)); }

    if (sets.length === 0) return existing;

    sets.push("updated_at = datetime('now')");
    params.push(id);

    this.db
      .prepare(`UPDATE context_documents SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM context_documents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM context_documents WHERE workspace_id = ?').run(workspaceId);
  }
}

interface DocRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  priority: number;
  token_count: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DocRow): ContextDocumentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    content: row.content,
    priority: row.priority,
    tokenCount: row.token_count,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
