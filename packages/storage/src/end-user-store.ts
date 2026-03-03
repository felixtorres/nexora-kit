import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IEndUserStore,
  EndUserRecord,
  CreateEndUserInput,
} from './interfaces.js';

export class SqliteEndUserStore implements IEndUserStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateEndUserInput): EndUserRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO end_users (id, agent_id, external_id, display_name, metadata, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.agentId,
      input.externalId ?? null,
      input.displayName ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
    );

    return {
      id,
      agentId: input.agentId,
      externalId: input.externalId ?? null,
      displayName: input.displayName ?? null,
      metadata: input.metadata ?? {},
      firstSeenAt: now,
      lastSeenAt: null,
    };
  }

  get(id: string): EndUserRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM end_users WHERE id = ?',
    ).get(id) as any;

    return row ? this.mapRow(row) : undefined;
  }

  getByExternalId(agentId: string, externalId: string): EndUserRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM end_users WHERE agent_id = ? AND external_id = ?',
    ).get(agentId, externalId) as any;

    return row ? this.mapRow(row) : undefined;
  }

  getOrCreate(agentId: string, externalId: string, displayName?: string): EndUserRecord {
    const existing = this.getByExternalId(agentId, externalId);
    if (existing) {
      this.updateLastSeen(existing.id);
      return { ...existing, lastSeenAt: new Date().toISOString() };
    }

    return this.create({ agentId, externalId, displayName });
  }

  list(agentId: string): EndUserRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM end_users WHERE agent_id = ? ORDER BY first_seen_at DESC',
    ).all(agentId) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  updateLastSeen(id: string): void {
    this.db.prepare(
      'UPDATE end_users SET last_seen_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), id);
  }

  private mapRow(row: any): EndUserRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      externalId: row.external_id ?? null,
      displayName: row.display_name ?? null,
      metadata: JSON.parse(row.metadata),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at ?? null,
    };
  }
}
