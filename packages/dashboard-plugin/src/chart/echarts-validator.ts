/**
 * ECharts config validation for the dashboard app generator.
 *
 * Validates ECharts option objects to ensure they are safe (no JS functions),
 * structurally correct (series matches chart type), and well-formed.
 */

import type { EChartsType } from '../app/types.js';
import { VALID_ECHART_TYPES, mapChartTypeToSeriesType } from '../app/types.js';

export interface EChartsValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: Record<string, unknown>;
}

/**
 * Validate an ECharts option config for a given chart type.
 *
 * Checks:
 * 1. Config is a plain object
 * 2. Chart type is valid
 * 3. No JavaScript function bodies (security)
 * 4. Series type matches chart type
 * 5. Axis presence for cartesian charts
 * 6. Tooltip presence
 * 7. Inline data detection
 */
export function validateEChartsConfig(
  config: unknown,
  chartType: EChartsType,
): EChartsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check chart type
  if (!VALID_ECHART_TYPES.has(chartType)) {
    errors.push(`Unknown chart type: ${chartType}`);
    return { valid: false, errors, warnings, normalized: {} };
  }

  // 2. Check config is a plain object
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    errors.push('Config must be a plain object');
    return { valid: false, errors, warnings, normalized: {} };
  }

  const obj = config as Record<string, unknown>;

  // 3. Reject JavaScript functions (security)
  const functionViolations = detectFunctions(obj);
  errors.push(...functionViolations);

  // 4. Validate series matches chart type
  const expectedSeriesType = mapChartTypeToSeriesType(chartType);
  if (obj.series) {
    const series = Array.isArray(obj.series) ? obj.series : [obj.series];
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      if (typeof s === 'object' && s !== null) {
        const seriesType = (s as Record<string, unknown>).type;
        if (seriesType && seriesType !== expectedSeriesType) {
          warnings.push(
            `Series[${i}] type '${seriesType}' does not match chart type '${chartType}' (expected '${expectedSeriesType}')`,
          );
        }
      }
    }
  }

  // 5. Validate axis presence for cartesian charts
  const cartesianTypes: EChartsType[] = ['bar', 'line', 'area', 'scatter', 'candlestick', 'boxplot'];
  if (cartesianTypes.includes(chartType)) {
    if (!obj.xAxis) warnings.push(`Missing xAxis for ${chartType} chart`);
    if (!obj.yAxis) warnings.push(`Missing yAxis for ${chartType} chart`);
  }

  // 6. Validate tooltip presence
  if (!obj.tooltip) {
    warnings.push('Missing tooltip configuration');
  }

  // 7. Detect and remove inline data
  const normalized = structuredCloneShallow(obj);
  if (normalized.dataset && typeof normalized.dataset === 'object' && normalized.dataset !== null) {
    const dataset = normalized.dataset as Record<string, unknown>;
    if (Array.isArray(dataset.source) && dataset.source.length > 0) {
      warnings.push('Inline data detected in dataset.source — data will be injected from query results');
      delete dataset.source;
    }
  }

  return { valid: errors.length === 0, errors, warnings, normalized };
}

/**
 * Normalize raw input into a validated ECharts config.
 *
 * Accepts a JSON string or an object. Returns the normalized config
 * or an error string.
 */
export function normalizeEChartsConfig(
  raw: unknown,
  chartType: EChartsType,
): { chartType: EChartsType; config: Record<string, unknown> } | string {
  // Parse JSON string if needed
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'Error: ECharts config must be valid JSON';
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Error: ECharts config must be a JSON object';
  }

  const result = validateEChartsConfig(parsed, chartType);
  if (!result.valid) {
    return `Invalid ECharts config: ${result.errors.join('; ')}`;
  }

  return { chartType, config: result.normalized };
}

// --- Internal helpers ---

/**
 * Recursively scan an object for values that look like JavaScript function bodies.
 * Returns a list of violation messages.
 */
function detectFunctions(obj: unknown, path: string[] = []): string[] {
  const violations: string[] = [];

  if (typeof obj === 'function') {
    violations.push(`Function detected at ${path.join('.') || 'root'}`);
    return violations;
  }

  if (typeof obj === 'string') {
    if (/\bfunction\s*\(/.test(obj) || /=>\s*[{(]/.test(obj) || /\bnew\s+Function\b/.test(obj)) {
      violations.push(`Function-like string at ${path.join('.') || 'root'}: "${obj.slice(0, 50)}..."`);
    }
    return violations;
  }

  if (typeof obj === 'object' && obj !== null) {
    const entries = Array.isArray(obj)
      ? obj.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(obj);
    for (const [key, val] of entries) {
      violations.push(...detectFunctions(val, [...path, key]));
    }
  }

  return violations;
}

function structuredCloneShallow(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = { ...(val as Record<string, unknown>) };
    } else {
      result[key] = val;
    }
  }
  return result;
}
