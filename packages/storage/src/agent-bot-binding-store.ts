import type Database from 'better-sqlite3';
import type {
  IAgentBotBindingStore,
  BindingRecord,
  BindingInput,
} from './interfaces.js';

export class SqliteAgentBotBindingStore implements IAgentBotBindingStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  set(input: BindingInput): BindingRecord {
    this.db.prepare(`
      INSERT INTO agent_bot_bindings (agent_id, bot_id, priority, description, keywords)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, bot_id) DO UPDATE SET
        priority = excluded.priority,
        description = excluded.description,
        keywords = excluded.keywords
    `).run(
      input.agentId,
      input.botId,
      input.priority ?? 0,
      input.description ?? '',
      JSON.stringify(input.keywords ?? []),
    );

    return {
      agentId: input.agentId,
      botId: input.botId,
      priority: input.priority ?? 0,
      description: input.description ?? '',
      keywords: input.keywords ?? [],
    };
  }

  list(agentId: string): BindingRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_bot_bindings WHERE agent_id = ? ORDER BY priority DESC',
    ).all(agentId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  remove(agentId: string, botId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM agent_bot_bindings WHERE agent_id = ? AND bot_id = ?',
    ).run(agentId, botId);

    return result.changes > 0;
  }

  removeAll(agentId: string): number {
    const result = this.db.prepare(
      'DELETE FROM agent_bot_bindings WHERE agent_id = ?',
    ).run(agentId);

    return result.changes;
  }

  private mapRow(row: any): BindingRecord {
    return {
      agentId: row.agent_id,
      botId: row.bot_id,
      priority: row.priority,
      description: row.description,
      keywords: JSON.parse(row.keywords),
    };
  }
}
