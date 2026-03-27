import { describe, it, expect } from 'vitest';
import { generateApp } from './generator.js';
import type {
  AppDefinition,
  AppChartWidget,
  AppKpiWidget,
  AppTableWidget,
  WidgetDataMap,
} from './types.js';
import { DEFAULT_APP_LAYOUT } from './types.js';

function makeDefinition(widgets: AppDefinition['widgets'], overrides?: Partial<AppDefinition>): AppDefinition {
  return {
    title: 'Test Dashboard',
    theme: 'light',
    widgets,
    layout: DEFAULT_APP_LAYOUT,
    ...overrides,
  };
}

const CHART_WIDGET: AppChartWidget = {
  id: 'chart-1',
  type: 'chart',
  title: 'Revenue Trend',
  chartType: 'line',
  config: { xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [{ type: 'line' }] },
  query: { dataSourceId: 'db', sql: 'SELECT * FROM sales' },
  size: { col: 1, row: 1, width: 6, height: 3 },
};

const KPI_WIDGET: AppKpiWidget = {
  id: 'kpi-1',
  type: 'kpi',
  title: 'Total Revenue',
  query: { dataSourceId: 'db', sql: 'SELECT sum(amount) as revenue FROM sales' },
  valueField: 'revenue',
  format: 'currency',
  size: { col: 7, row: 1, width: 3, height: 2 },
};

const TABLE_WIDGET: AppTableWidget = {
  id: 'table-1',
  type: 'table',
  title: 'Recent Orders',
  query: { dataSourceId: 'db', sql: 'SELECT * FROM orders LIMIT 10' },
  columns: [{ key: 'id', label: 'ID' }, { key: 'amount', label: 'Amount' }],
  size: { col: 1, row: 4, width: 12, height: 4 },
};

describe('generateApp', () => {
  it('generates a valid HTML document with DOCTYPE', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 42000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.html).toMatch(/^<!DOCTYPE html>/);
    expect(result.html).toContain('</html>');
  });

  it('includes ECharts CDN script tag', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.html).toContain('cdn.jsdelivr.net/npm/echarts');
  });

  it('contains CSS with theme variables', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.html).toContain('--bg-primary');
    expect(result.html).toContain('[data-theme="dark"]');
  });

  it('includes runtime script', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.html).toContain('window.__charts');
    expect(result.html).toContain('__toggleTheme');
  });

  it('sets data-theme attribute to requested theme', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET], { theme: 'dark' }), data);
    expect(result.html).toContain('data-theme="dark"');
  });

  it('returns correct widgetCount', () => {
    const data: WidgetDataMap = new Map([
      ['chart-1', [{ date: '2026-01', revenue: 100 }]],
      ['kpi-1', [{ revenue: 42000 }]],
      ['table-1', [{ id: 1, amount: 100 }]],
    ]);
    const result = generateApp(makeDefinition([CHART_WIDGET, KPI_WIDGET, TABLE_WIDGET]), data);
    expect(result.widgetCount).toBe(3);
  });

  it('returns correct sizeBytes', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.sizeBytes).toBe(Buffer.byteLength(result.html, 'utf-8'));
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('generates with a single KPI widget', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1234.56 }]]]);
    const result = generateApp(makeDefinition([KPI_WIDGET]), data);
    expect(result.html).toContain('$1,234.56');
    expect(result.html).toContain('Total Revenue');
  });

  it('generates with a chart widget (includes echarts init)', () => {
    const data: WidgetDataMap = new Map([['chart-1', [{ date: '2026-01', revenue: 100 }]]]);
    const result = generateApp(makeDefinition([CHART_WIDGET]), data);
    expect(result.html).toContain('echarts.init');
    expect(result.html).toContain('chart-chart-1');
  });

  it('generates with a table widget (includes <table>)', () => {
    const data: WidgetDataMap = new Map([['table-1', [{ id: 1, amount: 500 }]]]);
    const result = generateApp(makeDefinition([TABLE_WIDGET]), data);
    expect(result.html).toContain('<table');
    expect(result.html).toContain('Amount');
  });

  it('escapes the app title in the <title> tag', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const result = generateApp(
      makeDefinition([KPI_WIDGET], { title: 'Dashboard <script>alert(1)</script>' }),
      data,
    );
    expect(result.html).toContain('<title>Dashboard &lt;script&gt;');
    expect(result.html).not.toContain('<title>Dashboard <script>');
  });

  it('throws for empty widgets array', () => {
    expect(() => generateApp(makeDefinition([]), new Map())).toThrow('at least one widget');
  });

  it('renders theme toggle when control is configured', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const def = makeDefinition([KPI_WIDGET], { controls: [{ type: 'theme-toggle' }] });
    const result = generateApp(def, data);
    expect(result.html).toContain('theme-toggle');
  });

  it('contains all widget containers for multi-widget definition', () => {
    const data: WidgetDataMap = new Map([
      ['chart-1', [{ date: '2026-01', revenue: 100 }]],
      ['kpi-1', [{ revenue: 42000 }]],
    ]);
    const result = generateApp(makeDefinition([CHART_WIDGET, KPI_WIDGET]), data);
    expect(result.html).toContain('data-widget-id="chart-1"');
    expect(result.html).toContain('data-widget-id="kpi-1"');
  });
});
