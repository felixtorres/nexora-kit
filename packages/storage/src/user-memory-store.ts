import type Database from 'better-sqlite3';
import type {
  IUserMemoryStore,
  UserFact,
  SetFactInput,
  ListFactsOptions,
} from './interfaces.js';

export class SqliteUserMemoryStore implements IUserMemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(userId: string, key: string, agentId?: string): UserFact | undefined {
    const row = this.db
      .prepare(
        'SELECT key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at FROM user_memory WHERE user_id = ? AND agent_id = ? AND key = ?',
      )
      .get(userId, agentId ?? '', key) as UserMemoryRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  list(userId: string, opts?: ListFactsOptions, agentId?: string): UserFact[] {
    const conditions = ['user_id = ?', 'agent_id = ?'];
    const params: unknown[] = [userId, agentId ?? ''];

    if (opts?.namespace) {
      conditions.push('namespace = ?');
      params.push(opts.namespace);
    }

    const sql = `SELECT key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at FROM user_memory WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as UserMemoryRow[];
    return rows.map(mapRow);
  }

  set(userId: string, fact: SetFactInput, agentId?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_memory (user_id, agent_id, key, value, namespace, source, plugin_namespace, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, agent_id, key)
         DO UPDATE SET value = excluded.value, namespace = excluded.namespace, source = excluded.source,
                       plugin_namespace = excluded.plugin_namespace, confidence = excluded.confidence,
                       updated_at = excluded.updated_at`,
      )
      .run(
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
      );
  }

  delete(userId: string, key: string, agentId?: string): boolean {
    const result = this.db
      .prepare('DELETE FROM user_memory WHERE user_id = ? AND agent_id = ? AND key = ?')
      .run(userId, agentId ?? '', key);
    return result.changes > 0;
  }

  deleteAll(userId: string, agentId?: string): void {
    this.db
      .prepare('DELETE FROM user_memory WHERE user_id = ? AND agent_id = ?')
      .run(userId, agentId ?? '');
  }
}

interface UserMemoryRow {
  key: string;
  value: string;
  namespace: string;
  source: string;
  plugin_namespace: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserMemoryRow): UserFact {
  return {
    key: row.key,
    value: row.value,
    namespace: row.namespace,
    source: row.source as 'user' | 'plugin' | 'llm',
    pluginNamespace: row.plugin_namespace,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
