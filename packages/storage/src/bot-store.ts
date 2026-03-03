import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IBotStore,
  BotRecord,
  CreateBotInput,
  BotPatch,
} from './interfaces.js';

export class SqliteBotStore implements IBotStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateBotInput): BotRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO bots (id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, workspace_id, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  get(id: string, teamId: string): BotRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM bots WHERE id = ? AND team_id = ?',
    ).get(id, teamId) as any;

    return row ? this.mapRow(row) : undefined;
  }

  list(teamId: string): BotRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM bots WHERE team_id = ? ORDER BY name ASC',
    ).all(teamId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  update(id: string, teamId: string, patch: BotPatch): BotRecord | undefined {
    const existing = this.get(id, teamId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      values.push(patch.description);
    }
    if (patch.systemPrompt !== undefined) {
      sets.push('system_prompt = ?');
      values.push(patch.systemPrompt);
    }
    if (patch.pluginNamespaces !== undefined) {
      sets.push('plugin_namespaces = ?');
      values.push(JSON.stringify(patch.pluginNamespaces));
    }
    if (patch.model !== undefined) {
      sets.push('model = ?');
      values.push(patch.model);
    }
    if (patch.temperature !== undefined) {
      sets.push('temperature = ?');
      values.push(patch.temperature);
    }
    if (patch.maxTurns !== undefined) {
      sets.push('max_turns = ?');
      values.push(patch.maxTurns);
    }
    if (patch.workspaceId !== undefined) {
      sets.push('workspace_id = ?');
      values.push(patch.workspaceId);
    }
    if (patch.metadata !== undefined) {
      sets.push('metadata = ?');
      values.push(JSON.stringify(patch.metadata));
    }

    values.push(id, teamId);

    this.db.prepare(
      `UPDATE bots SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    ).run(...values);

    return this.get(id, teamId);
  }

  delete(id: string, teamId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM bots WHERE id = ? AND team_id = ?',
    ).run(id, teamId);

    return result.changes > 0;
  }

  private mapRow(row: any): BotRecord {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      pluginNamespaces: JSON.parse(row.plugin_namespaces),
      model: row.model,
      temperature: row.temperature ?? null,
      maxTurns: row.max_turns ?? null,
      workspaceId: row.workspace_id ?? null,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
