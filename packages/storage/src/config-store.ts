import type { ConfigResolver, ConfigEntry, ConfigLayer } from '@nexora-kit/config';
import type Database from 'better-sqlite3';
import type { IConfigStore } from './interfaces.js';

export class SqliteConfigStore implements IConfigStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  loadInto(resolver: ConfigResolver): void {
    const rows = this.db
      .prepare('SELECT key, value, layer, plugin_namespace, user_id FROM config_entries')
      .all() as {
        key: string;
        value: string;
        layer: number;
        plugin_namespace: string | null;
        user_id: string | null;
      }[];

    for (const row of rows) {
      resolver.set(row.key, JSON.parse(row.value), row.layer as ConfigLayer, {
        pluginNamespace: row.plugin_namespace || undefined,
        userId: row.user_id || undefined,
      });
    }
  }

  persist(entry: ConfigEntry): void {
    this.db
      .prepare(
        `INSERT INTO config_entries (key, value, layer, plugin_namespace, user_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key, layer, plugin_namespace, user_id)
         DO UPDATE SET value = excluded.value`,
      )
      .run(
        entry.key,
        JSON.stringify(entry.value),
        entry.layer,
        entry.pluginNamespace ?? '',
        entry.userId ?? '',
      );
  }

  persistAll(entries: ConfigEntry[]): void {
    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        this.persist(entry);
      }
    });
    transaction();
  }

  getAll(): ConfigEntry[] {
    const rows = this.db
      .prepare('SELECT key, value, layer, plugin_namespace, user_id FROM config_entries')
      .all() as {
        key: string;
        value: string;
        layer: number;
        plugin_namespace: string | null;
        user_id: string | null;
      }[];

    return rows.map((row) => ({
      key: row.key,
      value: JSON.parse(row.value),
      layer: row.layer as ConfigLayer,
      pluginNamespace: row.plugin_namespace || undefined,
      userId: row.user_id || undefined,
    }));
  }
}
