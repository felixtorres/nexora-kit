import type {
  IUserMemoryStore,
  UserFact,
  SetFactInput,
  ListFactsOptions,
} from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgUserMemoryStore implements IUserMemoryStore {
  constructor(private readonly pool: PgPool) {}

  async get(userId: string, key: string, agentId?: string): Promise<UserFact | undefined> {
    const { rows } = await this.pool.query(
      'SELECT key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at FROM user_memory WHERE user_id = $1 AND agent_id = $2 AND key = $3',
      [userId, agentId ?? '', key],
    );
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async list(userId: string, opts?: ListFactsOptions, agentId?: string): Promise<UserFact[]> {
    const conditions = ['user_id = $1', 'agent_id = $2'];
    const params: unknown[] = [userId, agentId ?? ''];
    let paramIdx = 3;

    if (opts?.namespace) {
      conditions.push(`namespace = $${paramIdx++}`);
      params.push(opts.namespace);
    }

    const sql = `SELECT key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at FROM user_memory WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(mapRow);
  }

  async set(userId: string, fact: SetFactInput, agentId?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO user_memory (user_id, agent_id, key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(user_id, agent_id, key)
       DO UPDATE SET value = EXCLUDED.value, namespace = EXCLUDED.namespace, source = EXCLUDED.source,
                     plugin_namespace = EXCLUDED.plugin_namespace, confidence = EXCLUDED.confidence,
                     updated_at = EXCLUDED.updated_at`,
      [
        userId,
        agentId ?? '',
        fact.key,
        fact.value,
        fact.namespace ?? 'global',
        fact.source ?? 'plugin',
        fact.pluginNamespace ?? null,
        fact.confidence ?? null,
        now,
        now,
      ],
    );
  }

  async delete(userId: string, key: string, agentId?: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM user_memory WHERE user_id = $1 AND agent_id = $2 AND key = $3',
      [userId, agentId ?? '', key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAll(userId: string, agentId?: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM user_memory WHERE user_id = $1 AND agent_id = $2',
      [userId, agentId ?? ''],
    );
  }
}

function mapRow(row: Record<string, unknown>): UserFact {
  return {
    key: row.key as string,
    value: row.value as string,
    namespace: row.namespace as string,
    source: row.source as 'user' | 'plugin' | 'llm',
    pluginNamespace: (row.plugin_namespace as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string),
  };
}
