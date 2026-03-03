import { randomUUID } from 'node:crypto';
import type { PgPool } from './pg-pool.js';
import type {
  IAgentStore,
  AgentRecord,
  CreateAgentInput,
  AgentPatch,
} from '../interfaces.js';

export class PgAgentStore implements IAgentStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateAgentInput): Promise<AgentRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO agents (id, team_id, slug, name, description, orchestration_strategy, orchestrator_model, orchestrator_prompt, bot_id, fallback_bot_id, appearance, end_user_auth, rate_limits, features, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
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
        input.enabled !== false,
        now,
        now,
      ],
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

  async get(id: string, teamId: string): Promise<AgentRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agents WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getBySlug(slug: string, teamId: string): Promise<AgentRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agents WHERE slug = $1 AND team_id = $2',
      [slug, teamId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getBySlugGlobal(slug: string): Promise<AgentRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agents WHERE slug = $1 AND enabled = TRUE LIMIT 1',
      [slug],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async list(teamId: string): Promise<AgentRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agents WHERE team_id = $1 ORDER BY name ASC',
      [teamId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, teamId: string, patch: AgentPatch): Promise<AgentRecord | undefined> {
    const existing = await this.get(id, teamId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (patch.slug !== undefined) {
      sets.push(`slug = $${idx++}`);
      values.push(patch.slug);
    }
    if (patch.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(patch.description);
    }
    if (patch.orchestrationStrategy !== undefined) {
      sets.push(`orchestration_strategy = $${idx++}`);
      values.push(patch.orchestrationStrategy);
    }
    if (patch.orchestratorModel !== undefined) {
      sets.push(`orchestrator_model = $${idx++}`);
      values.push(patch.orchestratorModel);
    }
    if (patch.orchestratorPrompt !== undefined) {
      sets.push(`orchestrator_prompt = $${idx++}`);
      values.push(patch.orchestratorPrompt);
    }
    if (patch.botId !== undefined) {
      sets.push(`bot_id = $${idx++}`);
      values.push(patch.botId);
    }
    if (patch.fallbackBotId !== undefined) {
      sets.push(`fallback_bot_id = $${idx++}`);
      values.push(patch.fallbackBotId);
    }
    if (patch.appearance !== undefined) {
      sets.push(`appearance = $${idx++}`);
      values.push(JSON.stringify(patch.appearance));
    }
    if (patch.endUserAuth !== undefined) {
      sets.push(`end_user_auth = $${idx++}`);
      values.push(JSON.stringify(patch.endUserAuth));
    }
    if (patch.rateLimits !== undefined) {
      sets.push(`rate_limits = $${idx++}`);
      values.push(JSON.stringify(patch.rateLimits));
    }
    if (patch.features !== undefined) {
      sets.push(`features = $${idx++}`);
      values.push(JSON.stringify(patch.features));
    }
    if (patch.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      values.push(patch.enabled);
    }

    values.push(id, teamId);

    await this.pool.query(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${idx++} AND team_id = $${idx}`,
      values,
    );

    return this.get(id, teamId);
  }

  async delete(id: string, teamId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM agents WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: any): AgentRecord {
    const parseJson = (val: any) => typeof val === 'string' ? JSON.parse(val) : val;
    const toIso = (val: any) => val?.toISOString?.() ?? val;

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
      appearance: parseJson(row.appearance),
      endUserAuth: parseJson(row.end_user_auth),
      rateLimits: parseJson(row.rate_limits),
      features: parseJson(row.features),
      enabled: row.enabled,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }
}
