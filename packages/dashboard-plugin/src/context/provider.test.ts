import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDashboardContext } from './provider.js';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';

// --- Mock Setup ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [
    {
      name: 'customers',
      columns: [
        { name: 'id', type: 'int4', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'text', nullable: false },
        { name: 'email', type: 'varchar', nullable: true },
      ],
      rowCountEstimate: 1500,
    },
    {
      name: 'invoices',
      columns: [
        { name: 'id', type: 'int4', nullable: false, isPrimaryKey: true },
        { name: 'customer_id', type: 'int4', nullable: false },
        { name: 'amount', type: 'numeric', nullable: false },
      ],
      rowCountEstimate: 8200,
    },
  ],
  dialect: 'postgresql',
};

const MOCK_SAMPLE: TabularResult = {
  columns: [
    { key: 'id', label: 'id', type: 'number' },
    { key: 'name', label: 'name', type: 'string' },
  ],
  rows: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ],
  rowCount: 2,
  truncated: false,
};

function createMockAdapter(id: string): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockResolvedValue(MOCK_SAMPLE),
    getSampleData: vi.fn().mockResolvedValue(MOCK_SAMPLE),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

class TestableRegistry extends DataSourceRegistry {
  async registerWithAdapter(config: DataSourceConfig, adapter: DataAdapter): Promise<void> {
    if (this.has(config.id)) {
      throw new Error(`Data source '${config.id}' is already registered`);
    }
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

const DS_CONFIG: DataSourceConfig = {
  id: 'analytics',
  name: 'Analytics DB',
  type: 'sql',
  config: {
    type: 'sql',
    dialect: 'postgresql',
    connectionString: 'postgresql://test:test@localhost:5432/analytics',
  },
  constraints: { maxRows: 10_000, timeoutMs: 30_000 },
};

// --- Tests ---

describe('buildDashboardContext', () => {
  let registry: TestableRegistry;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('analytics'));
  });

  it('includes the header and behavioral rules', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('# Dashboard Plugin');
    expect(context).toContain('call the tool immediately');
  });

  it('includes data source name and id', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('Analytics DB');
    expect(context).toContain('`analytics`');
  });

  it('includes table names and schemas', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('**customers**');
    expect(context).toContain('**invoices**');
    expect(context).toContain('`id`');
    expect(context).toContain('`name`');
    expect(context).toContain('`amount`');
    expect(context).toContain('1500');
    expect(context).toContain('8200');
  });

  it('includes column type and PK info', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('int4');
    expect(context).toContain('PK');
  });

  it('includes sample data', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('Sample:');
    expect(context).toContain('Alice');
    expect(context).toContain('Bob');
  });

  it('includes Vega-Lite reference in classic/both mode', async () => {
    const context = await buildDashboardContext(registry);
    expect(context).toContain('Vega-Lite');
  });

  it('includes ECharts reference in app/both mode', async () => {
    const context = await buildDashboardContext(registry, { mode: 'app' });
    expect(context).toContain('ECharts');
    expect(context).not.toContain('Vega-Lite');
  });

  it('works with empty registry (no data sources)', async () => {
    const emptyRegistry = new TestableRegistry();
    const context = await buildDashboardContext(emptyRegistry);

    expect(context).toContain('# Dashboard Plugin');
    expect(context).not.toContain('## Available Data Sources');
  });

  it('handles schema introspection failure gracefully', async () => {
    const failAdapter = createMockAdapter('fail');
    (failAdapter.introspectSchema as any).mockRejectedValue(new Error('connection refused'));

    const failConfig: DataSourceConfig = {
      ...DS_CONFIG,
      id: 'fail',
      name: 'Failing DB',
    };
    const failRegistry = new TestableRegistry();
    await failRegistry.registerWithAdapter(failConfig, failAdapter);

    const context = await buildDashboardContext(failRegistry);
    expect(context).toContain('Failing DB');
    expect(context).toContain('(schema unavailable)');
  });

  it('includes multiple data sources when registered', async () => {
    const secondConfig: DataSourceConfig = {
      ...DS_CONFIG,
      id: 'warehouse',
      name: 'Data Warehouse',
    };
    await registry.registerWithAdapter(secondConfig, createMockAdapter('warehouse'));

    const context = await buildDashboardContext(registry);
    expect(context).toContain('Analytics DB');
    expect(context).toContain('Data Warehouse');
  });
});
