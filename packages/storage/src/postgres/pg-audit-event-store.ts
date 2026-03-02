import type { AuditEvent, AuditEventFilter } from '../audit-event-store.js';
import type { IAuditEventStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgAuditEventStore implements IAuditEventStore {
  constructor(private readonly pool: PgPool) {}

  async insert(event: AuditEvent): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO audit_events (actor, action, target, details, result)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        event.actor,
        event.action,
        event.target,
        JSON.stringify(event.details ?? {}),
        event.result,
      ],
    );
    return rows[0].id;
  }

  async query(filter: AuditEventFilter = {}): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.actor) {
      conditions.push(`actor = $${paramIdx++}`);
      params.push(filter.actor);
    }
    if (filter.action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(filter.action);
    }
    if (filter.target) {
      conditions.push(`target = $${paramIdx++}`);
      params.push(filter.target);
    }
    if (filter.since) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.since);
    }

    let sql = 'SELECT id, actor, action, target, details, result, created_at FROM audit_events';
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
      actor: row.actor,
      action: row.action,
      target: row.target,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
      result: row.result as 'success' | 'failure',
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    }));
  }

  async deleteOlderThan(days: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM audit_events WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [days],
    );
    return result.rowCount;
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*) as cnt FROM audit_events');
    return Number(rows[0].cnt);
  }
}
