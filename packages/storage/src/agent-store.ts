import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IAgentStore,
  AgentRecord,
  CreateAgentInput,
  AgentPatch,
} from './interfaces.js';

export class SqliteAgentStore implements IAgentStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateAgentInput): AgentRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO agents (id, team_id, slug, name, description, orchestration_strategy, orchestrator_model, orchestrator_prompt, bot_id, fallback_bot_id, appearance, end_user_auth, rate_limits, features, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.teamId,
      input.slug,
      input.name,
      input.description ?? '',
      input.orchestrationStrategy ?? 'single',
      input.orchestratorModel ?? null,
      input.orchestratorPrompt ?? null,
      input.botId ?? null,
      input.fallbackBotId ?? null,
      JSON.stringify(input.appearance ?? {}),
      JSON.stringify(input.endUserAuth ?? {}),
      JSON.stringify(input.rateLimits ?? {}),
      JSON.stringify(input.features ?? {}),
      input.enabled !== false ? 1 : 0,
      now,
      now,
    );

    return {
      id,
      teamId: input.teamId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? '',
      orchestrationStrategy: input.orchestrationStrategy ?? 'single',
      orchestratorModel: input.orchestratorModel ?? null,
      orchestratorPrompt: input.orchestratorPrompt ?? null,
      botId: input.botId ?? null,
      fallbackBotId: input.fallbackBotId ?? null,
      appearance: input.appearance ?? {},
      endUserAuth: input.endUserAuth ?? {},
      rateLimits: input.rateLimits ?? {},
      features: input.features ?? {},
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
  }

  get(id: string, teamId: string): AgentRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM agents WHERE id = ? AND team_id = ?',
    ).get(id, teamId) as any;

    return row ? this.mapRow(row) : undefined;
  }

  getBySlug(slug: string, teamId: string): AgentRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM agents WHERE slug = ? AND team_id = ?',
    ).get(slug, teamId) as any;

    return row ? this.mapRow(row) : undefined;
  }

  getBySlugGlobal(slug: string): AgentRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM agents WHERE slug = ? AND enabled = 1 LIMIT 1',
    ).get(slug) as any;

    return row ? this.mapRow(row) : undefined;
  }

  list(teamId: string): AgentRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM agents WHERE team_id = ? ORDER BY name ASC',
    ).all(teamId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  update(id: string, teamId: string, patch: AgentPatch): AgentRecord | undefined {
    const existing = this.get(id, teamId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (patch.slug !== undefined) {
      sets.push('slug = ?');
      values.push(patch.slug);
    }
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      values.push(patch.description);
    }
    if (patch.orchestrationStrategy !== undefined) {
      sets.push('orchestration_strategy = ?');
      values.push(patch.orchestrationStrategy);
    }
    if (patch.orchestratorModel !== undefined) {
      sets.push('orchestrator_model = ?');
      values.push(patch.orchestratorModel);
    }
    if (patch.orchestratorPrompt !== undefined) {
      sets.push('orchestrator_prompt = ?');
      values.push(patch.orchestratorPrompt);
    }
    if (patch.botId !== undefined) {
      sets.push('bot_id = ?');
      values.push(patch.botId);
    }
    if (patch.fallbackBotId !== undefined) {
      sets.push('fallback_bot_id = ?');
      values.push(patch.fallbackBotId);
    }
    if (patch.appearance !== undefined) {
      sets.push('appearance = ?');
      values.push(JSON.stringify(patch.appearance));
    }
    if (patch.endUserAuth !== undefined) {
      sets.push('end_user_auth = ?');
      values.push(JSON.stringify(patch.endUserAuth));
    }
    if (patch.rateLimits !== undefined) {
      sets.push('rate_limits = ?');
      values.push(JSON.stringify(patch.rateLimits));
    }
    if (patch.features !== undefined) {
      sets.push('features = ?');
      values.push(JSON.stringify(patch.features));
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }

    values.push(id, teamId);

    this.db.prepare(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    ).run(...values);

    return this.get(id, teamId);
  }

  delete(id: string, teamId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM agents WHERE id = ? AND team_id = ?',
    ).run(id, teamId);

    return result.changes > 0;
  }

  private mapRow(row: any): AgentRecord {
    return {
      id: row.id,
      teamId: row.team_id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      orchestrationStrategy: row.orchestration_strategy,
      orchestratorModel: row.orchestrator_model ?? null,
      orchestratorPrompt: row.orchestrator_prompt ?? null,
      botId: row.bot_id ?? null,
      fallbackBotId: row.fallback_bot_id ?? null,
      appearance: JSON.parse(row.appearance),
      endUserAuth: JSON.parse(row.end_user_auth),
      rateLimits: JSON.parse(row.rate_limits),
      features: JSON.parse(row.features),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
