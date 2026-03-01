import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConfigResolver, ConfigLayer } from '@nexora-kit/config';
import { initSchema } from './schema.js';
import { SqliteConfigStore } from './config-store.js';

describe('SqliteConfigStore', () => {
  let db: Database.Database;
  let configStore: SqliteConfigStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    configStore = new SqliteConfigStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists and loads a single entry into resolver', () => {
    configStore.persist({
      key: 'theme',
      value: 'dark',
      layer: ConfigLayer.InstanceDefaults,
    });

    const resolver = new ConfigResolver();
    configStore.loadInto(resolver);

    expect(resolver.get('theme', {})).toBe('dark');
  });

  it('persists entry with plugin namespace', () => {
    configStore.persist({
      key: 'max-tokens',
      value: 1000,
      layer: ConfigLayer.PluginDefaults,
      pluginNamespace: 'my-plugin',
    });

    const resolver = new ConfigResolver();
    configStore.loadInto(resolver);

    expect(resolver.get('max-tokens', { pluginNamespace: 'my-plugin' })).toBe(1000);
  });

  it('upserts on conflict', () => {
    configStore.persist({
      key: 'theme',
      value: 'light',
      layer: ConfigLayer.InstanceDefaults,
    });
    configStore.persist({
      key: 'theme',
      value: 'dark',
      layer: ConfigLayer.InstanceDefaults,
    });

    const entries = configStore.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('dark');
  });

  it('persistAll writes multiple entries in a transaction', () => {
    configStore.persistAll([
      { key: 'a', value: 1, layer: ConfigLayer.InstanceDefaults },
      { key: 'b', value: 2, layer: ConfigLayer.InstanceDefaults },
      { key: 'c', value: 3, layer: ConfigLayer.UserPreferences, userId: 'u1' },
    ]);

    const entries = configStore.getAll();
    expect(entries).toHaveLength(3);
  });

  it('round-trips complex values (objects, arrays)', () => {
    configStore.persist({
      key: 'models',
      value: { primary: 'gpt-4', fallback: ['gpt-3.5'] },
      layer: ConfigLayer.InstanceDefaults,
    });

    const entries = configStore.getAll();
    expect(entries[0].value).toEqual({ primary: 'gpt-4', fallback: ['gpt-3.5'] });
  });
});
