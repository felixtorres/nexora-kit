/**
 * KPI widget handler — executes the widget's query and returns a custom:dashboard/kpi block.
 *
 * Expects a single-row result. Formats the value based on widget.format
 * and calculates a comparison delta if comparisonField is set.
 */

import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { KpiWidget } from './types.js';

export interface KpiBlockData {
  widgetId: string;
  title: string;
  value: number;
  formattedValue: string;
  format: 'number' | 'currency' | 'percent';
  delta?: number;
  formattedDelta?: string;
  comparisonLabel?: string;
}

export interface KpiResult {
  type: 'custom:dashboard/kpi';
  data: KpiBlockData;
}

function formatValue(value: number, format: 'number' | 'currency' | 'percent'): string {
  switch (format) {
    case 'currency':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'number':
    default:
      return value.toLocaleString('en-US');
  }
}

function formatDelta(delta: number, format: 'number' | 'currency' | 'percent'): string {
  const sign = delta >= 0 ? '+' : '-';
  const abs = Math.abs(delta);
  switch (format) {
    case 'currency':
      return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${sign}${(abs * 100).toFixed(1)}%`;
    case 'number':
    default:
      return `${sign}${abs.toLocaleString('en-US')}`;
  }
}

export async function executeKpiWidget(
  widget: KpiWidget,
  registry: DataSourceRegistry,
): Promise<KpiResult> {
  const result = await registry.execute(
    widget.query.dataSourceId,
    widget.query.sql ?? '',
    widget.query.params,
  );

  if (result.rowCount === 0) {
    throw new Error(`KPI widget '${widget.id}': query returned no rows`);
  }

  const row = result.rows[0];
  const rawValue = row[widget.valueField];

  if (rawValue === undefined || rawValue === null) {
    throw new Error(`KPI widget '${widget.id}': valueField '${widget.valueField}' not found in result`);
  }

  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    throw new Error(`KPI widget '${widget.id}': valueField '${widget.valueField}' is not a number`);
  }

  const format = widget.format ?? 'number';
  const formattedValue = formatValue(value, format);

  const blockData: KpiBlockData = {
    widgetId: widget.id,
    title: widget.title,
    value,
    formattedValue,
    format,
  };

  if (widget.comparisonField) {
    const compRaw = row[widget.comparisonField];
    if (compRaw !== undefined && compRaw !== null) {
      const compValue = Number(compRaw);
      if (!Number.isNaN(compValue)) {
        const delta = value - compValue;
        blockData.delta = delta;
        blockData.formattedDelta = formatDelta(delta, format);
        if (widget.comparisonLabel) {
          blockData.comparisonLabel = widget.comparisonLabel;
        }
      }
    }
  }

  return {
    type: 'custom:dashboard/kpi',
    data: blockData,
  };
}
