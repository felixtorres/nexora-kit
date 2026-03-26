import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import { executeKpiWidget } from './kpi-handler.js';
import type { KpiWidget } from './types.js';

// --- Mock Adapter (same TestableRegistry pattern as registry.test.ts) ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [{ name: 'metrics', columns: [], rowCountEstimate: 100 }],
  dialect: 'postgresql',
};

function createMockAdapter(id: string, result: TabularResult): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockResolvedValue(result),
    getSampleData: vi.fn().mockResolvedValue(result),
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

// --- Test Helpers ---

function makeKpiWidget(overrides?: Partial<KpiWidget>): KpiWidget {
  return {
    id: 'kpi-revenue',
    type: 'kpi',
    title: 'Total Revenue',
    query: { dataSourceId: 'test-db', sql: 'SELECT sum(total) as revenue FROM orders' },
    valueField: 'revenue',
    format: 'number',
    size: { col: 0, row: 0, width: 3, height: 1 },
    ...overrides,
  };
}

function makeSingleRowResult(row: Record<string, unknown>): TabularResult {
  return {
    columns: Object.keys(row).map((k) => ({ key: k, label: k, type: 'number' as const })),
    rows: [row],
    rowCount: 1,
    truncated: false,
  };
}

// --- Tests ---

describe('executeKpiWidget', () => {
  let registry: TestableRegistry;

  beforeEach(() => {
    registry = new TestableRegistry();
  });

  it('returns a KPI block with correct value', async () => {
    const result = makeSingleRowResult({ revenue: 42500 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget();
    const block = await executeKpiWidget(widget, registry);

    expect(block.type).toBe('custom:dashboard/kpi');
    expect(block.data.widgetId).toBe('kpi-revenue');
    expect(block.data.title).toBe('Total Revenue');
    expect(block.data.value).toBe(42500);
    expect(block.data.format).toBe('number');
  });

  it('formats value as number', async () => {
    const result = makeSingleRowResult({ revenue: 1234567 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const block = await executeKpiWidget(makeKpiWidget({ format: 'number' }), registry);

    expect(block.data.formattedValue).toBe('1,234,567');
  });

  it('formats value as currency', async () => {
    const result = makeSingleRowResult({ revenue: 1234.5 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const block = await executeKpiWidget(makeKpiWidget({ format: 'currency' }), registry);

    expect(block.data.formattedValue).toBe('$1,234.50');
  });

  it('formats value as percent', async () => {
    const result = makeSingleRowResult({ revenue: 0.856 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const block = await executeKpiWidget(makeKpiWidget({ format: 'percent' }), registry);

    expect(block.data.formattedValue).toBe('85.6%');
  });

  it('defaults format to number when not specified', async () => {
    const result = makeSingleRowResult({ revenue: 500 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget();
    delete widget.format;
    const block = await executeKpiWidget(widget, registry);

    expect(block.data.format).toBe('number');
    expect(block.data.formattedValue).toBe('500');
  });

  it('calculates delta when comparisonField is set', async () => {
    const result = makeSingleRowResult({ revenue: 42500, prev_revenue: 38000 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget({
      comparisonField: 'prev_revenue',
      comparisonLabel: 'vs last month',
    });
    const block = await executeKpiWidget(widget, registry);

    expect(block.data.delta).toBe(4500);
    expect(block.data.formattedDelta).toBe('+4,500');
    expect(block.data.comparisonLabel).toBe('vs last month');
  });

  it('calculates negative delta correctly', async () => {
    const result = makeSingleRowResult({ revenue: 30000, prev_revenue: 38000 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget({
      format: 'currency',
      comparisonField: 'prev_revenue',
    });
    const block = await executeKpiWidget(widget, registry);

    expect(block.data.delta).toBe(-8000);
    expect(block.data.formattedDelta).toBe('-$8,000.00');
  });

  it('formats delta as percent', async () => {
    const result = makeSingleRowResult({ rate: 0.75, prev_rate: 0.60 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget({
      valueField: 'rate',
      format: 'percent',
      comparisonField: 'prev_rate',
      query: { dataSourceId: 'test-db', sql: 'SELECT rate, prev_rate FROM metrics' },
    });
    const block = await executeKpiWidget(widget, registry);

    expect(block.data.delta).toBeCloseTo(0.15);
    expect(block.data.formattedDelta).toBe('+15.0%');
  });

  it('omits delta when comparisonField value is null', async () => {
    const result = makeSingleRowResult({ revenue: 42500, prev_revenue: null });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    const widget = makeKpiWidget({ comparisonField: 'prev_revenue' });
    const block = await executeKpiWidget(widget, registry);

    expect(block.data.delta).toBeUndefined();
    expect(block.data.formattedDelta).toBeUndefined();
  });

  it('throws when query returns 0 rows', async () => {
    const emptyResult: TabularResult = {
      columns: [{ key: 'revenue', label: 'revenue', type: 'number' }],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', emptyResult));

    await expect(executeKpiWidget(makeKpiWidget(), registry)).rejects.toThrow(
      "KPI widget 'kpi-revenue': query returned no rows",
    );
  });

  it('throws when valueField is not in result', async () => {
    const result = makeSingleRowResult({ other_field: 100 });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    await expect(executeKpiWidget(makeKpiWidget(), registry)).rejects.toThrow(
      "valueField 'revenue' not found in result",
    );
  });

  it('throws when valueField is not a number', async () => {
    const result = makeSingleRowResult({ revenue: 'not-a-number' });
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', result));

    await expect(executeKpiWidget(makeKpiWidget(), registry)).rejects.toThrow(
      "valueField 'revenue' is not a number",
    );
  });

  it('passes query params to registry.execute', async () => {
    const result = makeSingleRowResult({ revenue: 100 });
    const adapter = createMockAdapter('test-db', result);
    await registry.registerWithAdapter(DS_CONFIG, adapter);

    const widget = makeKpiWidget({
      query: {
        dataSourceId: 'test-db',
        sql: 'SELECT sum(total) as revenue FROM orders WHERE region = $1',
        params: { region: 'US' },
      },
    });
    await executeKpiWidget(widget, registry);

    expect(adapter.execute).toHaveBeenCalledWith(
      'SELECT sum(total) as revenue FROM orders WHERE region = $1',
      { region: 'US' },
    );
  });
});
