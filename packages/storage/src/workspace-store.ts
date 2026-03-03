import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IWorkspaceStore, WorkspaceRecord, CreateWorkspaceInput, WorkspacePatch } from './interfaces.js';

export class SqliteWorkspaceStore implements IWorkspaceStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateWorkspaceInput): WorkspaceRecord {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO workspaces (id, team_id, name, description, system_prompt, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.teamId, input.name, input.description ?? null, input.systemPrompt ?? null, metadata);

    return this.get(id, input.teamId)!;
  }

  get(id: string, teamId: string): WorkspaceRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ? AND team_id = ?')
      .get(id, teamId) as WorkspaceRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  list(teamId: string): WorkspaceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces WHERE team_id = ? ORDER BY name ASC')
      .all(teamId) as WorkspaceRow[];

    return rows.map(mapRow);
  }

  update(id: string, teamId: string, patch: WorkspacePatch): WorkspaceRecord | undefined {
    const existing = this.get(id, teamId);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
    if (patch.systemPrompt !== undefined) { sets.push('system_prompt = ?'); params.push(patch.systemPrompt); }
    if (patch.metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(patch.metadata)); }

    if (sets.length === 0) return existing;

    sets.push("updated_at = datetime('now')");
    params.push(id, teamId);

    this.db
      .prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`)
      .run(...params);

    return this.get(id, teamId);
  }

  delete(id: string, teamId: string): boolean {
    const result = this.db.prepare('DELETE FROM workspaces WHERE id = ? AND team_id = ?').run(id, teamId);
    return result.changes > 0;
  }
}

interface WorkspaceRow {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
