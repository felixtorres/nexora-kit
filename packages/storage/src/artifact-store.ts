import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IArtifactStore, ArtifactRecord, ArtifactVersionRecord, CreateArtifactInput } from './interfaces.js';

export class SqliteArtifactStore implements IArtifactStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateArtifactInput): ArtifactRecord {
    const id = randomUUID();
    const type = input.type ?? 'document';
    const metadata = JSON.stringify(input.metadata ?? {});

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO artifacts (id, conversation_id, title, type, language, current_version, metadata)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(id, input.conversationId, input.title, type, input.language ?? null, metadata);

      this.db
        .prepare(
          `INSERT INTO artifact_versions (artifact_id, version, content)
           VALUES (?, 1, ?)`,
        )
        .run(id, input.content);
    });

    insert();
    return this.get(id)!;
  }

  update(id: string, content: string): ArtifactRecord | undefined {
    const existing = this.db
      .prepare('SELECT id, current_version FROM artifacts WHERE id = ?')
      .get(id) as { id: string; current_version: number } | undefined;

    if (!existing) return undefined;

    const nextVersion = existing.current_version + 1;

    const doUpdate = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO artifact_versions (artifact_id, version, content)
           VALUES (?, ?, ?)`,
        )
        .run(id, nextVersion, content);

      this.db
        .prepare(
          `UPDATE artifacts SET current_version = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(nextVersion, id);
    });

    doUpdate();
    return this.get(id)!;
  }

  get(id: string): ArtifactRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT a.id, a.conversation_id, a.title, a.type, a.language, a.current_version, a.metadata, a.created_at, a.updated_at,
                v.content
         FROM artifacts a
         JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.current_version
         WHERE a.id = ?`,
      )
      .get(id) as ArtifactRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  listByConversation(conversationId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.conversation_id, a.title, a.type, a.language, a.current_version, a.metadata, a.created_at, a.updated_at,
                v.content
         FROM artifacts a
         JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.current_version
         WHERE a.conversation_id = ?
         ORDER BY a.created_at ASC`,
      )
      .all(conversationId) as ArtifactRow[];

    return rows.map(mapRow);
  }

  getVersion(id: string, version: number): ArtifactVersionRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT artifact_id, version, content, created_at FROM artifact_versions WHERE artifact_id = ? AND version = ?',
      )
      .get(id, version) as VersionRow | undefined;

    return row ? mapVersionRow(row) : undefined;
  }

  listVersions(id: string): ArtifactVersionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT artifact_id, version, content, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC',
      )
      .all(id) as VersionRow[];

    return rows.map(mapVersionRow);
  }

  delete(id: string): boolean {
    const result = this.db.transaction(() => {
      this.db.prepare('DELETE FROM artifact_versions WHERE artifact_id = ?').run(id);
      return this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
    })();

    return result.changes > 0;
  }

  deleteByConversation(conversationId: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = ?)',
        )
        .run(conversationId);
      this.db.prepare('DELETE FROM artifacts WHERE conversation_id = ?').run(conversationId);
    })();
  }
}

interface ArtifactRow {
  id: string;
  conversation_id: string;
  title: string;
  type: string;
  language: string | null;
  current_version: number;
  metadata: string;
  created_at: string;
  updated_at: string;
  content: string;
}

interface VersionRow {
  artifact_id: string;
  version: number;
  content: string;
  created_at: string;
}

function mapRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    type: row.type as ArtifactRecord['type'],
    language: row.language,
    currentVersion: row.current_version,
    content: row.content,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: VersionRow): ArtifactVersionRecord {
  return {
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    createdAt: row.created_at,
  };
}
