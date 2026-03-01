import type Database from 'better-sqlite3';

export interface PluginStateRecord {
  namespace: string;
  state: string;
  version: string;
  error?: string;
  installedAt?: string;
}

export class SqlitePluginStateStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  save(record: PluginStateRecord): void {
    this.db
      .prepare(
        `INSERT INTO plugin_states (namespace, state, version, error)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (namespace)
         DO UPDATE SET state = excluded.state, version = excluded.version, error = excluded.error`,
      )
      .run(record.namespace, record.state, record.version, record.error ?? null);
  }

  get(namespace: string): PluginStateRecord | undefined {
    const row = this.db
      .prepare('SELECT namespace, state, version, error, installed_at FROM plugin_states WHERE namespace = ?')
      .get(namespace) as { namespace: string; state: string; version: string; error: string | null; installed_at: string } | undefined;

    if (!row) return undefined;

    return {
      namespace: row.namespace,
      state: row.state,
      version: row.version,
      error: row.error ?? undefined,
      installedAt: row.installed_at,
    };
  }

  getAll(): PluginStateRecord[] {
    const rows = this.db
      .prepare('SELECT namespace, state, version, error, installed_at FROM plugin_states')
      .all() as { namespace: string; state: string; version: string; error: string | null; installed_at: string }[];

    return rows.map((row) => ({
      namespace: row.namespace,
      state: row.state,
      version: row.version,
      error: row.error ?? undefined,
      installedAt: row.installed_at,
    }));
  }

  remove(namespace: string): boolean {
    const result = this.db
      .prepare('DELETE FROM plugin_states WHERE namespace = ?')
      .run(namespace);
    return result.changes > 0;
  }
}
