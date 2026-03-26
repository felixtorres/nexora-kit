import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import type { ToolHandlerResponse } from '@nexora-kit/core';
import { createDashboardCreateHandler } from './create-dashboard.js';
import { createDashboardUpdateHandler } from './update-dashboard.js';
import { createDashboardRefreshHandler } from './refresh-dashboard.js';
import { serializeDashboard, createDashboardDefinition } from '../widgets/dashboard-model.js';
import type { KpiWidget, TableWidget, ChartWidget } from '../widgets/types.js';

// --- Mock Adapter ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'int4', nullable: false, isPrimaryKey: true },
        { name: 'total', type: 'numeric', nullable: false },
        { name: 'status', type: 'text', nullable: false },
      ],
      rowCountEstimate: 1200,
    },
  ],
  dialect: 'postgresql',
};

const MOCK_KPI_RESULT: TabularResult = {
  columns: [
    { key: 'revenue', label: 'revenue', type: 'number' },
  ],
  rows: [{ revenue: 42500 }],
  rowCount: 1,
  truncated: false,
};

const MOCK_TABLE_RESULT: TabularResult = {
  columns: [
    { key: 'status', label: 'status', type: 'string' },
    { key: 'count', label: 'count', type: 'number' },
  ],
  rows: [
    { status: 'shipped', count: 320 },
    { status: 'pending', count: 88 },
  ],
  rowCount: 2,
  truncated: false,
};

const MOCK_CHART_RESULT: TabularResult = {
  columns: [
    { key: 'month', label: 'month', type: 'string' },
    { key: 'sales', label: 'sales', type: 'number' },
  ],
  rows: [
    { month: 'Jan', sales: 100 },
    { month: 'Feb', sales: 150 },
  ],
  rowCount: 2,
  truncated: false,
};

function createMockAdapter(id: string): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockImplementation(async (query: string) => {
      if (query.includes('revenue') || query.includes('SUM')) {
        return MOCK_KPI_RESULT;
      }
      if (query.includes('month')) {
        return MOCK_CHART_RESULT;
      }
      return MOCK_TABLE_RESULT;
    }),
    getSampleData: vi.fn().mockResolvedValue(MOCK_TABLE_RESULT),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const DS_CONFIG: DataSourceConfig = {
  id: 'test-db',
  name: 'Test Database',
  type: 'sql',
  config: {
    type: 'sql',
    dialect: 'postgresql',
    connectionString: 'postgresql://test:test@localhost:5432/test',
  },
  constraints: { maxRows: 10_000, timeoutMs: 30_000 },
};

class TestableRegistry extends DataSourceRegistry {
  async registerWithAdapter(config: DataSourceConfig, adapter: DataAdapter): Promise<void> {
    if (this.has(config.id)) {
      throw new Error(`Data source '${config.id}' is already registered`);
    }
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

// --- Test Fixtures ---

function makeKpiWidget(id = 'kpi-1'): KpiWidget {
  return {
    id,
    type: 'kpi',
    title: 'Total Revenue',
    query: { dataSourceId: 'test-db', sql: 'SELECT SUM(total) as revenue FROM orders' },
    valueField: 'revenue',
    format: 'currency',
    size: { col: 0, row: 0, width: 3, height: 2 },
  };
}

function makeTableWidget(id = 'table-1'): TableWidget {
  return {
    id,
    type: 'table',
    title: 'Order Status',
    query: { dataSourceId: 'test-db', sql: 'SELECT status, count(*) as count FROM orders GROUP BY status' },
    columns: [
      { key: 'status', label: 'Status' },
      { key: 'count', label: 'Count' },
    ],
    size: { col: 3, row: 0, width: 6, height: 4 },
  };
}

function makeChartWidget(id = 'chart-1'): ChartWidget {
  return {
    id,
    type: 'chart',
    title: 'Monthly Sales',
    spec: {
      engine: 'vega-lite',
      config: {
        mark: 'bar',
        encoding: {
          x: { field: 'month', type: 'nominal' },
          y: { field: 'sales', type: 'quantitative' },
        },
      },
    },
    query: { dataSourceId: 'test-db', sql: 'SELECT month, sales FROM monthly_sales' },
    size: { col: 0, row: 2, width: 12, height: 4 },
  };
}

// --- Tests ---

describe('dashboard_create handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createDashboardCreateHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createDashboardCreateHandler(registry);
  });

