import { describe, it, expect } from 'vitest';
import {
  createDashboardDefinition,
  serializeDashboard,
  parseDashboard,
} from './dashboard-model.js';
import type { DashboardWidget, KpiWidget, TableWidget, ChartWidget } from './types.js';

// --- Fixtures ---

const kpiWidget: KpiWidget = {
  id: 'kpi-revenue',
  type: 'kpi',
  title: 'Total Revenue',
  query: { dataSourceId: 'sales-db', sql: 'SELECT sum(total) as revenue FROM orders' },
  valueField: 'revenue',
  format: 'currency',
  size: { col: 0, row: 0, width: 3, height: 1 },
};

const tableWidget: TableWidget = {
  id: 'tbl-orders',
  type: 'table',
  title: 'Recent Orders',
  query: { dataSourceId: 'sales-db', sql: 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 20' },
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'total', label: 'Total', format: 'currency' },
  ],
  pageSize: 10,
  size: { col: 0, row: 1, width: 12, height: 4 },
};

const chartWidget: ChartWidget = {
  id: 'chart-monthly',
  type: 'chart',
  title: 'Monthly Sales',
  spec: { engine: 'vega-lite', config: { mark: 'bar' } },
  query: { dataSourceId: 'sales-db', sql: 'SELECT month, sum(total) FROM orders GROUP BY month' },
  size: { col: 3, row: 0, width: 9, height: 3 },
};

const widgets: DashboardWidget[] = [kpiWidget, tableWidget, chartWidget];

// --- Tests ---

describe('createDashboardDefinition', () => {
  it('creates a definition with defaults', () => {
    const def = createDashboardDefinition('Sales Dashboard', widgets, ['sales-db']);

    expect(def.version).toBe(1);
    expect(def.title).toBe('Sales Dashboard');
    expect(def.dataSources).toEqual(['sales-db']);
    expect(def.widgets).toHaveLength(3);
    expect(def.layout).toEqual({ columns: 12, rowHeight: 80 });
    expect(def.description).toBeUndefined();
    expect(def.filters).toBeUndefined();
    expect(def.refreshInterval).toBeUndefined();
  });

  it('accepts optional fields', () => {
    const def = createDashboardDefinition('Dashboard', widgets, ['db'], {
      description: 'Test dashboard',
      rowHeight: 100,
      refreshInterval: 30,
      filters: {
        global: [{
          name: 'date_range',
          label: 'Date Range',
          type: 'date-range',
          dataSourceId: 'db',
        }],
      },
    });

    expect(def.description).toBe('Test dashboard');
    expect(def.layout.rowHeight).toBe(100);
    expect(def.refreshInterval).toBe(30);
    expect(def.filters!.global).toHaveLength(1);
  });

  it('handles empty widgets array', () => {
    const def = createDashboardDefinition('Empty', [], ['db']);

    expect(def.widgets).toEqual([]);
  });
});

describe('serializeDashboard / parseDashboard round-trip', () => {
  it('round-trips a full dashboard definition', () => {
    const original = createDashboardDefinition('Sales Dashboard', widgets, ['sales-db'], {
      description: 'Revenue overview',
      refreshInterval: 60,
    });

    const json = serializeDashboard(original);
    const parsed = parseDashboard(json);

    expect(parsed).toEqual(original);
  });

  it('preserves widget types through round-trip', () => {
    const def = createDashboardDefinition('Test', widgets, ['sales-db']);
    const parsed = parseDashboard(serializeDashboard(def));

    expect(parsed.widgets[0].type).toBe('kpi');
    expect(parsed.widgets[1].type).toBe('table');
    expect(parsed.widgets[2].type).toBe('chart');
  });
});

describe('parseDashboard validation', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseDashboard('{not valid')).toThrow('Invalid JSON');
  });

  it('rejects non-object JSON', () => {
    expect(() => parseDashboard('"hello"')).toThrow('expected a JSON object');
  });

  it('rejects array JSON', () => {
    expect(() => parseDashboard('[]')).toThrow('expected a JSON object');
  });

  it('rejects missing version', () => {
    const json = JSON.stringify({ title: 'X', dataSources: ['db'], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('Unsupported dashboard version: missing');
  });

  it('rejects unsupported version', () => {
    const json = JSON.stringify({ version: 2, title: 'X', dataSources: ['db'], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('Unsupported dashboard version: 2');
  });

  it('rejects missing title', () => {
    const json = JSON.stringify({ version: 1, dataSources: ['db'], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('title is required');
  });

  it('rejects empty title', () => {
    const json = JSON.stringify({ version: 1, title: '', dataSources: ['db'], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('title is required');
  });

  it('rejects missing dataSources', () => {
    const json = JSON.stringify({ version: 1, title: 'X', widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('dataSources must be a non-empty array');
  });

  it('rejects empty dataSources', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: [], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('dataSources must be a non-empty array');
  });

  it('rejects non-string dataSources entries', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: [42], widgets: [], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('each dataSource must be a string');
  });

  it('rejects missing widgets', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: ['db'], layout: { columns: 12, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('widgets must be an array');
  });

  it('rejects missing layout', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: ['db'], widgets: [] });
    expect(() => parseDashboard(json)).toThrow('layout is required');
  });

  it('rejects wrong layout.columns', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: ['db'], widgets: [], layout: { columns: 6, rowHeight: 80 } });
    expect(() => parseDashboard(json)).toThrow('layout.columns must be 12');
  });

  it('rejects invalid layout.rowHeight', () => {
    const json = JSON.stringify({ version: 1, title: 'X', dataSources: ['db'], widgets: [], layout: { columns: 12, rowHeight: 0 } });
    expect(() => parseDashboard(json)).toThrow('layout.rowHeight must be a positive number');
  });

  it('rejects widget with missing id', () => {
    const json = JSON.stringify({
      version: 1,
      title: 'X',
      dataSources: ['db'],
      widgets: [{ type: 'kpi', size: { col: 0, row: 0, width: 3, height: 1 } }],
      layout: { columns: 12, rowHeight: 80 },
    });
    expect(() => parseDashboard(json)).toThrow('id is required');
  });

  it('rejects widget with invalid type', () => {
    const json = JSON.stringify({
      version: 1,
      title: 'X',
      dataSources: ['db'],
      widgets: [{ id: 'w1', type: 'sparkline', size: { col: 0, row: 0, width: 3, height: 1 } }],
      layout: { columns: 12, rowHeight: 80 },
    });
    expect(() => parseDashboard(json)).toThrow('Invalid widget type: sparkline');
  });

  it('rejects widget with missing size', () => {
    const json = JSON.stringify({
      version: 1,
      title: 'X',
      dataSources: ['db'],
      widgets: [{ id: 'w1', type: 'kpi' }],
      layout: { columns: 12, rowHeight: 80 },
    });
    expect(() => parseDashboard(json)).toThrow("Invalid widget 'w1': size is required");
  });
});
