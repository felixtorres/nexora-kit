import type { TokenUsageRecord } from '../token-usage-store.js';
import type { ITokenUsageStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgTokenUsageStore implements ITokenUsageStore {
  constructor(private readonly pool: PgPool) {}

  async save(record: TokenUsageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO token_usage (plugin_namespace, used, limit_val, period_start)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (plugin_namespace)
       DO UPDATE SET used = EXCLUDED.used, limit_val = EXCLUDED.limit_val, period_start = EXCLUDED.period_start`,
      [record.pluginNamespace, record.used, record.limit, record.periodStart],
    );
  }

  async get(pluginNamespace: string): Promise<TokenUsageRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT plugin_namespace, used, limit_val, period_start FROM token_usage WHERE plugin_namespace = $1',
      [pluginNamespace],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      pluginNamespace: row.plugin_namespace,
      used: row.used,
      limit: row.limit_val,
      periodStart: row.period_start?.toISOString?.() ?? row.period_start,
    };
  }

  async getAll(): Promise<TokenUsageRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT plugin_namespace, used, limit_val, period_start FROM token_usage',
    );
    return rows.map((row) => ({
      pluginNamespace: row.plugin_namespace,
      used: row.used,
      limit: row.limit_val,
      periodStart: row.period_start?.toISOString?.() ?? row.period_start,
    }));
  }

  async reset(pluginNamespace: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM token_usage WHERE plugin_namespace = $1',
      [pluginNamespace],
    );
    return result.rowCount > 0;
  }
}
