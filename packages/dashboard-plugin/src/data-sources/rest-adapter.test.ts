import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestAdapter } from './rest-adapter.js';
import type { RestConfig, QueryConstraints } from './types.js';

const defaults: QueryConstraints = { maxRows: 100, timeoutMs: 5000 };

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  });
}

describe('RestAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createAdapter(config: Partial<RestConfig> = {}, constraints = defaults) {
    const full: RestConfig = {
      type: 'rest',
      baseUrl: 'https://api.example.com',
      endpoints: [
        { name: 'sales', path: '/api/sales' },
      ],
      ...config,
    };
    return new RestAdapter('test-rest', full, constraints);
  }

  describe('execute', () => {
    it('fetches GET endpoint and returns TabularResult', async () => {
      const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
      globalThis.fetch = mockFetch(rows);

      const adapter = createAdapter();
      const result = await adapter.execute('sales');

      expect(result.rows).toEqual(rows);
      expect(result.rowCount).toBe(2);
      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].key).toBe('id');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/sales',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('parses FROM clause in query', async () => {
      globalThis.fetch = mockFetch([{ x: 1 }]);
      const adapter = createAdapter();
      const result = await adapter.execute('SELECT * FROM sales');
      expect(result.rowCount).toBe(1);
    });

    it('navigates resultPath in response', async () => {
      globalThis.fetch = mockFetch({ data: { items: [{ a: 1 }, { a: 2 }] } });
      const adapter = createAdapter({
        endpoints: [{ name: 'nested', path: '/api/nested', resultPath: 'data.items' }],
      });
      const result = await adapter.execute('nested');
      expect(result.rowCount).toBe(2);
    });

    it('injects bearer auth header', async () => {
      globalThis.fetch = mockFetch([]);
      const adapter = createAdapter({
        auth: { type: 'bearer', token: 'my-token' },
      });
      await adapter.execute('sales');
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer my-token');
    });

    it('injects api-key header', async () => {
      globalThis.fetch = mockFetch([]);
      const adapter = createAdapter({
        auth: { type: 'api-key', token: 'key-123', header: 'X-Custom-Key' },
      });
      await adapter.execute('sales');
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].headers['X-Custom-Key']).toBe('key-123');
    });

    it('substitutes params in URL', async () => {
      globalThis.fetch = mockFetch([{ x: 1 }]);
      const adapter = createAdapter({
        endpoints: [{ name: 'filtered', path: '/api/sales?region={{region}}' }],
      });
      await adapter.execute('filtered', { region: 'EMEA' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toBe('https://api.example.com/api/sales?region=EMEA');
    });

    it('limits rows to maxRows', async () => {
      const rows = Array.from({ length: 200 }, (_, i) => ({ id: i }));
      globalThis.fetch = mockFetch(rows);
      const adapter = createAdapter({}, { maxRows: 50, timeoutMs: 5000 });
      const result = await adapter.execute('sales');
      expect(result.rowCount).toBe(50);
      expect(result.truncated).toBe(true);
    });

    it('throws on non-200 response', async () => {
      globalThis.fetch = mockFetch(null, 500);
      const adapter = createAdapter();
      await expect(adapter.execute('sales')).rejects.toThrow('500');
    });

    it('throws for unknown endpoint', async () => {
      globalThis.fetch = mockFetch([]);
      const adapter = createAdapter();
      await expect(adapter.execute('nonexistent')).rejects.toThrow('not found');
    });

    it('uses pre-defined columns when set', async () => {
      globalThis.fetch = mockFetch([{ a: 1, b: 'x' }]);
      const adapter = createAdapter({
        endpoints: [{
          name: 'typed',
          path: '/api/typed',
          columns: [
            { key: 'a', label: 'Count', type: 'number' },
            { key: 'b', label: 'Name', type: 'string' },
          ],
        }],
      });
      const result = await adapter.execute('typed');
      expect(result.columns[0].label).toBe('Count');
      expect(result.columns[1].type).toBe('string');
    });
  });

  describe('getSampleData', () => {
    it('returns limited rows', async () => {
      globalThis.fetch = mockFetch([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
      const adapter = createAdapter();
      const result = await adapter.getSampleData('sales', 2);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(true);
    });
  });

  describe('introspectSchema', () => {
    it('derives tables from endpoints', async () => {
      globalThis.fetch = mockFetch([{ id: 1, name: 'test' }]);
      const adapter = createAdapter({
        endpoints: [
          { name: 'users', path: '/api/users' },
          { name: 'orders', path: '/api/orders', columns: [{ key: 'id', label: 'ID', type: 'number' }] },
        ],
      });
      const schema = await adapter.introspectSchema();
      expect(schema.tables).toHaveLength(2);
      expect(schema.tables[0].name).toBe('users');
      expect(schema.tables[1].name).toBe('orders');
      expect(schema.tables[1].columns[0].name).toBe('id');
    });
  });

  describe('close', () => {
    it('is a no-op', async () => {
      const adapter = createAdapter();
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });
});
