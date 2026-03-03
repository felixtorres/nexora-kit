import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IConversationTemplateStore,
  ConversationTemplateRecord,
  CreateConversationTemplateInput,
  ConversationTemplatePatch,
} from './interfaces.js';

export class SqliteConversationTemplateStore implements IConversationTemplateStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateConversationTemplateInput): ConversationTemplateRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO conversation_templates (id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );

    return this.get(id, input.teamId)!;
  }

  get(id: string, teamId: string): ConversationTemplateRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, metadata, created_at, updated_at FROM conversation_templates WHERE id = ? AND team_id = ?',
      )
      .get(id, teamId) as TemplateRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  list(teamId: string): ConversationTemplateRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, team_id, name, description, system_prompt, plugin_namespaces, model, temperature, max_turns, metadata, created_at, updated_at FROM conversation_templates WHERE team_id = ? ORDER BY name ASC',
      )
      .all(teamId) as TemplateRow[];

    return rows.map(mapRow);
  }

  update(id: string, teamId: string, patch: ConversationTemplatePatch): ConversationTemplateRecord | undefined {
    const existing = this.get(id, teamId);
    if (!existing) return undefined;

    const fields: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); params.push(patch.name); }
    if (patch.description !== undefined) { fields.push('description = ?'); params.push(patch.description); }
    if (patch.systemPrompt !== undefined) { fields.push('system_prompt = ?'); params.push(patch.systemPrompt); }
    if (patch.pluginNamespaces !== undefined) { fields.push('plugin_namespaces = ?'); params.push(JSON.stringify(patch.pluginNamespaces)); }
    if (patch.model !== undefined) { fields.push('model = ?'); params.push(patch.model); }
    if (patch.temperature !== undefined) { fields.push('temperature = ?'); params.push(patch.temperature); }
    if (patch.maxTurns !== undefined) { fields.push('max_turns = ?'); params.push(patch.maxTurns); }
    if (patch.metadata !== undefined) { fields.push('metadata = ?'); params.push(JSON.stringify(patch.metadata)); }

    if (fields.length === 0) return existing;

    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    params.push(now, id, teamId);

    this.db
      .prepare(`UPDATE conversation_templates SET ${fields.join(', ')} WHERE id = ? AND team_id = ?`)
      .run(...params);

    return this.get(id, teamId)!;
  }

  delete(id: string, teamId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM conversation_templates WHERE id = ? AND team_id = ?')
      .run(id, teamId);
    return result.changes > 0;
  }
}

interface TemplateRow {
  id: string;
  team_id: string;
  name: string;
  description: string;
  system_prompt: string | null;
  plugin_namespaces: string;
  model: string | null;
  temperature: number | null;
  max_turns: number | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TemplateRow): ConversationTemplateRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    pluginNamespaces: JSON.parse(row.plugin_namespaces),
    model: row.model,
    temperature: row.temperature,
    maxTurns: row.max_turns,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
