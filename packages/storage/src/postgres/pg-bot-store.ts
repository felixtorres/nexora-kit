import { randomUUID } from 'node:crypto';
import type { PgPool } from './pg-pool.js';
import type {
  IBotStore,
  BotRecord,
  CreateBotInput,
  BotPatch,
} from '../interfaces.js';

export class PgBotStore implements IBotStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateBotInput): Promise<BotRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO bots (id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, workspace_id, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        input.teamId,
        input.name,
        input.description ?? '',
        input.systemPrompt,
        JSON.stringify(input.pluginNamespaces ?? []),
        input.model,
        input.temperature ?? null,
        input.maxTurns ?? null,
        input.workspaceId ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ],
    );

    return {
      id,
      teamId: input.teamId,
      name: input.name,
      description: input.description ?? '',
      systemPrompt: input.systemPrompt,
      pluginNamespaces: input.pluginNamespaces ?? [],
      model: input.model,
      temperature: input.temperature ?? null,
      maxTurns: input.maxTurns ?? null,
      workspaceId: input.workspaceId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async get(id: string, teamId: string): Promise<BotRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM bots WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async list(teamId: string): Promise<BotRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM bots WHERE team_id = $1 ORDER BY name ASC',
      [teamId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, teamId: string, patch: BotPatch): Promise<BotRecord | undefined> {
    const existing = await this.get(id, teamId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (patch.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(patch.description);
    }
    if (patch.systemPrompt !== undefined) {
      sets.push(`system_prompt = $${idx++}`);
      values.push(patch.systemPrompt);
    }
    if (patch.pluginNamespaces !== undefined) {
      sets.push(`plugin_namespaces = $${idx++}`);
      values.push(JSON.stringify(patch.pluginNamespaces));
    }
    if (patch.model !== undefined) {
      sets.push(`model = $${idx++}`);
      values.push(patch.model);
    }
    if (patch.temperature !== undefined) {
      sets.push(`temperature = $${idx++}`);
      values.push(patch.temperature);
    }
    if (patch.maxTurns !== undefined) {
      sets.push(`max_turns = $${idx++}`);
      values.push(patch.maxTurns);
    }
    if (patch.workspaceId !== undefined) {
      sets.push(`workspace_id = $${idx++}`);
      values.push(patch.workspaceId);
    }
    if (patch.metadata !== undefined) {
      sets.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(patch.metadata));
    }

    values.push(id, teamId);

    await this.pool.query(
      `UPDATE bots SET ${sets.join(', ')} WHERE id = $${idx++} AND team_id = $${idx}`,
      values,
    );

    return this.get(id, teamId);
  }

  async delete(id: string, teamId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM bots WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: any): BotRecord {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      pluginNamespaces: typeof row.plugin_namespaces === 'string'
        ? JSON.parse(row.plugin_namespaces)
        : row.plugin_namespaces,
      model: row.model,
      temperature: row.temperature ?? null,
      maxTurns: row.max_turns ?? null,
      workspaceId: row.workspace_id ?? null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    };
  }
}
