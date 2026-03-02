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

  it('logs plugin install', async () => {
    const id = await logger.logPluginInstall('admin-1', 'my-plugin', { version: '1.0.0' });
    expect(id).toBeGreaterThan(0);

    const events = await logger.query();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('plugin.install');
    expect(events[0].target).toBe('plugin:my-plugin');
    expect(events[0].details).toEqual({ version: '1.0.0' });
  });

  it('logs plugin uninstall', async () => {
    await logger.logPluginUninstall('admin-1', 'my-plugin');
    const events = await logger.query();
    expect(events[0].action).toBe('plugin.uninstall');
  });

  it('logs plugin enable', async () => {
    await logger.logPluginEnable('admin-1', 'my-plugin');
    const events = await logger.query();
    expect(events[0].action).toBe('plugin.enable');
  });

  it('logs plugin disable', async () => {
    await logger.logPluginDisable('admin-1', 'my-plugin');
    const events = await logger.query();
    expect(events[0].action).toBe('plugin.disable');
  });

  it('logs config change', async () => {
    await logger.logConfigChange('admin-1', 'llm.model', { from: 'sonnet', to: 'opus' });
    const events = await logger.query();
    expect(events[0].action).toBe('config.update');
    expect(events[0].target).toBe('config:llm.model');
  });

  it('logs failure', async () => {
    await logger.logFailure('admin-1', 'plugin.install', 'plugin:bad', 'Not found');
    const events = await logger.query();
    expect(events[0].result).toBe('failure');
    expect(events[0].details).toEqual({ error: 'Not found' });
  });

  it('filters query results', async () => {
    await logger.logPluginInstall('admin-1', 'p1');
    await logger.logPluginEnable('admin-1', 'p1');
    await logger.logPluginInstall('admin-2', 'p2');

    const byActor = await logger.query({ actor: 'admin-1' });
    expect(byActor).toHaveLength(2);

    const byAction = await logger.query({ action: 'plugin.enable' });
    expect(byAction).toHaveLength(1);
  });

  it('purges old events', async () => {
    await logger.logPluginInstall('admin', 'p1');
    db.prepare("UPDATE audit_events SET created_at = datetime('now', '-100 days')").run();
    await logger.logPluginInstall('admin', 'p2');

    const deleted = await logger.purge(90);
    expect(deleted).toBe(1);
    expect(await logger.query()).toHaveLength(1);
  });
});
