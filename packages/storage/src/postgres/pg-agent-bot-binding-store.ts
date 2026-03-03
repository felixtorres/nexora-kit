import type { PgPool } from './pg-pool.js';
import type {
  IAgentBotBindingStore,
  BindingRecord,
  BindingInput,
} from '../interfaces.js';

export class PgAgentBotBindingStore implements IAgentBotBindingStore {
  constructor(private readonly pool: PgPool) {}

  async set(input: BindingInput): Promise<BindingRecord> {
    await this.pool.query(
      `INSERT INTO agent_bot_bindings (agent_id, bot_id, priority, description, keywords)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(agent_id, bot_id) DO UPDATE SET
         priority = EXCLUDED.priority,
         description = EXCLUDED.description,
         keywords = EXCLUDED.keywords`,
      [
        input.agentId,
        input.botId,
        input.priority ?? 0,
        input.description ?? '',
        JSON.stringify(input.keywords ?? []),
      ],
    );

    return {
      agentId: input.agentId,
      botId: input.botId,
      priority: input.priority ?? 0,
      description: input.description ?? '',
      keywords: input.keywords ?? [],
    };
  }

  async list(agentId: string): Promise<BindingRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agent_bot_bindings WHERE agent_id = $1 ORDER BY priority DESC',
      [agentId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  async remove(agentId: string, botId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM agent_bot_bindings WHERE agent_id = $1 AND bot_id = $2',
      [agentId, botId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async removeAll(agentId: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM agent_bot_bindings WHERE agent_id = $1',
      [agentId],
    );
    return result.rowCount ?? 0;
  }

  private mapRow(row: any): BindingRecord {
    return {
      agentId: row.agent_id,
      botId: row.bot_id,
      priority: row.priority,
      description: row.description,
      keywords: typeof row.keywords === 'string' ? JSON.parse(row.keywords) : row.keywords,
    };
  }
}
