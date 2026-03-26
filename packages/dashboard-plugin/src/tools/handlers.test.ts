import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import type { ToolHandlerResponse } from '@nexora-kit/core';
import { createListSourcesHandler } from './list-sources.js';
import { createQueryHandler } from './query.js';
import { createRenderChartHandler } from './render-chart.js';

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
    {
      name: 'products',
      columns: [
        { name: 'id', type: 'int4', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'text', nullable: false },
        { name: 'price', type: 'numeric', nullable: false },
      ],
      rowCountEstimate: 50,
    },
  ],
  dialect: 'postgresql',
};

const MOCK_QUERY_RESULT: TabularResult = {
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

const MOCK_SAMPLE: TabularResult = {
  columns: [
    { key: 'id', label: 'id', type: 'number' },
    { key: 'total', label: 'total', type: 'number' },
  ],
  rows: [{ id: 1, total: 42.5 }],
  rowCount: 1,
  truncated: false,
};

function createMockAdapter(id: string): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockResolvedValue(MOCK_QUERY_RESULT),
    getSampleData: vi.fn().mockResolvedValue(MOCK_SAMPLE),
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

// Testable subclass to inject mock adapters
class TestableRegistry extends DataSourceRegistry {
  async registerWithAdapter(config: DataSourceConfig, adapter: DataAdapter): Promise<void> {
    if (this.has(config.id)) {
      throw new Error(`Data source '${config.id}' is already registered`);
    }
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

// --- Tests ---

describe('dashboard_list_sources handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createListSourcesHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createListSourcesHandler(registry);
  });

  it('lists all sources with tables and constraints', async () => {
    const result = await handler({});

    expect(typeof result).toBe('string');
    const text = result as string;
    expect(text).toContain('Available data sources');
    expect(text).toContain('Test Database');
    expect(text).toContain('test-db');
    expect(text).toContain('orders');
    expect(text).toContain('products');
    expect(text).toContain('10000');
  });

  it('returns detail view for a specific source', async () => {
    const result = await handler({ dataSourceId: 'test-db' });

    expect(typeof result).toBe('string');
    const text = result as string;
    expect(text).toContain('# Data Source: Test Database');
    expect(text).toContain('Tables: 2');
    expect(text).toContain('## orders');
    expect(text).toContain('## products');
    // Column table headers
    expect(text).toContain('| Column | Type | Nullable | PK |');
    // Sample data
    expect(text).toContain('Sample data');
  });

  it('returns message when no sources configured', async () => {
    const emptyRegistry = new TestableRegistry();
    const emptyHandler = createListSourcesHandler(emptyRegistry);

    const result = await emptyHandler({});
    expect(result).toContain('No data sources are configured');
  });
});

describe('dashboard_query handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createQueryHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createQueryHandler(registry);
  });

  it('executes a valid SELECT and returns structured response', async () => {
    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT status, count(*) as count FROM orders GROUP BY status',
    });

    // Should be a ToolHandlerResponse object
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('2 rows');
    expect(response.content).toContain('status (string)');
    expect(response.content).toContain('count (number)');
    expect(response.blocks).toBeDefined();
    expect(response.blocks![0]).toMatchObject({ type: 'table' });
  });

  it('rejects a write statement (INSERT)', async () => {
    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'INSERT INTO orders VALUES (1, 100, \'new\')',
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Query validation failed');
    expect(result as string).toContain('INSERT');
  });

  it('rejects a write statement (DROP)', async () => {
    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'DROP TABLE orders',
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Query validation failed');
  });

  it('returns error when dataSourceId is missing', async () => {
    const result = await handler({ sql: 'SELECT 1' });

    expect(result).toBe('Error: dataSourceId is required');
  });

  it('returns error when sql is missing', async () => {
    const result = await handler({ dataSourceId: 'test-db' });

    expect(result).toBe('Error: sql query is required');
  });

  it('handles query execution failure gracefully', async () => {
    const failAdapter = createMockAdapter('test-db');
    (failAdapter.execute as any).mockRejectedValue(new Error('connection timeout'));

    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(DS_CONFIG, failAdapter);
    const failHandler = createQueryHandler(failRegistry);

    const result = await failHandler({
      dataSourceId: 'test-db',
      sql: 'SELECT * FROM orders',
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Query execution failed');
    expect(result as string).toContain('connection timeout');
  });

  it('passes params to the registry execute call', async () => {
    const adapter = createMockAdapter('test-db');
    const paramRegistry = new TestableRegistry();
    await paramRegistry.registerWithAdapter(DS_CONFIG, adapter);
    const paramHandler = createQueryHandler(paramRegistry);

    await paramHandler({
      dataSourceId: 'test-db',
      sql: 'SELECT * FROM orders WHERE status = $1',
      params: { status: 'shipped' },
    });

    expect(adapter.execute).toHaveBeenCalledWith(
      'SELECT * FROM orders WHERE status = $1',
      { status: 'shipped' },
    );
  });
});

