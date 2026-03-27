import { describe, it, expect, beforeEach } from 'vitest';
import { RefreshScheduler, extractAppDefinition } from './refresh-scheduler.js';
import { InMemoryDashboardStore } from './dashboard-store.js';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type { DataAdapter, TabularResult, DataSourceSchema, DataSourceConfig, QueryConstraints } from '../data-sources/types.js';
import { serializeDashboard, createDashboardDefinition } from '../widgets/dashboard-model.js';
import type { KpiWidget } from '../widgets/types.js';

class MockAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'built-in' as const;
  callCount = 0;
  constructor(id: string) { this.id = id; }
  async introspectSchema(): Promise<DataSourceSchema> {
    return { tables: [{ name: 'test', columns: [{ name: 'value', type: 'int4', nullable: false }] }] };
  }
  async execute(): Promise<TabularResult> {
    this.callCount++;
    return { columns: [{ key: 'value', label: 'value', type: 'number' }], rows: [{ value: 42 }], rowCount: 1, truncated: false };
  }
  async getSampleData(): Promise<TabularResult> { return this.execute(); }
  async close(): Promise<void> {}
}

class TestableRegistry extends DataSourceRegistry {
  registerMock(id: string, adapter: MockAdapter): void {
    const config: DataSourceConfig = {
      id, name: id, type: 'sql',
      config: { type: 'sql', dialect: 'postgresql', connectionString: '' },
      constraints: { maxRows: 1000, timeoutMs: 5000 },
    };
    (this as any).adapters.set(id, adapter);
    (this as any).configs.set(id, config);
  }
}

