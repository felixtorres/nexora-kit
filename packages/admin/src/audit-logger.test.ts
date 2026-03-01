import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, SqliteAuditEventStore } from '@nexora-kit/storage';
import { AuditLogger } from './audit-logger.js';

describe('AuditLogger', () => {
  let db: Database.Database;
  let logger: AuditLogger;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    logger = new AuditLogger(new SqliteAuditEventStore(db));
  });

  afterEach(() => {
    db.close();
  });

  it('logs plugin install', () => {
    const id = logger.logPluginInstall('admin-1', 'my-plugin', { version: '1.0.0' });
    expect(id).toBeGreaterThan(0);

    const events = logger.query();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('plugin.install');
    expect(events[0].target).toBe('plugin:my-plugin');
    expect(events[0].details).toEqual({ version: '1.0.0' });
  });

  it('logs plugin uninstall', () => {
    logger.logPluginUninstall('admin-1', 'my-plugin');
    const events = logger.query();
    expect(events[0].action).toBe('plugin.uninstall');
  });

  it('logs plugin enable', () => {
    logger.logPluginEnable('admin-1', 'my-plugin');
    const events = logger.query();
    expect(events[0].action).toBe('plugin.enable');
  });

  it('logs plugin disable', () => {
    logger.logPluginDisable('admin-1', 'my-plugin');
    const events = logger.query();
    expect(events[0].action).toBe('plugin.disable');
  });

  it('logs config change', () => {
    logger.logConfigChange('admin-1', 'llm.model', { from: 'sonnet', to: 'opus' });
    const events = logger.query();
    expect(events[0].action).toBe('config.update');
    expect(events[0].target).toBe('config:llm.model');
  });

  it('logs failure', () => {
    logger.logFailure('admin-1', 'plugin.install', 'plugin:bad', 'Not found');
    const events = logger.query();
    expect(events[0].result).toBe('failure');
    expect(events[0].details).toEqual({ error: 'Not found' });
  });

  it('filters query results', () => {
    logger.logPluginInstall('admin-1', 'p1');
    logger.logPluginEnable('admin-1', 'p1');
    logger.logPluginInstall('admin-2', 'p2');

    const byActor = logger.query({ actor: 'admin-1' });
    expect(byActor).toHaveLength(2);

    const byAction = logger.query({ action: 'plugin.enable' });
    expect(byAction).toHaveLength(1);
  });

  it('purges old events', () => {
    logger.logPluginInstall('admin', 'p1');
    db.prepare("UPDATE audit_events SET created_at = datetime('now', '-100 days')").run();
    logger.logPluginInstall('admin', 'p2');

    const deleted = logger.purge(90);
    expect(deleted).toBe(1);
    expect(logger.query()).toHaveLength(1);
  });
});