  it('creates a dashboard with kpi and table widgets', async () => {
    const widgets = [makeKpiWidget(), makeTableWidget()];

    const result = await handler({
      title: 'Sales Overview',
      widgets: JSON.stringify(widgets),
    });

    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain("Dashboard 'Sales Overview' created with 2 widgets");

    // Artifact
    expect(response.artifacts).toHaveLength(1);
    expect(response.artifacts![0].type).toBe('create');
    expect(response.artifacts![0].title).toBe('Sales Overview');
    expect(response.artifacts![0].artifactType).toBe('data');
    expect(response.artifacts![0].artifactId).toBeTruthy();
    const artifactContent = JSON.parse(response.artifacts![0].content!);
    expect(artifactContent.title).toBe('Sales Overview');
    expect(artifactContent.widgets).toHaveLength(2);

    // Grid block
    expect(response.blocks).toHaveLength(1);
    expect(response.blocks![0]).toMatchObject({ type: 'custom:dashboard/grid' });
    const gridData = (response.blocks![0] as any).data;
    expect(gridData.widgets).toHaveLength(2);
    expect(gridData.widgets[0].type).toBe('kpi');
    expect(gridData.widgets[1].type).toBe('table');
  });

  it('creates a dashboard with a chart widget', async () => {
    const widgets = [makeChartWidget()];

    const result = await handler({
      title: 'Chart Dashboard',
      widgets: JSON.stringify(widgets),
    });

    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('1 widget');
    expect(response.blocks).toHaveLength(1);
    const gridData = (response.blocks![0] as any).data;
    expect(gridData.widgets[0].type).toBe('chart');
    expect(gridData.widgets[0].rendered.data).toHaveLength(2);
  });

  it('returns error for missing title', async () => {
    const result = await handler({ widgets: '[]' });
    expect(result).toBe('Error: title is required');
  });

  it('returns error for missing widgets', async () => {
    const result = await handler({ title: 'Foo' });
    expect(result).toBe('Error: widgets JSON is required');
  });

  it('returns error for invalid widgets JSON', async () => {
    const result = await handler({ title: 'Foo', widgets: '{bad json' });
    expect(result).toBe('Error: widgets must be valid JSON');
  });

  it('returns error for empty widgets array', async () => {
    const result = await handler({ title: 'Foo', widgets: '[]' });
    expect(result).toBe('Error: at least one widget is required');
  });

  it('returns error for widget with invalid type', async () => {
    const result = await handler({
      title: 'Foo',
      widgets: JSON.stringify([{ id: 'w1', type: 'sparkline', size: { col: 0, row: 0, width: 3, height: 2 } }]),
    });
    expect(result).toContain("invalid widget type 'sparkline'");
  });

  it('returns error for chart with invalid Vega-Lite spec', async () => {
    const badChart = makeChartWidget();
    badChart.spec.config = { mark: 'invalid_mark_type' };

    const result = await handler({
      title: 'Foo',
      widgets: JSON.stringify([badChart]),
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('invalid spec');
  });

  it('handles query execution failure', async () => {
    const failAdapter = createMockAdapter('test-db');
    (failAdapter.execute as any).mockRejectedValue(new Error('connection lost'));

    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(DS_CONFIG, failAdapter);
    const failHandler = createDashboardCreateHandler(failRegistry);

    const result = await failHandler({
      title: 'Fail Dashboard',
      widgets: JSON.stringify([makeKpiWidget()]),
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Dashboard creation failed');
    expect(result as string).toContain('connection lost');
  });

  it('includes dataSourceId in definition when provided', async () => {
    const result = await handler({
      title: 'With Source',
      widgets: JSON.stringify([makeKpiWidget()]),
      dataSourceId: 'test-db',
    });

    const response = result as ToolHandlerResponse;
    const def = JSON.parse(response.artifacts![0].content!);
    expect(def.dataSources).toContain('test-db');
  });
});

describe('dashboard_update handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createDashboardUpdateHandler>;
  let baseDef: string;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createDashboardUpdateHandler(registry);

    const def = createDashboardDefinition(
      'Sales Overview',
      [makeKpiWidget(), makeTableWidget()],
      ['test-db'],
    );
    baseDef = serializeDashboard(def);
  });

  it('adds a new widget', async () => {
    const newChart = makeChartWidget('chart-new');

    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      addWidgets: JSON.stringify([newChart]),
    });

    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('3 widgets total');
    expect(response.artifacts![0].type).toBe('update');
    expect(response.artifacts![0].artifactId).toBe('dash-123');
    const updatedDef = JSON.parse(response.artifacts![0].content!);
    expect(updatedDef.widgets).toHaveLength(3);
    expect(updatedDef.widgets[2].id).toBe('chart-new');

    // Only the new widget should be rendered
    const gridData = (response.blocks![0] as any).data;
    expect(gridData.widgets).toHaveLength(1);
    expect(gridData.widgets[0].widgetId).toBe('chart-new');
  });

  it('removes a widget', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      removeWidgetIds: JSON.stringify(['kpi-1']),
    });

    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('1 widget total');
    const updatedDef = JSON.parse(response.artifacts![0].content!);
    expect(updatedDef.widgets).toHaveLength(1);
    expect(updatedDef.widgets[0].id).toBe('table-1');
  });

  it('updates an existing widget', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      updateWidgets: JSON.stringify([{ id: 'kpi-1', title: 'Updated Revenue' }]),
    });

    const response = result as ToolHandlerResponse;
    const updatedDef = JSON.parse(response.artifacts![0].content!);
    const updatedKpi = updatedDef.widgets.find((w: any) => w.id === 'kpi-1');
    expect(updatedKpi.title).toBe('Updated Revenue');

    // Updated widget should be re-executed
    const gridData = (response.blocks![0] as any).data;
    expect(gridData.widgets).toHaveLength(1);
    expect(gridData.widgets[0].widgetId).toBe('kpi-1');
  });

  it('returns error for missing dashboardId', async () => {
    const result = await handler({ definition: baseDef });
    expect(result).toBe('Error: dashboardId is required');
  });

  it('returns error for missing definition', async () => {
    const result = await handler({ dashboardId: 'dash-123' });
    expect(result).toBe('Error: definition is required');
  });

  it('returns error for invalid definition JSON', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: '{bad json',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error parsing dashboard definition');
  });

  it('returns error when updating a non-existent widget', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      updateWidgets: JSON.stringify([{ id: 'does-not-exist', title: 'Nope' }]),
    });
    expect(result).toContain("widget 'does-not-exist' not found");
  });

  it('returns error when adding a widget with duplicate ID', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      addWidgets: JSON.stringify([makeKpiWidget('kpi-1')]),
    });
    expect(result).toContain("widget ID 'kpi-1' already exists");
  });

  it('returns no blocks when only removing widgets', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
      removeWidgetIds: JSON.stringify(['table-1']),
    });

    const response = result as ToolHandlerResponse;
    expect(response.blocks).toBeUndefined();
  });
});

