import { randomUUID } from 'node:crypto';
import type {
  IConversationTemplateStore,
  ConversationTemplateRecord,
  CreateConversationTemplateInput,
  ConversationTemplatePatch,
} from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgConversationTemplateStore implements IConversationTemplateStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateConversationTemplateInput): Promise<ConversationTemplateRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const { rows } = await this.pool.query(
      `INSERT INTO conversation_templates (id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id,
        input.teamId,
        input.name,
        input.description ?? '',
        input.systemPrompt ?? null,
        JSON.stringify(input.pluginNamespaces ?? []),
        input.model ?? null,
        input.temperature ?? null,
        input.maxTurns ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ],
    );

    return mapRow(rows[0]);
  }

  async get(id: string, teamId: string): Promise<ConversationTemplateRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversation_templates WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async list(teamId: string): Promise<ConversationTemplateRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversation_templates WHERE team_id = $1 ORDER BY name ASC',
      [teamId],
    );
    return rows.map(mapRow);
  }

  async update(id: string, teamId: string, patch: ConversationTemplatePatch): Promise<ConversationTemplateRecord | undefined> {
    const existing = await this.get(id, teamId);
    if (!existing) return undefined;

    const fields: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (patch.name !== undefined) { fields.push(`name = $${paramIdx++}`); params.push(patch.name); }
    if (patch.description !== undefined) { fields.push(`description = $${paramIdx++}`); params.push(patch.description); }
    if (patch.systemPrompt !== undefined) { fields.push(`system_prompt = $${paramIdx++}`); params.push(patch.systemPrompt); }
    if (patch.pluginNamespaces !== undefined) { fields.push(`plugin_namespaces = $${paramIdx++}`); params.push(JSON.stringify(patch.pluginNamespaces)); }
    if (patch.model !== undefined) { fields.push(`model = $${paramIdx++}`); params.push(patch.model); }
    if (patch.temperature !== undefined) { fields.push(`temperature = $${paramIdx++}`); params.push(patch.temperature); }
    if (patch.maxTurns !== undefined) { fields.push(`max_turns = $${paramIdx++}`); params.push(patch.maxTurns); }
    if (patch.metadata !== undefined) { fields.push(`metadata = $${paramIdx++}`); params.push(JSON.stringify(patch.metadata)); }

    if (fields.length === 0) return existing;

    const now = new Date().toISOString();
    fields.push(`updated_at = $${paramIdx++}`);
    params.push(now, id, teamId);

    const { rows } = await this.pool.query(
      `UPDATE conversation_templates SET ${fields.join(', ')} WHERE id = $${paramIdx++} AND team_id = $${paramIdx++} RETURNING *`,
      params,
    );

    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async delete(id: string, teamId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM conversation_templates WHERE id = $1 AND team_id = $2',
      [id, teamId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function mapRow(row: Record<string, unknown>): ConversationTemplateRecord {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    systemPrompt: (row.system_prompt as string | null) ?? null,
    pluginNamespaces: typeof row.plugin_namespaces === 'string' ? JSON.parse(row.plugin_namespaces) : (row.plugin_namespaces as string[]),
    model: (row.model as string | null) ?? null,
    temperature: (row.temperature as number | null) ?? null,
    maxTurns: (row.max_turns as number | null) ?? null,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string),
  };
}
