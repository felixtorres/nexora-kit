/**
 * Phase 3 tests — verifying interactivity features in generated HTML output.
 * Tests cover: cross-filtering, chart switching, export, controls,
 * table search/pagination, responsive layout, runtime functions.
 */

import { describe, it, expect } from 'vitest';
import { generateApp } from '../generator.js';
import { buildRuntimeScript } from './runtime.js';
import { buildStylesheet } from './styles.js';
import { renderChartWidget } from './widgets/chart.js';
import { renderTableWidget } from './widgets/table.js';
import { renderDateRange } from './controls/date-range.js';
import { renderDropdownFilter } from './controls/dropdown.js';
import { renderExportButton } from './controls/export.js';
import { renderThemeToggle } from './controls/theme-toggle.js';
import type {
  AppDefinition,
  AppChartWidget,
  AppKpiWidget,
  AppTableWidget,
  WidgetDataMap,
} from '../types.js';
import { DEFAULT_APP_LAYOUT } from '../types.js';

// --- Helpers ---

const CHART: AppChartWidget = {
  id: 'chart-1', type: 'chart', title: 'Revenue', chartType: 'bar',
  config: { xAxis: { type: 'category' }, yAxis: { type: 'value' }, series: [{ type: 'bar' }], tooltip: {} },
  query: { dataSourceId: 'db', sql: 'SELECT * FROM sales' },
  size: { col: 1, row: 1, width: 6, height: 3 },
};

const LINE_CHART: AppChartWidget = {
  ...CHART, id: 'chart-line', chartType: 'line',
  config: { ...CHART.config, series: [{ type: 'line' }] },
};

const PIE_CHART: AppChartWidget = {
  ...CHART, id: 'chart-pie', chartType: 'pie',
  config: { series: [{ type: 'pie' }], tooltip: { trigger: 'item' } },
};

const KPI: AppKpiWidget = {
  id: 'kpi-1', type: 'kpi', title: 'Revenue', valueField: 'revenue', format: 'currency',
  query: { dataSourceId: 'db', sql: 'SELECT 1 as revenue' },
  size: { col: 7, row: 1, width: 3, height: 2 },
};

const TABLE: AppTableWidget = {
  id: 'table-1', type: 'table', title: 'Orders', sortable: true, searchable: true, pageSize: 10,
  columns: [{ key: 'id', label: 'ID' }, { key: 'amount', label: 'Amount' }],
  query: { dataSourceId: 'db', sql: 'SELECT * FROM orders' },
  size: { col: 1, row: 4, width: 12, height: 4 },
};

const DATA = [{ region: 'North', revenue: 100 }, { region: 'South', revenue: 80 }];

function makeDef(widgets: AppDefinition['widgets'], controls?: AppDefinition['controls']): AppDefinition {
  return { title: 'Test', theme: 'light', widgets, layout: DEFAULT_APP_LAYOUT, controls };
}

// === Runtime ===

describe('runtime — cross-filtering', () => {
  const runtime = buildRuntimeScript();

  it('defines __applyFilter function', () => {
    expect(runtime).toContain('window.__applyFilter');
  });

  it('defines __clearFilters function', () => {
    expect(runtime).toContain('window.__clearFilters');
  });

  it('defines __updateFilteredWidgets function', () => {
    expect(runtime).toContain('window.__updateFilteredWidgets');
  });

  it('defines __filterState object', () => {
    expect(runtime).toContain('window.__filterState');
  });
});

describe('runtime — chart switching', () => {
  const runtime = buildRuntimeScript();

  it('defines __switchChartType function', () => {
    expect(runtime).toContain('window.__switchChartType');
  });
});

describe('runtime — export', () => {
  const runtime = buildRuntimeScript();

  it('defines __exportAll function', () => {
    expect(runtime).toContain('window.__exportAll');
  });

  it('defines __downloadFile helper', () => {
    expect(runtime).toContain('window.__downloadFile');
  });
});

describe('runtime — table search/pagination', () => {
  const runtime = buildRuntimeScript();

  it('defines __searchTable function', () => {
    expect(runtime).toContain('window.__searchTable');
  });

  it('defines __goToPage function', () => {
    expect(runtime).toContain('window.__goToPage');
  });

  it('defines __renderTablePage function', () => {
    expect(runtime).toContain('window.__renderTablePage');
  });
});

describe('runtime — date range filter', () => {
  const runtime = buildRuntimeScript();

  it('defines __applyDateRange function', () => {
    expect(runtime).toContain('window.__applyDateRange');
  });
});

describe('runtime — patch handler', () => {
  const runtime = buildRuntimeScript();

  it('handles theme-change patches via postMessage', () => {
    expect(runtime).toContain("patch.type === 'theme-change'");
    expect(runtime).toContain('__toggleTheme');
  });
});

// === Chart widget interactivity ===

