import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from './registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from './types.js';

// --- Mock Adapter ---

function createMockAdapter(id: string, overrides?: Partial<DataAdapter>): DataAdapter {
  const schema: DataSourceSchema = {
    tables: [
      {
        name: 'orders',
        columns: [
          { name: 'id', type: 'int4', nullable: false, isPrimaryKey: true },
          { name: 'total', type: 'numeric', nullable: false },
          { name: 'created_at', type: 'timestamptz', nullable: false },
        ],
        rowCountEstimate: 500,
      },
    ],
    dialect: 'postgresql',
  };

  const sampleResult: TabularResult = {
    columns: [
      { key: 'id', label: 'id', type: 'number' },
      { key: 'total', label: 'total', type: 'number' },
    ],
    rows: [
      { id: 1, total: 99.5 },
      { id: 2, total: 42.0 },
    ],
    rowCount: 2,
    truncated: false,
  };

  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(schema),
    execute: vi.fn().mockResolvedValue(sampleResult),
    getSampleData: vi.fn().mockResolvedValue(sampleResult),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSqlConfig(id: string): DataSourceConfig {
  return {
    id,
    name: `Test Source ${id}`,
    type: 'sql',
    config: {
      type: 'sql',
      dialect: 'postgresql',
      connectionString: 'postgresql://test:test@localhost:5432/test',
    },
    constraints: { maxRows: 1000, timeoutMs: 5000 },
  };
}

// --- Helper to bypass SqlAdapter creation in register() ---
// We directly manipulate the registry internals via a helper
// since register() tries to instantiate SqlAdapter and connect to a real DB.
// Instead, we'll use a thin subclass that allows injecting adapters.

class TestableRegistry extends DataSourceRegistry {
  async registerWithAdapter(config: DataSourceConfig, adapter: DataAdapter): Promise<void> {
    // Replicate the duplicate check from register()
    if (this.has(config.id)) {
      throw new Error(`Data source '${config.id}' is already registered`);
    }
    // Use the private maps via any — only in tests
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

// --- Tests ---

describe('DataSourceRegistry', () => {
  let registry: TestableRegistry;

  beforeEach(() => {
    registry = new TestableRegistry();
  });

  describe('register and has', () => {
    it('registers a data source and reports it as present', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      expect(registry.has('sales')).toBe(true);
    });

    it('reports non-registered source as absent', () => {
      expect(registry.has('nope')).toBe(false);
    });

    it('throws on duplicate registration', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      await expect(
        registry.registerWithAdapter(makeSqlConfig('sales'), createMockAdapter('sales')),
      ).rejects.toThrow("Data source 'sales' is already registered");
    });
  });

  describe('get', () => {
    it('returns the registered adapter', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      const result = registry.get('sales');
      expect(result).toBe(adapter);
    });

    it('throws for non-existent source', () => {
      expect(() => registry.get('missing')).toThrow("Data source 'missing' not found");
    });
  });

  describe('getConfig', () => {
    it('returns the original config', async () => {
      const config = makeSqlConfig('sales');
      await registry.registerWithAdapter(config, createMockAdapter('sales'));

      const result = registry.getConfig('sales');
      expect(result).toBe(config);
    });

    it('throws for non-existent config', () => {
      expect(() => registry.getConfig('missing')).toThrow(
        "Data source config 'missing' not found",
      );
    });
  });

  describe('list', () => {
    it('returns empty array when no sources registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all registered configs', async () => {
      await registry.registerWithAdapter(makeSqlConfig('a'), createMockAdapter('a'));
      await registry.registerWithAdapter(makeSqlConfig('b'), createMockAdapter('b'));

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    });
  });

  describe('getSchema', () => {
    it('delegates to adapter.introspectSchema', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      const schema = await registry.getSchema('sales');
      expect(adapter.introspectSchema).toHaveBeenCalledOnce();
      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe('orders');
    });
  });

  describe('getSampleData', () => {
    it('delegates to adapter.getSampleData', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      const result = await registry.getSampleData('sales', 'orders', 5);
      expect(adapter.getSampleData).toHaveBeenCalledWith('orders', 5);
      expect(result.rowCount).toBe(2);
    });
  });

  describe('execute', () => {
    it('delegates to adapter.execute', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      const result = await registry.execute('sales', 'SELECT * FROM orders');
      expect(adapter.execute).toHaveBeenCalledWith('SELECT * FROM orders', undefined);
      expect(result.rowCount).toBe(2);
    });

    it('passes params through to the adapter', async () => {
      const adapter = createMockAdapter('sales');
      await registry.registerWithAdapter(makeSqlConfig('sales'), adapter);

      await registry.execute('sales', 'SELECT * FROM orders WHERE id = $1', { id: 1 });
      expect(adapter.execute).toHaveBeenCalledWith(
        'SELECT * FROM orders WHERE id = $1',
        { id: 1 },
      );
    });
  });

  describe('closeAll', () => {
    it('closes all adapters and clears state', async () => {
      const adapterA = createMockAdapter('a');
      const adapterB = createMockAdapter('b');
      await registry.registerWithAdapter(makeSqlConfig('a'), adapterA);
      await registry.registerWithAdapter(makeSqlConfig('b'), adapterB);

      await registry.closeAll();

      expect(adapterA.close).toHaveBeenCalledOnce();
      expect(adapterB.close).toHaveBeenCalledOnce();
      expect(registry.has('a')).toBe(false);
      expect(registry.has('b')).toBe(false);
      expect(registry.list()).toEqual([]);
    });
  });
});
