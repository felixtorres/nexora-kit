import type Database from 'better-sqlite3';
import type { IUsageEventStore } from './interfaces.js';

export interface UsageEvent {
  id?: number;
  pluginName: string;
  userId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  createdAt?: string;
}

export interface UsageEventFilter {
  pluginName?: string;
  userId?: string;
  since?: string;
  limit?: number;
}

export class SqliteUsageEventStore implements IUsageEventStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(event: UsageEvent): number {
    const result = this.db
      .prepare(
        `INSERT INTO usage_events (plugin_name, user_id, model, input_tokens, output_tokens, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.pluginName,
        event.userId ?? null,
        event.model ?? null,
        event.inputTokens,
        event.outputTokens,
        event.latencyMs ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  query(filter: UsageEventFilter = {}): UsageEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.pluginName) {
      conditions.push('plugin_name = ?');
      params.push(filter.pluginName);
    }
    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter.since) {
      conditions.push('created_at >= ?');
      params.push(filter.since);
    }

    let sql = 'SELECT id, plugin_name, user_id, model, input_tokens, output_tokens, latency_ms, created_at FROM usage_events';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as {
      id: number;
      plugin_name: string;
      user_id: string | null;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      latency_ms: number | null;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      pluginName: row.plugin_name,
      userId: row.user_id ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      latencyMs: row.latency_ms ?? undefined,
      createdAt: row.created_at,
    }));
  }
}
