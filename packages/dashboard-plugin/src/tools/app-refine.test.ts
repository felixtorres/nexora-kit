import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
} from '../data-sources/types.js';
import type { ToolHandlerResponse } from '@nexora-kit/core';
import { createAppRefineHandler } from './app-refine.js';
import type { AppDefinition, AppKpiWidget, AppChartWidget } from '../app/types.js';
import { DEFAULT_APP_LAYOUT } from '../app/types.js';

// --- Mock setup ---

const MOCK_SCHEMA: DataSourceSchema = {
  tables: [{ name: 'sales', columns: [{ name: 'revenue', type: 'numeric', nullable: false }], rowCountEstimate: 100 }],
  dialect: 'postgresql',
};

const MOCK_RESULT: TabularResult = {
  columns: [{ key: 'revenue', label: 'revenue', type: 'number' }],
  rows: [{ revenue: 50000 }],
  rowCount: 1,
  truncated: false,
};

function createMockAdapter(id: string): DataAdapter {
  return {
    id,
    type: 'built-in',
    introspectSchema: vi.fn().mockResolvedValue(MOCK_SCHEMA),
    execute: vi.fn().mockResolvedValue(MOCK_RESULT),
    getSampleData: vi.fn().mockResolvedValue(MOCK_RESULT),
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
    if (this.has(config.id)) throw new Error(`Already registered: ${config.id}`);
    (this as any).adapters.set(config.id, adapter);
    (this as any).configs.set(config.id, config);
  }
}

// --- Helpers ---

const KPI_WIDGET: AppKpiWidget = {
  id: 'kpi-1', type: 'kpi', title: 'Revenue',
  query: { dataSourceId: 'test-db', sql: 'SELECT sum(revenue) as revenue FROM sales' },
  valueField: 'revenue', format: 'currency',
  size: { col: 1, row: 1, width: 3, height: 2 },
};

const CHART_WIDGET: AppChartWidget = {
  id: 'chart-1', type: 'chart', title: 'Trend',
  chartType: 'line',
  config: { xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [{ type: 'line' }], tooltip: {} },
  query: { dataSourceId: 'test-db', sql: 'SELECT * FROM sales' },
  size: { col: 4, row: 1, width: 9, height: 3 },
};

function makeDefinition(widgets: AppDefinition['widgets']): AppDefinition {
  return { title: 'Test App', theme: 'light', widgets, layout: DEFAULT_APP_LAYOUT, controls: [{ type: 'theme-toggle' }] };
}

// --- Tests ---

describe('dashboard:app_refine handler', () => {
  let registry: TestableRegistry;
  let handler: ReturnType<typeof createAppRefineHandler>;

  beforeEach(async () => {
    registry = new TestableRegistry();
    await registry.registerWithAdapter(DS_CONFIG, createMockAdapter('test-db'));
    handler = createAppRefineHandler(registry);
  });

  // --- Dashboard refinement (r1) ---

  it('adds a widget to an existing app', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
      addWidgets: JSON.stringify([CHART_WIDGET]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('2 widgets');
    expect(response.artifacts![0].type).toBe('update');
    expect(response.artifacts![0].content).toContain('data-widget-id="chart-1"');
    expect(response.artifacts![0].content).toContain('data-widget-id="kpi-1"');
  });

  it('removes a widget from an existing app', async () => {
    const def = makeDefinition([KPI_WIDGET, CHART_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
      removeWidgetIds: JSON.stringify(['chart-1']),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('1 widgets');
    expect(response.artifacts![0].content).toContain('data-widget-id="kpi-1"');
    expect(response.artifacts![0].content).not.toContain('data-widget-id="chart-1"');
  });

  it('updates an existing widget', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'widget',
      updateWidgets: JSON.stringify([{ id: 'kpi-1', title: 'Updated Revenue' }]),
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('Updated Revenue');
  });

  it('changes the theme', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'layout',
      theme: 'dark',
    });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('data-theme="dark"');
  });

  it('changes the title', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'layout',
      title: 'New Title',
    });
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].content).toContain('New Title');
    expect(response.artifacts![0].title).toBe('New Title');
  });

  // --- Layout refinement (r0) — no queries ---

  it('layout refinement does not execute queries', async () => {
    const adapter = createMockAdapter('test-db');
    const layoutRegistry = new TestableRegistry();
    await layoutRegistry.registerWithAdapter(DS_CONFIG, adapter);
    const layoutHandler = createAppRefineHandler(layoutRegistry);

    const def = makeDefinition([KPI_WIDGET]);
    await layoutHandler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'layout',
      theme: 'dark',
    });

    expect(adapter.execute).not.toHaveBeenCalled();
  });

  // --- Widget refinement (r2) — only affected queries ---

  it('widget refinement only re-queries the changed widget', async () => {
    const adapter = createMockAdapter('test-db');
    const widgetRegistry = new TestableRegistry();
    await widgetRegistry.registerWithAdapter(DS_CONFIG, adapter);
    const widgetHandler = createAppRefineHandler(widgetRegistry);

    const def = makeDefinition([KPI_WIDGET, CHART_WIDGET]);
    await widgetHandler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'widget',
      updateWidgets: JSON.stringify([{ id: 'kpi-1', title: 'Updated' }]),
    });

    // Only kpi-1 query should execute, not chart-1
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  // --- Artifact output ---

  it('returns update artifact with code type', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
    });
    const response = result as ToolHandlerResponse;
    expect(response.artifacts![0].type).toBe('update');
    expect(response.artifacts![0].artifactType).toBe('code');
    expect(response.artifacts![0].language).toBe('html');
    expect(response.artifacts![0].artifactId).toBe('app-1');
  });

  it('returns custom:app/preview block', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
    });
    const response = result as ToolHandlerResponse;
    expect(response.blocks![0].type).toBe('custom:app/preview');
  });

  // --- Error cases ---

  it('returns error for missing appId', async () => {
    const result = await handler({ definition: '{}' });
    expect(result).toBe('Error: appId is required');
  });

  it('returns error for missing definition', async () => {
    const result = await handler({ appId: 'app-1' });
    expect(result).toContain('definition is required');
  });

  it('returns error for invalid refinement level', async () => {
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(makeDefinition([KPI_WIDGET])),
      refinementLevel: 'invalid',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('refinementLevel');
  });

  it('returns error when updating non-existent widget', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'widget',
      updateWidgets: JSON.stringify([{ id: 'does-not-exist', title: 'X' }]),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('not found');
  });

  it('returns error when adding duplicate widget ID', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
      addWidgets: JSON.stringify([{ ...KPI_WIDGET }]),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('already exists');
  });

  it('returns error when removing all widgets', async () => {
    const def = makeDefinition([KPI_WIDGET]);
    const result = await handler({
      appId: 'app-1',
      definition: JSON.stringify(def),
      refinementLevel: 'dashboard',
      removeWidgetIds: JSON.stringify(['kpi-1']),
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('at least one');
  });
});
