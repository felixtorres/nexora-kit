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

    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('config_entries');
    expect(names).toContain('plugin_states');
    expect(names).toContain('token_usage');
    expect(names).toContain('usage_events');
    expect(names).toContain('audit_events');
    expect(names).toContain('bots');
    expect(names).toContain('agents');
    expect(names).toContain('agent_bot_bindings');
    expect(names).toContain('end_users');
    expect(names).toContain('artifacts');
    expect(names).toContain('artifact_versions');
    expect(names).toContain('conversation_templates');
    expect(names).toContain('workspaces');
    expect(names).toContain('context_documents');
    expect(names).toContain('feedback');
    expect(names).toContain('user_memory');
    expect(names).toContain('files');
  });

  it('is idempotent', () => {
    initSchema(db);
    initSchema(db); // second call should not throw

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(17);
  });

  it('enforces messages primary key', () => {
    initSchema(db);

    db.prepare('INSERT INTO messages (conversation_id, role, content, seq) VALUES (?, ?, ?, ?)')
      .run('c1', 'user', '"hello"', 1);

    expect(() => {
      db.prepare('INSERT INTO messages (conversation_id, role, content, seq) VALUES (?, ?, ?, ?)')
        .run('c1', 'user', '"world"', 1);
    }).toThrow();
  });
});