describe('dashboard_refresh handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createDashboardRefreshHandler>;
  let baseDef: string;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createDashboardRefreshHandler(registry);

    const def = createDashboardDefinition(
      'Sales Overview',
      [makeKpiWidget(), makeTableWidget(), makeChartWidget()],
      ['test-db'],
    );
    baseDef = serializeDashboard(def);
  });

  it('re-executes all widget queries', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: baseDef,
    });

    const response = result as ToolHandlerResponse;
    expect(response.content).toContain("Dashboard 'Sales Overview' refreshed");
    expect(response.content).toContain('3 widgets re-executed');

    // Grid block with all widgets rendered
    expect(response.blocks).toHaveLength(1);
    const gridData = (response.blocks![0] as any).data;
    expect(gridData.dashboardId).toBe('dash-123');
    expect(gridData.widgets).toHaveLength(3);

    const types = gridData.widgets.map((w: any) => w.type);
    expect(types).toContain('kpi');
    expect(types).toContain('table');
    expect(types).toContain('chart');
  });

  it('returns error for missing dashboardId', async () => {
    const result = await handler({ definition: baseDef });
    expect(result).toBe('Error: dashboardId is required');
  });

  it('returns error for missing definition', async () => {
    const result = await handler({ dashboardId: 'dash-123' });
    expect(result).toBe('Error: definition is required');
  });

  it('returns error for invalid definition', async () => {
    const result = await handler({
      dashboardId: 'dash-123',
      definition: 'not json',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error parsing dashboard definition');
  });

  it('handles query failure during refresh', async () => {
    const failAdapter = createMockAdapter('test-db');
    (failAdapter.execute as any).mockRejectedValue(new Error('timeout'));

    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(DS_CONFIG, failAdapter);
    const failHandler = createDashboardRefreshHandler(failRegistry);

    const result = await failHandler({
      dashboardId: 'dash-123',
      definition: baseDef,
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Dashboard refresh failed');
    expect(result as string).toContain('timeout');
  });

  it('calls registry.execute for each queryable widget', async () => {
    const adapter = createMockAdapter('test-db');
    const trackRegistry = new TestableRegistry();
    await trackRegistry.registerWithAdapter(DS_CONFIG, adapter);
    const trackHandler = createDashboardRefreshHandler(trackRegistry);

    await trackHandler({
      dashboardId: 'dash-123',
      definition: baseDef,
    });

    // 3 widgets with queries: kpi, table, chart
    expect(adapter.execute).toHaveBeenCalledTimes(3);
  });
});
