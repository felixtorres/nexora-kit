import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDispatcher } from '@nexora-kit/core';
import { ToolBackedAdapter } from './tool-adapter.js';
import type { ToolConfig, DataSourceSchema } from './types.js';

// ---------------------------------------------------------------------------
// Mock ToolDispatcher
// ---------------------------------------------------------------------------

function createMockDispatcher(overrides?: Partial<ToolDispatcher>): ToolDispatcher {
  return {
    invoke: vi.fn(),
    dispatch: vi.fn() as any,
    register: vi.fn(),
    unregister: vi.fn(),
    setPermissionChecker: vi.fn(),
    listTools: vi.fn().mockReturnValue([]),
    listToolsWithNamespace: vi.fn().mockReturnValue([]),
    hasHandler: vi.fn().mockReturnValue(false),
    cloneToolsInto: vi.fn(),
    ...overrides,
  } as unknown as ToolDispatcher;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const NAMESPACE = 'dashboard';

const TABULAR_CONFIG: ToolConfig = {
  type: 'tool',
  queryTool: 'crm_query',
  schemaTool: 'crm_schema',
  resultFormat: 'tabular',
};

const JSON_ARRAY_CONFIG: ToolConfig = {
  type: 'tool',
  queryTool: 'api_fetch',
  resultFormat: 'json-array',
};

const TABULAR_RESPONSE = JSON.stringify({
  columns: [
    { key: 'id', label: 'ID', type: 'number' },
    { key: 'name', label: 'Name', type: 'string' },
  ],
  rows: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ],
});

const SCHEMA_RESPONSE: DataSourceSchema = {
  tables: [
    {
      name: 'contacts',
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'email', type: 'text', nullable: false },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolBackedAdapter', () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    dispatcher = createMockDispatcher();
  });

  describe('execute()', () => {
    it('calls dispatcher.invoke with the right tool and args', async () => {
      (dispatcher.invoke as any).mockResolvedValue(TABULAR_RESPONSE);

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      const result = await adapter.execute('SELECT * FROM contacts', { limit: 10 });

      expect(dispatcher.invoke).toHaveBeenCalledWith(
        'crm_query',
        { query: 'SELECT * FROM contacts', params: { limit: 10 } },
        NAMESPACE,
      );
      expect(result.columns).toHaveLength(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
    });

    it('handles ToolHandlerResponse objects from invoke', async () => {
      (dispatcher.invoke as any).mockResolvedValue({
        content: TABULAR_RESPONSE,
        blocks: [],
      });

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      const result = await adapter.execute('SELECT 1');

      expect(result.rows).toHaveLength(2);
    });

    it('parses json-array format results', async () => {
      const jsonArrayResult = JSON.stringify([
        { city: 'NYC', pop: 8_000_000 },
        { city: 'LA', pop: 4_000_000 },
      ]);
      (dispatcher.invoke as any).mockResolvedValue(jsonArrayResult);

      const adapter = new ToolBackedAdapter('api', JSON_ARRAY_CONFIG, dispatcher, NAMESPACE);
      const result = await adapter.execute('get cities');

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].key).toBe('city');
      expect(result.columns[1].key).toBe('pop');
      expect(result.rows).toHaveLength(2);
    });

    it('propagates dispatcher errors', async () => {
      (dispatcher.invoke as any).mockRejectedValue(new Error('Tool not found: crm_query'));

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);

      await expect(adapter.execute('SELECT 1')).rejects.toThrow('Tool not found: crm_query');
    });

    it('throws on unparseable result', async () => {
      (dispatcher.invoke as any).mockResolvedValue('not valid json at all');

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);

      await expect(adapter.execute('SELECT 1')).rejects.toThrow('not valid JSON');
    });
  });

  describe('introspectSchema()', () => {
    it('calls the schema tool and parses the result', async () => {
      (dispatcher.invoke as any).mockResolvedValue(JSON.stringify(SCHEMA_RESPONSE));

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      const schema = await adapter.introspectSchema();

      expect(dispatcher.invoke).toHaveBeenCalledWith('crm_schema', {}, NAMESPACE);
      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe('contacts');
      expect(schema.tables[0].columns).toHaveLength(2);
    });

    it('accepts a raw array of tables', async () => {
      (dispatcher.invoke as any).mockResolvedValue(JSON.stringify(SCHEMA_RESPONSE.tables));

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      const schema = await adapter.introspectSchema();

      expect(schema.tables).toHaveLength(1);
    });

    it('throws when no schemaTool is configured', async () => {
      const adapter = new ToolBackedAdapter('api', JSON_ARRAY_CONFIG, dispatcher, NAMESPACE);

      await expect(adapter.introspectSchema()).rejects.toThrow(
        "Data source 'api' has no schemaTool configured",
      );
      expect(dispatcher.invoke).not.toHaveBeenCalled();
    });

    it('throws when schema tool returns invalid JSON', async () => {
      (dispatcher.invoke as any).mockResolvedValue('not json');

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);

      await expect(adapter.introspectSchema()).rejects.toThrow('returned invalid JSON');
    });

    it('throws when schema tool returns unrecognised format', async () => {
      (dispatcher.invoke as any).mockResolvedValue(JSON.stringify({ wrong: 'shape' }));

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);

      await expect(adapter.introspectSchema()).rejects.toThrow('unrecognised format');
    });
  });

  describe('getSampleData()', () => {
    it('delegates to execute with a LIMIT query', async () => {
      (dispatcher.invoke as any).mockResolvedValue(TABULAR_RESPONSE);

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      const result = await adapter.getSampleData('contacts', 3);

      expect(dispatcher.invoke).toHaveBeenCalledWith(
        'crm_query',
        { query: 'SELECT * FROM "contacts" LIMIT 3', params: undefined },
        NAMESPACE,
      );
      expect(result.rows).toHaveLength(2);
    });

    it('defaults limit to 5', async () => {
      (dispatcher.invoke as any).mockResolvedValue(TABULAR_RESPONSE);

      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      await adapter.getSampleData('orders');

      expect(dispatcher.invoke).toHaveBeenCalledWith(
        'crm_query',
        { query: 'SELECT * FROM "orders" LIMIT 5', params: undefined },
        NAMESPACE,
      );
    });
  });

  describe('close()', () => {
    it('is a no-op that resolves', async () => {
      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });

  describe('properties', () => {
    it('exposes id and type', () => {
      const adapter = new ToolBackedAdapter('crm', TABULAR_CONFIG, dispatcher, NAMESPACE);
      expect(adapter.id).toBe('crm');
      expect(adapter.type).toBe('tool');
    });
  });
});
