/**
 * Type definitions for the dashboard app generator (v2 — app mode).
 *
 * App mode generates self-contained HTML/CSS/JS dashboard apps with ECharts,
 * as opposed to classic mode which produces JSON definitions for platform rendering.
 */

import type { GridSize, WidgetQuery } from '../widgets/types.js';

// --- ECharts ---

export type EChartsType =
  | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter'
  | 'heatmap' | 'treemap' | 'sunburst' | 'funnel' | 'radar'
  | 'gauge' | 'candlestick' | 'boxplot' | 'sankey' | 'graph'
  | 'calendar' | 'parallel' | 'themeRiver' | 'map';

export const VALID_ECHART_TYPES = new Set<EChartsType>([
  'bar', 'line', 'area', 'pie', 'donut', 'scatter',
  'heatmap', 'treemap', 'sunburst', 'funnel', 'radar',
  'gauge', 'candlestick', 'boxplot', 'sankey', 'graph',
  'calendar', 'parallel', 'themeRiver', 'map',
]);

/**
 * Maps app-level chart types to the ECharts series type string.
 * 'area' → 'line' (with areaStyle), 'donut' → 'pie' (with radius).
 */
export function mapChartTypeToSeriesType(chartType: EChartsType): string {
  switch (chartType) {
    case 'area': return 'line';
    case 'donut': return 'pie';
    default: return chartType;
  }
}

// --- App Widget Types ---

export interface AppChartWidget {
  id: string;
  type: 'chart';
  title: string;
  chartType: EChartsType;
  config: Record<string, unknown>;
  query: WidgetQuery;
  size: GridSize;
}

export interface AppKpiWidget {
  id: string;
  type: 'kpi';
  title: string;
  query: WidgetQuery;
  valueField: string;
  format?: 'number' | 'currency' | 'percent';
  comparisonField?: string;
  comparisonLabel?: string;
  sparkline?: boolean;
  size: GridSize;
}

export interface AppTableWidget {
  id: string;
  type: 'table';
  title: string;
  query: WidgetQuery;
  columns: { key: string; label: string; format?: string }[];
  pageSize?: number;
  sortable?: boolean;
  searchable?: boolean;
  size: GridSize;
}

export interface AppStatWidget {
  id: string;
  type: 'stat';
  title: string;
  query: WidgetQuery;
  valueField: string;
  format?: 'number' | 'currency' | 'percent';
  trendField?: string;
  size: GridSize;
}

export interface AppGaugeWidget {
  id: string;
  type: 'gauge';
  title: string;
  query: WidgetQuery;
  valueField: string;
  min?: number;
  max?: number;
  thresholds?: { value: number; color: string }[];
  size: GridSize;
}

export interface AppMetricCardWidget {
  id: string;
  type: 'metric-card';
  title: string;
  query: WidgetQuery;
  valueField: string;
  format?: 'number' | 'currency' | 'percent';
  sparklineField?: string;
  sparklineQuery?: WidgetQuery;
  size: GridSize;
}

export interface AppTextWidget {
  id: string;
  type: 'text';
  title: string;
  content: string;
  size: GridSize;
}

export type AppWidget =
  | AppChartWidget
  | AppKpiWidget
  | AppTableWidget
  | AppStatWidget
  | AppGaugeWidget
  | AppMetricCardWidget
  | AppTextWidget;

// --- App Controls ---

export type AppControl =
  | { type: 'theme-toggle' }
  | { type: 'export'; formats: ('png' | 'csv')[] }
  | { type: 'fullscreen' }
  | { type: 'date-range'; field: string; defaultRange?: string }
  | { type: 'dropdown-filter'; field: string; label: string; options?: string[] };

// --- App Definition ---

export interface AppLayout {
  columns: { desktop: number; tablet: number; mobile: number };
  gap: number;
  padding: number;
  maxWidth?: string;
}

export const DEFAULT_APP_LAYOUT: AppLayout = {
  columns: { desktop: 12, tablet: 6, mobile: 1 },
  gap: 16,
  padding: 24,
  maxWidth: '1400px',
};

export interface AppDefinition {
  title: string;
  description?: string;
  theme: 'light' | 'dark' | 'auto';
  widgets: AppWidget[];
  layout: AppLayout;
  controls?: AppControl[];
}

// --- Generator Output ---

export interface GeneratedApp {
  html: string;
  title: string;
  widgetCount: number;
  sizeBytes: number;
}

// --- Resolved Widget Data ---

/** Widget data resolved from query execution, keyed by widget ID. */
export type WidgetDataMap = Map<string, Record<string, unknown>[]>;
