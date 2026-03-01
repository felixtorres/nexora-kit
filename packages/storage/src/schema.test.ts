import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';

describe('initSchema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all required tables', () => {
    initSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('messages');
    expect(names).toContain('sessions');
    expect(names).toContain('config_entries');
    expect(names).toContain('plugin_states');
    expect(names).toContain('token_usage');
    expect(names).toContain('usage_events');
  });

  it('is idempotent', () => {
    initSchema(db);
    initSchema(db); // second call should not throw

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(6);
  });

  it('enforces messages primary key', () => {
    initSchema(db);

    db.prepare('INSERT INTO messages (session_id, role, content, seq) VALUES (?, ?, ?, ?)')
      .run('s1', 'user', '"hello"', 1);

    expect(() => {
      db.prepare('INSERT INTO messages (session_id, role, content, seq) VALUES (?, ?, ?, ?)')
        .run('s1', 'user', '"world"', 1);
    }).toThrow();
  });
});
