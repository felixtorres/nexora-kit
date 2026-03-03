import { randomUUID } from 'node:crypto';
import type { IWorkspaceStore, WorkspaceRecord, CreateWorkspaceInput, WorkspacePatch } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgWorkspaceStore implements IWorkspaceStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});

    const { rows } = await this.pool.query(
      `INSERT INTO workspaces (id, team_id, name, description, system_prompt, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, input.teamId, input.name, input.description ?? null, input.systemPrompt ?? null, metadata],
    );

    return mapRow(rows[0]);
  }

  async get(id: string, teamId: string): Promise<WorkspaceRecord | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM workspaces WHERE id = $1 AND team_id = $2', [id, teamId]);
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async list(teamId: string): Promise<WorkspaceRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM workspaces WHERE team_id = $1 ORDER BY name ASC', [teamId]);
    return rows.map(mapRow);
  }

  async update(id: string, teamId: string, patch: WorkspacePatch): Promise<WorkspaceRecord | undefined> {
    const existing = await this.get(id, teamId);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (patch.name !== undefined) { sets.push(`name = $${idx++}`); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push(`description = $${idx++}`); params.push(patch.description); }
    if (patch.systemPrompt !== undefined) { sets.push(`system_prompt = $${idx++}`); params.push(patch.systemPrompt); }
    if (patch.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(patch.metadata)); }

    if (sets.length === 0) return existing;

    sets.push(`updated_at = NOW()`);
    params.push(id, teamId);

    const { rows } = await this.pool.query(
      `UPDATE workspaces SET ${sets.join(', ')} WHERE id = $${idx++} AND team_id = $${idx++} RETURNING *`,
      params,
    );

    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async delete(id: string, teamId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM workspaces WHERE id = $1 AND team_id = $2', [id, teamId]);
    return (rowCount ?? 0) > 0;
  }
}

function mapRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    systemPrompt: (row.system_prompt as string | null) ?? null,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string),
  };
}
