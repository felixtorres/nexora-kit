import { describe, it, expect } from 'vitest';
import { validateEChartsConfig, normalizeEChartsConfig } from './echarts-validator.js';
import type { EChartsType } from '../app/types.js';

// --- Valid configs for each major chart type ---

describe('validateEChartsConfig — valid configs', () => {
  it('accepts a valid bar chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'category' },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', encode: { x: 'region', y: 'revenue' } }],
      tooltip: { trigger: 'axis' },
    }, 'bar');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a valid line chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      series: [{ type: 'line', encode: { x: 'date', y: 'value' } }],
      tooltip: { trigger: 'axis' },
    }, 'line');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid area chart (maps to line series)', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      series: [{ type: 'line', areaStyle: { opacity: 0.3 } }],
      tooltip: {},
    }, 'area');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid pie chart', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'pie', encode: { itemName: 'name', value: 'amount' } }],
      tooltip: { trigger: 'item' },
    }, 'pie');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid donut chart (maps to pie series)', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'pie', radius: ['40%', '70%'] }],
      tooltip: {},
    }, 'donut');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid gauge chart', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'gauge', detail: { formatter: '{value}%' }, data: [{ value: 72 }] }],
      tooltip: {},
    }, 'gauge');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid scatter chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [{ type: 'scatter' }],
      tooltip: {},
    }, 'scatter');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid heatmap chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'category' },
      yAxis: { type: 'category' },
      visualMap: { min: 0, max: 100 },
      series: [{ type: 'heatmap' }],
      tooltip: {},
    }, 'heatmap');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid candlestick chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'category' },
      yAxis: { type: 'value', scale: true },
      series: [{ type: 'candlestick' }],
      tooltip: {},
    }, 'candlestick');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid radar chart (no cartesian axes required)', () => {
    const result = validateEChartsConfig({
      radar: { indicator: [{ name: 'Sales' }, { name: 'Support' }] },
      series: [{ type: 'radar', data: [] }],
      tooltip: {},
    }, 'radar');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Missing xAxis'))).toBe(false);
  });

  it('accepts a valid funnel chart', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'funnel' }],
      tooltip: {},
    }, 'funnel');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid treemap chart', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'treemap' }],
      tooltip: {},
    }, 'treemap');
    expect(result.valid).toBe(true);
  });
});

// --- Rejection cases ---

describe('validateEChartsConfig — rejection cases', () => {
  it('rejects non-object input', () => {
    const result = validateEChartsConfig('not an object' as any, 'bar');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('plain object');
  });

  it('rejects null input', () => {
    const result = validateEChartsConfig(null as any, 'bar');
    expect(result.valid).toBe(false);
  });

  it('rejects array input', () => {
    const result = validateEChartsConfig([] as any, 'bar');
    expect(result.valid).toBe(false);
  });

  it('rejects unknown chart type', () => {
    const result = validateEChartsConfig({ series: [] }, 'sparkle' as EChartsType);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown chart type');
  });

  it('rejects function body in top-level value', () => {
    const result = validateEChartsConfig({
      tooltip: { formatter: 'function(params) { return params.value; }' },
      series: [{ type: 'bar' }],
      xAxis: {},
      yAxis: {},
    }, 'bar');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Function-like string');
  });

  it('rejects arrow function in nested config', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'bar', label: { formatter: '(val) => { return val + "%" }' } }],
      xAxis: {},
      yAxis: {},
      tooltip: {},
    }, 'bar');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Function-like string');
  });

  it('rejects new Function constructor', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'bar' }],
      xAxis: {},
      yAxis: {},
      tooltip: {},
      axisLabel: { formatter: 'new Function("return 1")' },
    }, 'bar');
    expect(result.valid).toBe(false);
  });

  it('rejects actual function values', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'bar' }],
      xAxis: {},
      yAxis: {},
      tooltip: {},
      formatter: (() => 'x') as any,
    }, 'bar');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Function detected');
  });
});

// --- Warnings ---

describe('validateEChartsConfig — warnings', () => {
  it('warns about missing xAxis for bar chart', () => {
    const result = validateEChartsConfig({
      yAxis: { type: 'value' },
      series: [{ type: 'bar' }],
      tooltip: {},
    }, 'bar');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Missing xAxis'))).toBe(true);
  });

  it('warns about missing yAxis for line chart', () => {
    const result = validateEChartsConfig({
      xAxis: { type: 'time' },
      series: [{ type: 'line' }],
      tooltip: {},
    }, 'line');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Missing yAxis'))).toBe(true);
  });

  it('warns about missing tooltip', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'pie' }],
    }, 'pie');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Missing tooltip'))).toBe(true);
  });

  it('warns about series type mismatch', () => {
    const result = validateEChartsConfig({
      xAxis: {},
      yAxis: {},
      series: [{ type: 'line' }],
      tooltip: {},
    }, 'bar');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("does not match chart type 'bar'"))).toBe(true);
  });

  it('warns about inline data in dataset.source', () => {
    const result = validateEChartsConfig({
      xAxis: {},
      yAxis: {},
      series: [{ type: 'bar' }],
      tooltip: {},
      dataset: { source: [{ a: 1 }, { a: 2 }] },
    }, 'bar');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Inline data'))).toBe(true);
  });

  it('removes inline data from normalized output', () => {
    const result = validateEChartsConfig({
      xAxis: {},
      yAxis: {},
      series: [{ type: 'bar' }],
      tooltip: {},
      dataset: { source: [{ a: 1 }] },
    }, 'bar');
    const dataset = result.normalized.dataset as Record<string, unknown>;
    expect(dataset.source).toBeUndefined();
  });

  it('does not warn about axes for pie chart', () => {
    const result = validateEChartsConfig({
      series: [{ type: 'pie' }],
      tooltip: {},
    }, 'pie');
    expect(result.warnings).not.toContain(expect.stringContaining('Missing xAxis'));
  });
});

// --- normalizeEChartsConfig ---

describe('normalizeEChartsConfig', () => {
  it('parses JSON string input', () => {
    const json = JSON.stringify({
      xAxis: {},
      yAxis: {},
      series: [{ type: 'bar' }],
      tooltip: {},
    });
    const result = normalizeEChartsConfig(json, 'bar');
    expect(typeof result).toBe('object');
    expect((result as any).chartType).toBe('bar');
  });

  it('accepts object input directly', () => {
    const result = normalizeEChartsConfig({
      series: [{ type: 'pie' }],
      tooltip: {},
    }, 'pie');
    expect(typeof result).toBe('object');
    expect((result as any).chartType).toBe('pie');
  });

  it('returns error string for invalid JSON', () => {
    const result = normalizeEChartsConfig('{ bad json }', 'bar');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('valid JSON');
  });

  it('returns error string for non-object', () => {
    const result = normalizeEChartsConfig(42, 'bar');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('JSON object');
  });

  it('returns error string for invalid config (function body)', () => {
    const result = normalizeEChartsConfig({
      series: [{ type: 'bar', formatter: 'function() {}' }],
      xAxis: {},
      yAxis: {},
      tooltip: {},
    }, 'bar');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Invalid ECharts config');
  });

  it('returns error string for unknown chart type', () => {
    const result = normalizeEChartsConfig({}, 'invalid' as EChartsType);
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Unknown chart type');
  });
});
