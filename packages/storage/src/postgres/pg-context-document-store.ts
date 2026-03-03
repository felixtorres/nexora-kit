import { randomUUID } from 'node:crypto';
import type { IContextDocumentStore, ContextDocumentRecord, CreateContextDocumentInput, ContextDocumentPatch } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class PgContextDocumentStore implements IContextDocumentStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateContextDocumentInput): Promise<ContextDocumentRecord> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const tokenCount = estimateTokens(input.content);

    const { rows } = await this.pool.query(
      `INSERT INTO context_documents (id, workspace_id, title, content, priority, token_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, input.workspaceId, input.title, input.content, input.priority ?? 0, tokenCount, metadata],
    );

    return mapRow(rows[0]);
  }

  async get(id: string): Promise<ContextDocumentRecord | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM context_documents WHERE id = $1', [id]);
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<ContextDocumentRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM context_documents WHERE workspace_id = $1 ORDER BY priority DESC, title ASC',
      [workspaceId],
    );
    return rows.map(mapRow);
  }

  async update(id: string, patch: ContextDocumentPatch): Promise<ContextDocumentRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (patch.title !== undefined) { sets.push(`title = $${idx++}`); params.push(patch.title); }
    if (patch.content !== undefined) {
      sets.push(`content = $${idx++}`);
      params.push(patch.content);
      sets.push(`token_count = $${idx++}`);
      params.push(estimateTokens(patch.content));
    }
    if (patch.priority !== undefined) { sets.push(`priority = $${idx++}`); params.push(patch.priority); }
    if (patch.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(patch.metadata)); }

    if (sets.length === 0) return existing;

    sets.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await this.pool.query(
      `UPDATE context_documents SET ${sets.join(', ')} WHERE id = $${idx++} RETURNING *`,
      params,
    );

    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM context_documents WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await this.pool.query('DELETE FROM context_documents WHERE workspace_id = $1', [workspaceId]);
  }
}

function mapRow(row: Record<string, unknown>): ContextDocumentRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    title: row.title as string,
    content: row.content as string,
    priority: row.priority as number,
    tokenCount: row.token_count as number,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string),
  };
}
