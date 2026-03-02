import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, SqliteAuditEventStore, SqliteUsageEventStore } from '@nexora-kit/storage';
import { AuditLogger } from './audit-logger.js';
import { UsageAnalytics } from './usage-analytics.js';
import { AdminService } from './admin-service.js';

function makeMockPlugin(namespace: string, state = 'installed') {
  return {
    manifest: { name: namespace, version: '1.0.0', namespace, permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
    state,
    tools: [],
  };
}

function makeMockPluginManager(plugins: any[] = []) {
  return {
    install: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    uninstall: vi.fn(),
    getPlugin: vi.fn((ns: string) => plugins.find((p) => p.manifest.namespace === ns)),
    listPlugins: vi.fn(() => plugins),
    reload: vi.fn(),
  } as any;
}

describe('AdminService', () => {
  let db: Database.Database;
  let service: AdminService;
  let pluginManager: ReturnType<typeof makeMockPluginManager>;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);

    pluginManager = makeMockPluginManager([
      makeMockPlugin('test-plugin'),
    ]);

    service = new AdminService({
      plugins: pluginManager,
      auditLogger: new AuditLogger(new SqliteAuditEventStore(db)),
      usageAnalytics: new UsageAnalytics(new SqliteUsageEventStore(db)),
    });
  });

  afterEach(() => {
    db.close();
  });

  it('enables a plugin and logs audit event', async () => {
    service.enablePlugin('admin-1', 'test-plugin');

    expect(pluginManager.enable).toHaveBeenCalledWith('test-plugin');

    const events = await service.auditLogger.query();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('plugin.enable');
    expect(events[0].actor).toBe('admin-1');
  });

  it('disables a plugin and logs audit event', async () => {
    service.disablePlugin('admin-1', 'test-plugin');

    expect(pluginManager.disable).toHaveBeenCalledWith('test-plugin');

    const events = await service.auditLogger.query();
    expect(events[0].action).toBe('plugin.disable');
  });

  it('uninstalls a plugin and logs audit event', async () => {
    service.uninstallPlugin('admin-1', 'test-plugin');

    expect(pluginManager.uninstall).toHaveBeenCalledWith('test-plugin');

    const events = await service.auditLogger.query();
    expect(events[0].action).toBe('plugin.uninstall');
  });

  it('logs failure when enabling non-existent plugin', async () => {
    expect(() => service.enablePlugin('admin-1', 'nope')).toThrow('Plugin not found');

    const events = await service.auditLogger.query();
    expect(events[0].result).toBe('failure');
  });

  it('logs failure when disabling non-existent plugin', () => {
    expect(() => service.disablePlugin('admin-1', 'nope')).toThrow('Plugin not found');
  });

  it('logs failure when uninstalling non-existent plugin', () => {
    expect(() => service.uninstallPlugin('admin-1', 'nope')).toThrow('Plugin not found');
  });

  it('logs failure when enable throws', async () => {
    pluginManager.enable.mockImplementation(() => { throw new Error('Already enabled'); });

    expect(() => service.enablePlugin('admin-1', 'test-plugin')).toThrow('Already enabled');

    const events = await service.auditLogger.query();
    expect(events[0].result).toBe('failure');
    expect(events[0].details).toEqual({ error: 'Already enabled' });
  });

  it('returns usage summary', async () => {
    const store = new SqliteUsageEventStore(db);
    store.insert({ pluginName: 'test-plugin', inputTokens: 100, outputTokens: 50 });

    const summaries = await service.getUsageSummary();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalTokens).toBe(150);
  });

  it('purges old audit events', async () => {
    service.enablePlugin('admin-1', 'test-plugin');
    db.prepare("UPDATE audit_events SET created_at = datetime('now', '-100 days')").run();
    service.disablePlugin('admin-1', 'test-plugin');

    const purged = await service.purgeAuditLog();
    expect(purged).toBe(1);
  });
});