describe('dashboard_render_chart handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createRenderChartHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createRenderChartHandler(registry);
  });

  it('renders a chart with a valid Vega-Lite spec', async () => {
    const spec = JSON.stringify({
      mark: 'bar',
      encoding: {
        x: { field: 'status', type: 'nominal' },
        y: { field: 'count', type: 'quantitative' },
      },
    });

    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT status, count(*) as count FROM orders GROUP BY status',
      spec,
      title: 'Order Status',
    });

    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('Order Status');
    expect(response.content).toContain('2 data points');
    expect(response.blocks).toBeDefined();
    expect(response.blocks![0]).toMatchObject({
      type: 'custom:dashboard/chart',
    });
    const chartData = (response.blocks![0] as any).data;
    expect(chartData.title).toBe('Order Status');
    expect(chartData.spec.engine).toBe('vega-lite');
    expect(chartData.data).toHaveLength(2);
    expect(chartData.rowCount).toBe(2);
  });

  it('accepts spec as object (not just string)', async () => {
    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT status, count(*) as count FROM orders GROUP BY status',
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'status', type: 'nominal' },
          y: { field: 'count', type: 'quantitative' },
        },
      },
      title: 'Bar Chart',
    });

    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('Bar Chart');
  });

  it('rejects an invalid Vega-Lite spec (unknown mark)', async () => {
    const spec = JSON.stringify({
      mark: 'invalid_type',
      encoding: {},
    });

    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT 1',
      spec,
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Invalid Vega-Lite spec');
  });

  it('rejects invalid JSON in spec', async () => {
    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT 1',
      spec: '{not valid json',
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('spec must be valid JSON');
  });

  it('rejects a write query in chart SQL', async () => {
    const spec = JSON.stringify({
      mark: 'bar',
      encoding: {
        x: { field: 'a', type: 'nominal' },
        y: { field: 'b', type: 'quantitative' },
      },
    });

    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'DELETE FROM orders',
      spec,
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Query validation failed');
  });

  it('returns error when required params are missing', async () => {
    const result = await handler({});

    expect(typeof result).toBe('string');
    expect(result as string).toContain('dataSourceId, sql, and spec are required');
  });

  it('handles query execution failure during chart generation', async () => {
    const failAdapter = createMockAdapter('test-db');
    (failAdapter.execute as any).mockRejectedValue(new Error('table not found'));

    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(DS_CONFIG, failAdapter);
    const failHandler = createRenderChartHandler(failRegistry);

    const spec = JSON.stringify({
      mark: 'bar',
      encoding: {
        x: { field: 'status', type: 'nominal' },
        y: { field: 'count', type: 'quantitative' },
      },
    });

    const result = await failHandler({
      dataSourceId: 'test-db',
      sql: 'SELECT status, count(*) FROM missing_table GROUP BY status',
      spec,
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('Chart generation failed');
    expect(result as string).toContain('table not found');
  });

  it('uses default title "Chart" when none provided', async () => {
    const spec = JSON.stringify({
      mark: 'line',
      encoding: {
        x: { field: 'status', type: 'nominal' },
        y: { field: 'count', type: 'quantitative' },
      },
    });

    const result = await handler({
      dataSourceId: 'test-db',
      sql: 'SELECT status, count(*) as count FROM orders GROUP BY status',
      spec,
    });

    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('"Chart"');
  });
});
