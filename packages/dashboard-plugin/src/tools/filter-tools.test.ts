import { describe, it, expect, vi } from 'vitest';
import { createApplyFilterHandler } from './apply-filter.js';
import { createCrossFilterHandler } from './cross-filter.js';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type { DataAdapter, DataSourceSchema, TabularResult, DataSourceConfig, QueryConstraints } from '../data-sources/types.js';
import { serializeDashboard, createDashboardDefinition } from '../widgets/dashboard-model.js';
import type { ChartWidget, KpiWidget, FilterWidget, DashboardWidget } from '../widgets/types.js';

const defaultConstraints: QueryConstraints = { maxRows: 1000, timeoutMs: 5000 };

class MockAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'built-in' as const;
  executeCalls: { query: string; params?: Record<string, unknown> }[] = [];

  constructor(id: string) { this.id = id; }

  async introspectSchema(): Promise<DataSourceSchema> {
    return { tables: [{ name: 'test', columns: [{ name: 'id', type: 'int4', nullable: false }] }] };
  }

  async execute(query: string, params?: Record<string, unknown>): Promise<TabularResult> {
    this.executeCalls.push({ query, params });
    return {
      columns: [{ key: 'id', label: 'id', type: 'number' }, { key: 'value', label: 'value', type: 'number' }],
      rows: [{ id: 1, value: 100 }],
      rowCount: 1,
      truncated: false,
    };
  }

  async getSampleData(): Promise<TabularResult> {
    return this.execute('SELECT 1');
  }

  async close(): Promise<void> {}
}

// TestableRegistry that accepts mock adapters
class TestableRegistry extends DataSourceRegistry {
  registerMock(id: string, adapter: MockAdapter, config?: Partial<DataSourceConfig>): void {
    const fullConfig: DataSourceConfig = {
      id,
      name: id,
      type: 'sql',
      config: { type: 'sql', dialect: 'postgresql', connectionString: '' },
      constraints: defaultConstraints,
      ...config,
    };
    (this as any).adapters.set(id, adapter);
    (this as any).configs.set(id, fullConfig);
  }
}

function makeChartWidget(id: string, dsId: string): ChartWidget {
  return {
    id, type: 'chart', title: `Chart ${id}`,
    spec: { engine: 'vega-lite', config: { mark: 'bar', encoding: { x: { field: 'id' }, y: { field: 'value' } } } },
    query: { dataSourceId: dsId, sql: 'SELECT id, value FROM test' },
    size: { col: 1, row: 1, width: 6, height: 2 },
  };
}

function makeKpiWidget(id: string, dsId: string): KpiWidget {
  return {
    id, type: 'kpi', title: `KPI ${id}`,
    query: { dataSourceId: dsId, sql: 'SELECT value FROM test' },
    valueField: 'value',
    size: { col: 7, row: 1, width: 3, height: 1 },
  };
}

function makeFilterWidget(id: string, targets: string[]): FilterWidget {
  return {
    id, type: 'filter',
    targetWidgets: targets,
    fields: [{ name: 'region', label: 'Region', type: 'select', dataSourceId: 'ds1' }],
    size: { col: 1, row: 3, width: 12, height: 1 },
  };
}

describe('dashboard_apply_filter', () => {
  it('re-executes affected widgets with filter params', async () => {
    const registry = new TestableRegistry();
    const adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);

    const chart = makeChartWidget('c1', 'ds1');
    const kpi = makeKpiWidget('k1', 'ds1');
    const filter = makeFilterWidget('f1', ['c1', 'k1']);
    const def = createDashboardDefinition('Test', [chart, kpi, filter], ['ds1']);

    const handler = createApplyFilterHandler(registry);
    const result = await handler({
      dashboardId: 'dash-1',
      definition: serializeDashboard(def),
      filterId: 'f1',
      field: 'region',
      value: 'EMEA',
    });

    expect(typeof result).toBe('object');
    const resp = result as any;
    expect(resp.content).toContain('region');
    expect(resp.blocks).toHaveLength(2); // chart + kpi
    expect(resp.artifacts).toHaveLength(1);
    expect(resp.artifacts[0].type).toBe('update');
    // Both widgets should have been executed with filter params
    expect(adapter.executeCalls.length).toBe(2);
  });

  it('returns error for unknown filter ID', async () => {
    const registry = new TestableRegistry();
    const adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);

    const chart = makeChartWidget('c1', 'ds1');
    const def = createDashboardDefinition('Test', [chart], ['ds1']);

    const handler = createApplyFilterHandler(registry);
    const result = await handler({
      dashboardId: 'dash-1',
      definition: serializeDashboard(def),
      filterId: 'nonexistent',
      field: 'region',
      value: 'EMEA',
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('not found');
  });

  it('returns error for missing params', async () => {
    const handler = createApplyFilterHandler(new TestableRegistry());
    const result = await handler({});
    expect(typeof result).toBe('string');
    expect(result as string).toContain('required');
  });
});

describe('dashboard_cross_filter', () => {
  it('applies selection to all widgets except source', async () => {
    const registry = new TestableRegistry();
    const adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);

    const c1 = makeChartWidget('c1', 'ds1');
    const c2 = makeChartWidget('c2', 'ds1');
    const k1 = makeKpiWidget('k1', 'ds1');
    const def = createDashboardDefinition('Test', [c1, c2, k1], ['ds1']);

    const handler = createCrossFilterHandler(registry);
    const result = await handler({
      dashboardId: 'dash-1',
      definition: serializeDashboard(def),
      sourceWidgetId: 'c1',
      selection: JSON.stringify({ region: 'EMEA' }),
    });

    expect(typeof result).toBe('object');
    const resp = result as any;
    expect(resp.blocks).toHaveLength(2); // c2 + k1 (not c1)
    expect(resp.content).toContain('region');
    // c2 and k1 should have been re-executed
    expect(adapter.executeCalls.length).toBe(2);
  });

  it('applies selection to specified targets only', async () => {
    const registry = new TestableRegistry();
    const adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);

    const c1 = makeChartWidget('c1', 'ds1');
    const c2 = makeChartWidget('c2', 'ds1');
    const k1 = makeKpiWidget('k1', 'ds1');
    const def = createDashboardDefinition('Test', [c1, c2, k1], ['ds1']);

    const handler = createCrossFilterHandler(registry);
    const result = await handler({
      dashboardId: 'dash-1',
      definition: serializeDashboard(def),
      sourceWidgetId: 'c1',
      selection: JSON.stringify({ region: 'APAC' }),
      targetWidgetIds: JSON.stringify(['k1']),
    });

    expect(typeof result).toBe('object');
    const resp = result as any;
    expect(resp.blocks).toHaveLength(1); // only k1
    expect(adapter.executeCalls.length).toBe(1);
  });

  it('returns error for missing params', async () => {
    const handler = createCrossFilterHandler(new TestableRegistry());
    const result = await handler({});
    expect(typeof result).toBe('string');
    expect(result as string).toContain('required');
  });

  it('returns error for invalid selection JSON', async () => {
    const registry = new TestableRegistry();
    const adapter = new MockAdapter('ds1');
    registry.registerMock('ds1', adapter);

    const c1 = makeChartWidget('c1', 'ds1');
    const def = createDashboardDefinition('Test', [c1], ['ds1']);
    const handler = createCrossFilterHandler(registry);
    const result = await handler({
      dashboardId: 'dash-1',
      definition: serializeDashboard(def),
      sourceWidgetId: 'c1',
      selection: 'not valid json{',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('JSON');
  });
});
