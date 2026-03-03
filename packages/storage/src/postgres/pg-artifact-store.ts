import { randomUUID } from 'node:crypto';
import type { IArtifactStore, ArtifactRecord, ArtifactVersionRecord, CreateArtifactInput } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgArtifactStore implements IArtifactStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const id = randomUUID();
    const type = input.type ?? 'document';
    const metadata = JSON.stringify(input.metadata ?? {});

    await this.pool.query(
      `INSERT INTO artifacts (id, conversation_id, title, type, language, current_version, metadata)
       VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [id, input.conversationId, input.title, type, input.language ?? null, metadata],
    );

    await this.pool.query(
      `INSERT INTO artifact_versions (artifact_id, version, content)
       VALUES ($1, 1, $2)`,
      [id, input.content],
    );

    return (await this.get(id))!;
  }

  async update(id: string, content: string): Promise<ArtifactRecord | undefined> {
    const { rows: existing } = await this.pool.query(
      'SELECT id, current_version FROM artifacts WHERE id = $1',
      [id],
    );

    if (existing.length === 0) return undefined;

    const nextVersion = (existing[0].current_version as number) + 1;

    await this.pool.query(
      `INSERT INTO artifact_versions (artifact_id, version, content)
       VALUES ($1, $2, $3)`,
      [id, nextVersion, content],
    );

    await this.pool.query(
      `UPDATE artifacts SET current_version = $1, updated_at = NOW() WHERE id = $2`,
      [nextVersion, id],
    );

    return (await this.get(id))!;
  }

  async get(id: string): Promise<ArtifactRecord | undefined> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.conversation_id, a.title, a.type, a.language, a.current_version, a.metadata, a.created_at, a.updated_at,
              v.content
       FROM artifacts a
       JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.current_version
       WHERE a.id = $1`,
      [id],
    );

    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<ArtifactRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.conversation_id, a.title, a.type, a.language, a.current_version, a.metadata, a.created_at, a.updated_at,
              v.content
       FROM artifacts a
       JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.current_version
       WHERE a.conversation_id = $1
       ORDER BY a.created_at ASC`,
      [conversationId],
    );

    return rows.map(mapRow);
  }

  async getVersion(id: string, version: number): Promise<ArtifactVersionRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT artifact_id, version, content, created_at FROM artifact_versions WHERE artifact_id = $1 AND version = $2',
      [id, version],
    );

    return rows.length > 0 ? mapVersionRow(rows[0]) : undefined;
  }

  async listVersions(id: string): Promise<ArtifactVersionRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT artifact_id, version, content, created_at FROM artifact_versions WHERE artifact_id = $1 ORDER BY version ASC',
      [id],
    );

    return rows.map(mapVersionRow);
  }

  async delete(id: string): Promise<boolean> {
    await this.pool.query('DELETE FROM artifact_versions WHERE artifact_id = $1', [id]);
    const { rowCount } = await this.pool.query('DELETE FROM artifacts WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = $1)',
      [conversationId],
    );
    await this.pool.query('DELETE FROM artifacts WHERE conversation_id = $1', [conversationId]);
  }
}

function mapRow(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    title: row.title as string,
    type: row.type as ArtifactRecord['type'],
    language: (row.language as string | null) ?? null,
    currentVersion: row.current_version as number,
    content: row.content as string,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string),
  };
}

function mapVersionRow(row: Record<string, unknown>): ArtifactVersionRecord {
  return {
    artifactId: row.artifact_id as string,
    version: row.version as number,
    content: row.content as string,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
  };
}
