import { randomUUID } from 'node:crypto';
import type { PgPool } from './pg-pool.js';
import type {
  IEndUserStore,
  EndUserRecord,
  CreateEndUserInput,
} from '../interfaces.js';

export class PgEndUserStore implements IEndUserStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateEndUserInput): Promise<EndUserRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO end_users (id, agent_id, external_id, display_name, metadata, first_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.agentId,
        input.externalId ?? null,
        input.displayName ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
      ],
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

  async get(id: string): Promise<EndUserRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM end_users WHERE id = $1',
      [id],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getByExternalId(agentId: string, externalId: string): Promise<EndUserRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM end_users WHERE agent_id = $1 AND external_id = $2',
      [agentId, externalId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async getOrCreate(agentId: string, externalId: string, displayName?: string): Promise<EndUserRecord> {
    const existing = await this.getByExternalId(agentId, externalId);
    if (existing) {
      await this.updateLastSeen(existing.id);
      return { ...existing, lastSeenAt: new Date().toISOString() };
    }

    return this.create({ agentId, externalId, displayName });
  }

  async list(agentId: string): Promise<EndUserRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM end_users WHERE agent_id = $1 ORDER BY first_seen_at DESC',
      [agentId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  async updateLastSeen(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE end_users SET last_seen_at = $1 WHERE id = $2',
      [new Date().toISOString(), id],
    );
  }

  private mapRow(row: any): EndUserRecord {
    const toIso = (val: any) => val?.toISOString?.() ?? val;

    return {
      id: row.id,
      agentId: row.agent_id,
      externalId: row.external_id ?? null,
      displayName: row.display_name ?? null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      firstSeenAt: toIso(row.first_seen_at),
      lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    };
  }
}
