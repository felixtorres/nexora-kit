import type { UsageEvent, UsageEventFilter } from '../usage-event-store.js';
import type { IUsageEventStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgUsageEventStore implements IUsageEventStore {
  constructor(private readonly pool: PgPool) {}

  async insert(event: UsageEvent): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO usage_events (plugin_name, user_id, model, input_tokens, output_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        event.pluginName,
        event.userId ?? null,
        event.model ?? null,
        event.inputTokens,
        event.outputTokens,
        event.latencyMs ?? null,
      ],
    );
    return rows[0].id;
  }

  async query(filter: UsageEventFilter = {}): Promise<UsageEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.pluginName) {
      conditions.push(`plugin_name = $${paramIdx++}`);
      params.push(filter.pluginName);
    }
    if (filter.userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(filter.userId);
    }
    if (filter.since) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.since);
    }

    let sql = 'SELECT id, plugin_name, user_id, model, input_tokens, output_tokens, latency_ms, created_at FROM usage_events';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(filter.limit);
    }

    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => ({
      id: row.id,
      pluginName: row.plugin_name,
      userId: row.user_id ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      latencyMs: row.latency_ms ?? undefined,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    }));
  }
}
