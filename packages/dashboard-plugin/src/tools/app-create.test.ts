import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import type { ToolHandlerResponse } from '@nexora-kit/core';
import { createAppCreateHandler } from './app-create.js';

// --- Mock setup (same pattern as handlers.test.ts) ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [{
    name: 'sales',
    columns: [
      { name: 'region', type: 'text', nullable: false },
      { name: 'revenue', type: 'numeric', nullable: false },
    ],
    rowCountEstimate: 500,
  }],
  dialect: 'postgresql',
};

const MOCK_KPI_RESULT: TabularResult = {
  columns: [
    { key: 'revenue', label: 'revenue', type: 'number' },
  ],
  rows: [{ revenue: 42000 }],
  rowCount: 1,
  truncated: false,
};

const MOCK_CHART_RESULT: TabularResult = {
  columns: [
    { key: 'region', label: 'region', type: 'string' },
    { key: 'revenue', label: 'revenue', type: 'number' },
  ],
  rows: [
    { region: 'North', revenue: 10000 },
    { region: 'South', revenue: 8000 },
  ],
  rowCount: 2,
  truncated: false,
};

const MOCK_TABLE_RESULT: TabularResult = {
  columns: [
    { key: 'id', label: 'id', type: 'number' },
    { key: 'amount', label: 'amount', type: 'number' },
  ],
  rows: [{ id: 1, amount: 500 }, { id: 2, amount: 300 }],
  rowCount: 2,
  truncated: false,
};

function createMockAdapter(id: string, result?: TabularResult): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockResolvedValue(result ?? MOCK_KPI_RESULT),
    getSampleData: vi.fn().mockResolvedValue(MOCK_KPI_RESULT),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const DS_CONFIG: DataSourceConfig = {
  id: 'test-db',
  name: 'Test Database',
  type: 'sql',
  config: { type: 'sql', dialect: 'postgresql', connectionString: 'postgresql://test:test@localhost/test' },
  constraints: { maxRows: 10_000, timeoutMs: 30_000 },
};

class TestableRegistry extends DataSourceRegistry {
  async registerWithAdapter(config: DataSourceConfig, adapter: DataAdapter): Promise<void> {
    if (this.has(config.id)) throw new Error(`Data source '${config.id}' already registered`);
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

// --- Tests ---

describe('dashboard:app_create handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createAppCreateHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createAppCreateHandler(registry);
  });

  // --- Success cases ---