describe('chart widget — interactivity', () => {
  it('includes chart type switch button for bar charts', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('__switchChartType');
    expect(html).toContain(`switch-${CHART.id}`);
  });

  it('includes chart type switch button for line charts', () => {
    const html = renderChartWidget(LINE_CHART, DATA);
    expect(html).toContain('__switchChartType');
  });

  it('does NOT include switch button for pie charts', () => {
    const html = renderChartWidget(PIE_CHART, DATA);
    expect(html).not.toContain('__switchChartType');
  });

  it('attaches cross-filter click handler', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain("chart.on('click'");
    expect(html).toContain('__applyFilter');
  });
});

// === Table widget interactivity ===

describe('table widget — search', () => {
  it('includes search input when searchable is true', () => {
    const html = renderTableWidget(TABLE, [{ id: 1, amount: 100 }]);
    expect(html).toContain('table-search');
    expect(html).toContain('__searchTable');
  });

  it('omits search input when searchable is not set', () => {
    const noSearch = { ...TABLE, searchable: false };
    const html = renderTableWidget(noSearch, [{ id: 1, amount: 100 }]);
    expect(html).not.toContain('table-search');
  });
});

describe('table widget — pagination footer', () => {
  it('shows pagination when rows exceed pageSize', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ id: i, amount: i * 100 }));
    const html = renderTableWidget(TABLE, rows);
    expect(html).toContain('Showing 1-10 of 15');
    expect(html).toContain(`footer-${TABLE.id}`);
  });

  it('shows row count when no pagination needed', () => {
    const html = renderTableWidget(TABLE, [{ id: 1, amount: 100 }]);
    expect(html).toContain('1 rows');
  });
});

// === Control templates ===

describe('renderDateRange', () => {
  it('renders two date inputs with field-specific IDs', () => {
    const html = renderDateRange('date', 'Date range');
    expect(html).toContain('id="date-from-date"');
    expect(html).toContain('id="date-to-date"');
    expect(html).toContain('__applyDateRange');
  });

  it('escapes field name in attributes', () => {
    const html = renderDateRange('my"field');
    expect(html).toContain('my&quot;field');
  });
});

describe('renderDropdownFilter', () => {
  it('renders select with provided options', () => {
    const html = renderDropdownFilter('region', 'Region', ['North', 'South']);
    expect(html).toContain('<option value="North">North</option>');
    expect(html).toContain('<option value="South">South</option>');
    expect(html).toContain('<option value="">All</option>');
    expect(html).toContain('__applyFilter');
  });

  it('includes auto-populate script when options not provided', () => {
    const html = renderDropdownFilter('region', 'Region');
    // Should include inline script that populates from __DATA
    expect(html).toContain('window.__DATA');
    expect(html).toContain("getElementById('filter-region')");
  });

  it('escapes option values', () => {
    const html = renderDropdownFilter('x', 'X', ['<script>alert(1)</script>']);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderExportButton', () => {
  it('renders PNG export button', () => {
    const html = renderExportButton(['png']);
    expect(html).toContain('__exportAll');
    expect(html).toContain('PNG');
  });

  it('renders CSV export button', () => {
    const html = renderExportButton(['csv']);
    expect(html).toContain('__exportTableCsv');
    expect(html).toContain('CSV');
  });

  it('renders both buttons', () => {
    const html = renderExportButton(['png', 'csv']);
    expect(html).toContain('PNG');
    expect(html).toContain('CSV');
  });
});

describe('renderThemeToggle', () => {
  it('renders toggle button', () => {
    const html = renderThemeToggle();
    expect(html).toContain('theme-toggle');
    expect(html).toContain('__toggleTheme');
  });
});

// === Generator — controls integration ===

describe('generator — control wiring', () => {
  it('renders date-range control in generated app', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const def = makeDef([KPI], [{ type: 'date-range', field: 'date' }]);
    const app = generateApp(def, data);
    expect(app.html).toContain('date-from-date');
    expect(app.html).toContain('date-to-date');
  });

  it('renders dropdown-filter control in generated app', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const def = makeDef([KPI], [{ type: 'dropdown-filter', field: 'region', label: 'Region' }]);
    const app = generateApp(def, data);
    expect(app.html).toContain('filter-region');
    expect(app.html).toContain('Region');
  });

  it('renders export control in generated app', () => {
    const data: WidgetDataMap = new Map([['kpi-1', [{ revenue: 1000 }]]]);
    const def = makeDef([KPI], [{ type: 'export', formats: ['png', 'csv'] }]);
    const app = generateApp(def, data);
    expect(app.html).toContain('PNG');
    expect(app.html).toContain('CSV');
  });
});

// === Styles — responsive ===

describe('styles — responsive breakpoints', () => {
  const css = buildStylesheet();

  it('includes tablet breakpoint at 1024px', () => {
    expect(css).toContain('@media (max-width: 1024px)');
  });

  it('includes mobile breakpoint at 640px', () => {
    expect(css).toContain('@media (max-width: 640px)');
  });

  it('includes table-search styles', () => {
    expect(css).toContain('.table-search');
  });
});
