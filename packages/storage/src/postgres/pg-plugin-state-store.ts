import type { PluginStateRecord } from '../plugin-state-store.js';
import type { IPluginStateStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgPluginStateStore implements IPluginStateStore {
  constructor(private readonly pool: PgPool) {}

  async save(record: PluginStateRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO plugin_states (namespace, state, version, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace)
       DO UPDATE SET state = EXCLUDED.state, version = EXCLUDED.version, error = EXCLUDED.error`,
      [record.namespace, record.state, record.version, record.error ?? null],
    );
  }

  async get(namespace: string): Promise<PluginStateRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT namespace, state, version, error, installed_at FROM plugin_states WHERE namespace = $1',
      [namespace],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      namespace: row.namespace,
      state: row.state,
      version: row.version,
      error: row.error ?? undefined,
      installedAt: row.installed_at?.toISOString?.() ?? row.installed_at,
    };
  }

  async getAll(): Promise<PluginStateRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT namespace, state, version, error, installed_at FROM plugin_states',
    );
    return rows.map((row) => ({
      namespace: row.namespace,
      state: row.state,
      version: row.version,
      error: row.error ?? undefined,
      installedAt: row.installed_at?.toISOString?.() ?? row.installed_at,
    }));
  }

  async remove(namespace: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM plugin_states WHERE namespace = $1',
      [namespace],
    );
    return result.rowCount > 0;
  }
}