  it('creates an app with a KPI widget', async () => {
    const result = await handler({
      title: 'Sales Dashboard',
      widgets: JSON.stringify([{
        id: 'kpi-1', type: 'kpi', title: 'Revenue',
        valueField: 'revenue', format: 'currency',
        query: { dataSourceId: 'test-db', sql: 'SELECT sum(revenue) as revenue FROM sales' },
        size: { col: 1, row: 1, width: 3, height: 2 },
      }]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('Sales Dashboard');
    expect(response.content).toContain('1 widgets');
    expect(response.artifacts).toHaveLength(1);
    expect(response.artifacts![0].artifactType).toBe('code');
    expect(response.artifacts![0].language).toBe('html');
    expect(response.artifacts![0].content).toContain('<!DOCTYPE html>');
    expect(response.artifacts![0].content).toContain('42,000');
  });

  it('creates an app with a chart widget', async () => {
    await registry.registerWithAdapter(
      { ...DS_CONFIG, id: 'chart-db' },
      createMockAdapter('chart-db', MOCK_CHART_RESULT),
    );
    const chartRegistry = new TestableRegistry();
    await chartRegistry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', MOCK_CHART_RESULT));
    const chartHandler = createAppCreateHandler(chartRegistry);

    const result = await chartHandler({
      title: 'Chart Test',
      widgets: JSON.stringify([{
        id: 'chart-1', type: 'chart', title: 'Revenue by Region',
        chartType: 'bar',
        config: {
          xAxis: { type: 'category' },
          yAxis: { type: 'value' },
          series: [{ type: 'bar' }],
          tooltip: { trigger: 'axis' },
        },
        query: { dataSourceId: 'test-db', sql: 'SELECT region, revenue FROM sales' },
        size: { col: 1, row: 1, width: 6, height: 3 },
      }]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('echarts.init');
  });

  it('creates an app with a table widget', async () => {
    const tableRegistry = new TestableRegistry();
    await tableRegistry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', MOCK_TABLE_RESULT));
    const tableHandler = createAppCreateHandler(tableRegistry);

    const result = await tableHandler({
      title: 'Table Test',
      widgets: JSON.stringify([{
        id: 'table-1', type: 'table', title: 'Orders',
        columns: [{ key: 'id', label: 'ID' }, { key: 'amount', label: 'Amount' }],
        query: { dataSourceId: 'test-db', sql: 'SELECT id, amount FROM orders' },
        size: { col: 1, row: 1, width: 12, height: 4 },
      }]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('<table');
    expect(response.artifacts![0].content).toContain('500');
  });

  it('creates an app with multiple widgets', async () => {
    const result = await handler({
      title: 'Multi Widget',
      widgets: JSON.stringify([
        {
          id: 'kpi-1', type: 'kpi', title: 'Revenue',
          valueField: 'revenue', format: 'currency',
          query: { dataSourceId: 'test-db', sql: 'SELECT sum(revenue) as revenue FROM sales' },
          size: { col: 1, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-2', type: 'kpi', title: 'Count',
          valueField: 'revenue', format: 'number',
          query: { dataSourceId: 'test-db', sql: 'SELECT count(*) as revenue FROM sales' },
          size: { col: 4, row: 1, width: 3, height: 2 },
        },
      ]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('2 widgets');
    expect(response.artifacts![0].content).toContain('data-widget-id="kpi-1"');
    expect(response.artifacts![0].content).toContain('data-widget-id="kpi-2"');
  });

  it('returns artifact with artifactType code and language html', async () => {
    const result = await handler({
      title: 'Type Test',
      widgets: JSON.stringify([{
        id: 'kpi-1', type: 'kpi', title: 'X', valueField: 'revenue',
        query: { dataSourceId: 'test-db', sql: 'SELECT 1 as revenue' },
        size: { col: 1, row: 1, width: 3, height: 2 },
      }]),
    });
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].artifactType).toBe('code');
    expect(response.artifacts![0].language).toBe('html');
  });

  it('returns custom:app/preview block', async () => {
    const result = await handler({
      title: 'Block Test',
      widgets: JSON.stringify([{
        id: 'kpi-1', type: 'kpi', title: 'X', valueField: 'revenue',
        query: { dataSourceId: 'test-db', sql: 'SELECT 1 as revenue' },
        size: { col: 1, row: 1, width: 3, height: 2 },
      }]),
    });
    const response = result as ToolHandlerResponse;
    expect(response.blocks).toHaveLength(1);
    expect(response.blocks![0].type).toBe('custom:app/preview');
    expect((response.blocks![0] as any).data.widgetCount).toBe(1);
  });

  it('sets theme from input parameter', async () => {
    const result = await handler({
      title: 'Theme Test',
      theme: 'dark',
      widgets: JSON.stringify([{
        id: 'kpi-1', type: 'kpi', title: 'X', valueField: 'revenue',
        query: { dataSourceId: 'test-db', sql: 'SELECT 1 as revenue' },
        size: { col: 1, row: 1, width: 3, height: 2 },
      }]),
    });
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('data-theme="dark"');
  });

  // --- Error cases ---

  it('returns error for missing title', async () => {
    const result = await handler({ widgets: '[]' });
    expect(result).toBe('Error: title is required');
  });

  it('returns error for missing widgets', async () => {
    const result = await handler({ title: 'Test' });
    expect(result).toBe('Error: widgets JSON is required');
  });

  it('returns error for invalid JSON', async () => {
    const result = await handler({ title: 'Test', widgets: '{ bad json }' });
    expect(result).toBe('Error: widgets must be valid JSON');
  });

  it('returns error for empty widgets array', async () => {
    const result = await handler({ title: 'Test', widgets: '[]' });
    expect(result).toBe('Error: widgets array must not be empty');
  });

  it('returns error for invalid chart type', async () => {
    const result = await handler({
      title: 'Test',
      widgets: JSON.stringify([{
        id: 'c1', type: 'chart', title: 'X', chartType: 'sparkle',
        config: {},
        query: { dataSourceId: 'test-db', sql: 'SELECT 1' },
        size: { col: 1, row: 1, width: 6, height: 3 },
      }]),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('invalid chartType');
  });

  it('returns error for invalid ECharts config', async () => {
    const result = await handler({
      title: 'Test',
      widgets: JSON.stringify([{
        id: 'c1', type: 'chart', title: 'X', chartType: 'bar',
        config: { tooltip: { formatter: 'function() { return "x"; }' } },
        query: { dataSourceId: 'test-db', sql: 'SELECT 1' },
        size: { col: 1, row: 1, width: 6, height: 3 },
      }]),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Invalid ECharts config');
  });

  it('returns error for query execution failure', async () => {
    const failAdapter = createMockAdapter('test-db');
    (failAdapter.execute as any).mockRejectedValue(new Error('connection timeout'));
    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(DS_CONFIG, failAdapter);
    const failHandler = createAppCreateHandler(failRegistry);

    const result = await failHandler({
      title: 'Test',
      widgets: JSON.stringify([{
        id: 'kpi-1', type: 'kpi', title: 'X', valueField: 'revenue',
        query: { dataSourceId: 'test-db', sql: 'SELECT 1 as revenue' },
        size: { col: 1, row: 1, width: 3, height: 2 },
      }]),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('connection timeout');
  });
});
