import { describe, it, expect } from 'vitest';
import { renderChartWidget } from './chart.js';
import type { AppChartWidget } from '../../types.js';

const CHART: AppChartWidget = {
  id: 'rev-chart',
  type: 'chart',
  title: 'Revenue Trend',
  chartType: 'line',
  config: {
    xAxis: { type: 'time' },
    yAxis: { type: 'value' },
    series: [{ type: 'line' }],
  },
  query: { dataSourceId: 'db', sql: 'SELECT * FROM sales' },
  size: { col: 1, row: 1, width: 6, height: 3 },
};

const DATA = [{ date: '2026-01', revenue: 100 }, { date: '2026-02', revenue: 150 }];

describe('renderChartWidget', () => {
  it('contains the widget ID', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('data-widget-id="rev-chart"');
  });

  it('contains the chart title (escaped)', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('Revenue Trend');
  });

  it('contains echarts.init call', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('echarts.init');
  });

  it('embeds data via escapeJsonForScript (no raw </script>)', () => {
    const dangerousData = [{ val: '</script><script>alert(1)</script>' }];
    const html = renderChartWidget(CHART, dangerousData);
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('<\\/script>');
  });

  it('sets grid placement via style attribute', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('grid-column: 1 / span 6');
    expect(html).toContain('grid-row: 1 / span 3');
  });

  it('escapes XSS in title', () => {
    const xssChart = { ...CHART, title: '<img onerror="alert(1)">' };
    const html = renderChartWidget(xssChart, DATA);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror');
  });

  it('includes chart container div', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain('id="chart-rev-chart"');
    expect(html).toContain('class="chart-container"');
  });

  it('registers chart in window.__charts', () => {
    const html = renderChartWidget(CHART, DATA);
    expect(html).toContain("window.__charts['rev-chart']");
  });
});
