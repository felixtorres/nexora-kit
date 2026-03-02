import type { ConfigResolver, ConfigEntry, ConfigLayer } from '@nexora-kit/config';
import type { IConfigStore } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgConfigStore implements IConfigStore {
  constructor(private readonly pool: PgPool) {}

  async loadInto(resolver: ConfigResolver): Promise<void> {
    const { rows } = await this.pool.query(
      'SELECT key, value, layer, plugin_namespace, user_id FROM config_entries',
    );
    for (const row of rows) {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      resolver.set(row.key, value, row.layer as ConfigLayer, {
        pluginNamespace: row.plugin_namespace || undefined,
        userId: row.user_id || undefined,
      });
    }
  }

  async persist(entry: ConfigEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO config_entries (key, value, layer, plugin_namespace, user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key, layer, plugin_namespace, user_id)
       DO UPDATE SET value = EXCLUDED.value`,
      [
        entry.key,
        JSON.stringify(entry.value),
        entry.layer,
        entry.pluginNamespace ?? '',
        entry.userId ?? '',
      ],
    );
  }

  async persistAll(entries: ConfigEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.persist(entry);
    }
  }

  async getAll(): Promise<ConfigEntry[]> {
    const { rows } = await this.pool.query(
      'SELECT key, value, layer, plugin_namespace, user_id FROM config_entries',
    );
    return rows.map((row) => ({
      key: row.key,
      value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
      layer: row.layer as ConfigLayer,
      pluginNamespace: row.plugin_namespace || undefined,
      userId: row.user_id || undefined,
    }));
  }
}
