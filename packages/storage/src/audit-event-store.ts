import type Database from 'better-sqlite3';
import type { IAuditEventStore } from './interfaces.js';

export interface AuditEvent {
  id?: number;
  actor: string;
  action: string;
  target: string;
  details?: Record<string, unknown>;
  result: 'success' | 'failure';
  createdAt?: string;
}

export interface AuditEventFilter {
  actor?: string;
  action?: string;
  target?: string;
  since?: string;
  limit?: number;
}

export class SqliteAuditEventStore implements IAuditEventStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(event: AuditEvent): number {
    const result = this.db
      .prepare(
        `INSERT INTO audit_events (actor, action, target, details, result)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.actor,
        event.action,
        event.target,
        JSON.stringify(event.details ?? {}),
        event.result,
      );
    return Number(result.lastInsertRowid);
  }

  query(filter: AuditEventFilter = {}): AuditEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.actor) {
      conditions.push('actor = ?');
      params.push(filter.actor);
    }
    if (filter.action) {
      conditions.push('action = ?');
      params.push(filter.action);
    }
    if (filter.target) {
      conditions.push('target = ?');
      params.push(filter.target);
    }
    if (filter.since) {
      conditions.push('created_at >= ?');
      params.push(filter.since);
    }

    let sql = 'SELECT id, actor, action, target, details, result, created_at FROM audit_events';
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
      actor: string;
      action: string;
      target: string;
      details: string;
      result: string;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      details: JSON.parse(row.details),
      result: row.result as 'success' | 'failure',
      createdAt: row.created_at,
    }));
  }

  deleteOlderThan(days: number): number {
    if (days <= 0) {
      return this.db.prepare('DELETE FROM audit_events').run().changes;
    }

    const result = this.db
      .prepare(`DELETE FROM audit_events WHERE created_at < datetime('now', ?)`)
      .run(`-${days} days`);
    return result.changes;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM audit_events').get() as {
      cnt: number;
    };
    return row.cnt;
  }
}