describe('RefreshScheduler', () => {
  let store: InMemoryDashboardStore;
  let registry: TestableRegistry;
  let adapter: MockAdapter;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
    registry = new TestableRegistry();
    adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);
  });

  it('refreshes dashboards that are due', async () => {
    const kpi: KpiWidget = {
      id: 'k1', type: 'kpi', title: 'KPI',
      query: { dataSourceId: 'ds1', sql: 'SELECT value FROM test' },
      valueField: 'value',
      size: { col: 1, row: 1, width: 3, height: 1 },
    };
    const def = createDashboardDefinition('Test', [kpi], ['ds1']);
    const d = await store.create({
      title: 'Test', ownerId: 'u1', teamId: 't1',
      definition: serializeDashboard(def),
      refreshInterval: 1, // 1 second
    });

    const scheduler = new RefreshScheduler({ store, registry });
    const count = await scheduler.tick();

    expect(count).toBe(1);
    expect(adapter.callCount).toBe(1);

    const updated = await store.get(d.id);
    expect(updated!.lastRefreshedAt).toBeTruthy();
    expect(updated!.cachedResults).toBeTruthy();
    const cached = JSON.parse(updated!.cachedResults!);
    expect(cached).toHaveLength(1);
    expect(cached[0].widgetId).toBe('k1');
  });

  it('skips dashboards not due for refresh', async () => {
    const kpi: KpiWidget = {
      id: 'k1', type: 'kpi', title: 'KPI',
      query: { dataSourceId: 'ds1', sql: 'SELECT value FROM test' },
      valueField: 'value',
      size: { col: 1, row: 1, width: 3, height: 1 },
    };
    const def = createDashboardDefinition('Test', [kpi], ['ds1']);
    const d = await store.create({
      title: 'Test', ownerId: 'u1', teamId: 't1',
      definition: serializeDashboard(def),
      refreshInterval: 3600,
    });
    await store.update(d.id, { lastRefreshedAt: new Date().toISOString() });

    const scheduler = new RefreshScheduler({ store, registry });
    const count = await scheduler.tick();

    expect(count).toBe(0);
    expect(adapter.callCount).toBe(0);
  });

  it('handles individual widget errors gracefully', async () => {
    const errorAdapter = new MockAdapter('ds-err');
    errorAdapter.execute = async () => { throw new Error('connection lost'); };
    registry.registerMock('ds-err', errorAdapter);

    const kpi: KpiWidget = {
      id: 'k1', type: 'kpi', title: 'KPI',
      query: { dataSourceId: 'ds-err', sql: 'SELECT 1' },
      valueField: 'value',
      size: { col: 1, row: 1, width: 3, height: 1 },
    };
    const def = createDashboardDefinition('Test', [kpi], ['ds-err']);
    await store.create({
      title: 'Test', ownerId: 'u1', teamId: 't1',
      definition: serializeDashboard(def),
      refreshInterval: 1,
    });

    const errors: string[] = [];
    const scheduler = new RefreshScheduler({
      store, registry,
      onError: (id, err) => errors.push(`${id}: ${err.message}`),
    });
    const count = await scheduler.tick();

    // Still counts as refreshed (the dashboard itself was processed)
    expect(count).toBe(1);
  });

  it('start and stop manage the interval', () => {
    const scheduler = new RefreshScheduler({ store, registry, pollIntervalMs: 10000 });
    scheduler.start();
    scheduler.start(); // Idempotent
    scheduler.stop();
    scheduler.stop(); // Idempotent
  });

  it('refreshes app-mode dashboards (HTML bundles)', async () => {
    // Generate an app-mode dashboard
    const { generateApp } = await import('../app/generator.js');
    const { DEFAULT_APP_LAYOUT } = await import('../app/types.js');
    const appDef = {
      title: 'App Test',
      theme: 'light' as const,
      widgets: [{
        id: 'kpi-1', type: 'kpi' as const, title: 'Revenue',
        query: { dataSourceId: 'ds1', sql: 'SELECT value FROM test' },
        valueField: 'value', format: 'currency' as const,
        size: { col: 1, row: 1, width: 3, height: 2 },
      }],
      layout: DEFAULT_APP_LAYOUT,
      controls: [{ type: 'theme-toggle' as const }],
    };
    const app = generateApp(appDef, new Map([['kpi-1', [{ value: 100 }]]]));

    // Store as app-mode (HTML definition)
    const d = await store.create({
      title: 'App Test', ownerId: 'u1', teamId: 't1',
      definition: app.html,
      refreshInterval: 1,
    });

    const scheduler = new RefreshScheduler({ store, registry });
    const count = await scheduler.tick();

    expect(count).toBe(1);
    expect(adapter.callCount).toBe(1);

    // Updated definition should still be HTML
    const updated = await store.get(d.id);
    expect(updated!.definition).toContain('<!DOCTYPE html>');
    expect(updated!.lastRefreshedAt).toBeTruthy();
  });
});

describe('extractAppDefinition', () => {
  it('extracts definition from generated HTML', async () => {
    const { generateApp } = await import('../app/generator.js');
    const { DEFAULT_APP_LAYOUT } = await import('../app/types.js');
    const appDef = {
      title: 'Extract Test',
      theme: 'light' as const,
      widgets: [{
        id: 'kpi-1', type: 'kpi' as const, title: 'Revenue',
        query: { dataSourceId: 'ds1', sql: 'SELECT 1' },
        valueField: 'value',
        size: { col: 1, row: 1, width: 3, height: 2 },
      }],
      layout: DEFAULT_APP_LAYOUT,
    };
    const app = generateApp(appDef, new Map([['kpi-1', [{ value: 42 }]]]));
    const extracted = extractAppDefinition(app.html);

    expect(extracted).not.toBeNull();
    expect(extracted!.title).toBe('Extract Test');
    expect(extracted!.widgets).toHaveLength(1);
    expect(extracted!.widgets[0].id).toBe('kpi-1');
  });

  it('returns null for non-app HTML', () => {
    expect(extractAppDefinition('<html><body>plain</body></html>')).toBeNull();
  });

  it('returns null for invalid JSON in script tag', () => {
    const html = '<script type="application/json" id="__APP_DEFINITION__">not json</script>';
    expect(extractAppDefinition(html)).toBeNull();
  });
});
