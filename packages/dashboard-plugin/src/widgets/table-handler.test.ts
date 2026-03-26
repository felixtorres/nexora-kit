import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import { executeTableWidget } from './table-handler.js';
import type { TableWidget } from './types.js';

// --- Mock Adapter (same TestableRegistry pattern) ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [{ name: 'orders', columns: [], rowCountEstimate: 500 }],
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

function makeTableWidget(overrides?: Partial<TableWidget>): TableWidget {
  return {
    id: 'tbl-orders',
    type: 'table',
    title: 'Recent Orders',
    query: { dataSourceId: 'test-db', sql: 'SELECT * FROM orders ORDER BY created_at DESC' },
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'total', label: 'Total', format: 'currency' },
      { key: 'status', label: 'Status' },
    ],
    size: { col: 0, row: 0, width: 12, height: 4 },
    ...overrides,
  };
}

const FIVE_ROW_RESULT: TabularResult = {
  columns: [
    { key: 'id', label: 'id', type: 'number' },
    { key: 'total', label: 'total', type: 'number' },
    { key: 'status', label: 'status', type: 'string' },
  ],
  rows: [
    { id: 1, total: 99.5, status: 'shipped' },
    { id: 2, total: 42.0, status: 'pending' },
    { id: 3, total: 150.0, status: 'shipped' },
    { id: 4, total: 25.0, status: 'cancelled' },
    { id: 5, total: 80.0, status: 'pending' },
  ],
  rowCount: 5,
  truncated: false,
};

// --- Tests ---

describe('executeTableWidget', () => {
  let registry: TestableRegistry;

  beforeEach(() => {
    registry = new TestableRegistry();
  });

  it('returns a table block with all rows when no pageSize', async () => {
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', FIVE_ROW_RESULT));

    const widget = makeTableWidget();
    const block = await executeTableWidget(widget, registry);

    expect(block.type).toBe('custom:dashboard/table');
    expect(block.data.widgetId).toBe('tbl-orders');
    expect(block.data.title).toBe('Recent Orders');
    expect(block.data.columns).toEqual(widget.columns);
    expect(block.data.rows).toHaveLength(5);
    expect(block.data.rowCount).toBe(5);
    expect(block.data.totalRows).toBe(5);
    expect(block.data.truncated).toBe(false);
  });

  it('limits rows to pageSize', async () => {
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', FIVE_ROW_RESULT));

    const widget = makeTableWidget({ pageSize: 3 });
    const block = await executeTableWidget(widget, registry);

    expect(block.data.rows).toHaveLength(3);
    expect(block.data.rowCount).toBe(3);
    expect(block.data.totalRows).toBe(5);
    expect(block.data.truncated).toBe(true);
    expect(block.data.pageSize).toBe(3);
  });

  it('does not truncate when pageSize >= rowCount', async () => {
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', FIVE_ROW_RESULT));

    const widget = makeTableWidget({ pageSize: 10 });
    const block = await executeTableWidget(widget, registry);

    expect(block.data.rows).toHaveLength(5);
    expect(block.data.truncated).toBe(false);
  });

  it('handles empty result set', async () => {
    const emptyResult: TabularResult = {
      columns: [
        { key: 'id', label: 'id', type: 'number' },
        { key: 'total', label: 'total', type: 'number' },
      ],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', emptyResult));

    const widget = makeTableWidget();
    const block = await executeTableWidget(widget, registry);

    expect(block.data.rows).toEqual([]);
    expect(block.data.rowCount).toBe(0);
    expect(block.data.totalRows).toBe(0);
    expect(block.data.truncated).toBe(false);
  });

  it('defaults sortable to false', async () => {
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', FIVE_ROW_RESULT));

    const widget = makeTableWidget();
    const block = await executeTableWidget(widget, registry);

    expect(block.data.sortable).toBe(false);
  });

  it('passes through sortable: true', async () => {
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db', FIVE_ROW_RESULT));

    const widget = makeTableWidget({ sortable: true });
    const block = await executeTableWidget(widget, registry);

    expect(block.data.sortable).toBe(true);
  });

  it('passes query params to registry.execute', async () => {
    const adapter = createMockAdapter('test-db', FIVE_ROW_RESULT);
    await registry.registerWithAdapter(DS_CONFIG, adapter);

    const widget = makeTableWidget({
      query: {
        dataSourceId: 'test-db',
        sql: 'SELECT * FROM orders WHERE status = $1',
        params: { status: 'shipped' },
      },
    });
    await executeTableWidget(widget, registry);

    expect(adapter.execute).toHaveBeenCalledWith(
      'SELECT * FROM orders WHERE status = $1',
      { status: 'shipped' },
    );
  });
});
