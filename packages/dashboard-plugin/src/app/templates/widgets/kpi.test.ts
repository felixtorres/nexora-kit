import { describe, it, expect } from 'vitest';
import { renderKpiWidget } from './kpi.js';
import type { AppKpiWidget } from '../../types.js';

const KPI: AppKpiWidget = {
  id: 'kpi-revenue',
  type: 'kpi',
  title: 'Total Revenue',
  query: { dataSourceId: 'db', sql: 'SELECT sum(amount) as revenue FROM sales' },
  valueField: 'revenue',
  format: 'currency',
  size: { col: 1, row: 1, width: 3, height: 2 },
};

const DATA = [{ revenue: 1234567.89 }];

describe('renderKpiWidget', () => {
  it('contains the formatted value', () => {
    const html = renderKpiWidget(KPI, DATA);
    expect(html).toContain('$1,234,567.89');
  });

  it('contains the title (escaped)', () => {
    const html = renderKpiWidget(KPI, DATA);
    expect(html).toContain('Total Revenue');
  });

  it('shows delta when comparisonField is set', () => {
    const kpiWithDelta: AppKpiWidget = {
      ...KPI,
      comparisonField: 'delta',
      comparisonLabel: 'vs prev',
    };
    const data = [{ revenue: 1000, delta: 8.3 }];
    const html = renderKpiWidget(kpiWithDelta, data);
    expect(html).toContain('kpi-delta');
    expect(html).toContain('vs prev');
    expect(html).toContain('up');
  });

  it('shows down direction for negative delta', () => {
    const kpiWithDelta: AppKpiWidget = { ...KPI, comparisonField: 'delta' };
    const data = [{ revenue: 1000, delta: -5.2 }];
    const html = renderKpiWidget(kpiWithDelta, data);
    expect(html).toContain('down');
  });

  it('omits delta section when comparisonField is not set', () => {
    const html = renderKpiWidget(KPI, DATA);
    expect(html).not.toContain('kpi-delta');
  });

  it('escapes XSS in title', () => {
    const xssKpi = { ...KPI, title: '<script>alert(1)</script>' };
    const html = renderKpiWidget(xssKpi, DATA);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles empty data gracefully', () => {
    const html = renderKpiWidget(KPI, []);
    expect(html).toContain('$0.00');
  });

  it('formats percent values', () => {
    const pctKpi: AppKpiWidget = { ...KPI, format: 'percent' };
    const data = [{ revenue: 94.5 }];
    const html = renderKpiWidget(pctKpi, data);
    expect(html).toContain('94.5%');
  });
});
