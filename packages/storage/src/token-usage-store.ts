import type Database from 'better-sqlite3';

export interface TokenUsageRecord {
  pluginNamespace: string;
  used: number;
  limit: number;
  periodStart: string;
}

const INSTANCE_KEY = '__instance__';

export class SqliteTokenUsageStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  save(record: TokenUsageRecord): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (plugin_namespace, used, limit_val, period_start)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (plugin_namespace)
         DO UPDATE SET used = excluded.used, limit_val = excluded.limit_val, period_start = excluded.period_start`,
      )
      .run(record.pluginNamespace, record.used, record.limit, record.periodStart);
  }

  get(pluginNamespace: string): TokenUsageRecord | undefined {
    const row = this.db
      .prepare('SELECT plugin_namespace, used, limit_val, period_start FROM token_usage WHERE plugin_namespace = ?')
      .get(pluginNamespace) as { plugin_namespace: string; used: number; limit_val: number; period_start: string } | undefined;

    if (!row) return undefined;

    return {
      pluginNamespace: row.plugin_namespace,
      used: row.used,
      limit: row.limit_val,
      periodStart: row.period_start,
    };
  }

  getInstanceUsage(): TokenUsageRecord | undefined {
    return this.get(INSTANCE_KEY);
  }

  saveInstanceUsage(used: number, limit: number, periodStart: string): void {
    this.save({ pluginNamespace: INSTANCE_KEY, used, limit, periodStart });
  }

  getAll(): TokenUsageRecord[] {
    const rows = this.db
      .prepare('SELECT plugin_namespace, used, limit_val, period_start FROM token_usage')
      .all() as { plugin_namespace: string; used: number; limit_val: number; period_start: string }[];

    return rows.map((row) => ({
      pluginNamespace: row.plugin_namespace,
      used: row.used,
      limit: row.limit_val,
      periodStart: row.period_start,
    }));
  }

  reset(pluginNamespace: string): boolean {
    const result = this.db
      .prepare('DELETE FROM token_usage WHERE plugin_namespace = ?')
      .run(pluginNamespace);
    return result.changes > 0;
  }
}
