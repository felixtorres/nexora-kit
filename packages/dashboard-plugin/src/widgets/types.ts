/**
 * Widget type definitions for the dashboard plugin.
 *
 * A DashboardWidget is a union of all supported widget types.
 * Each widget has an id, type discriminant, title, and grid placement.
 */

// --- Grid & Query Primitives ---

export interface GridSize {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface WidgetQuery {
  dataSourceId: string;
  sql?: string;
  params?: Record<string, unknown>;
}

export interface FilterField {
  name: string;
  label: string;
  type: 'select' | 'date-range' | 'number-range' | 'text-search';
  dataSourceId: string;
  query?: string;
  default?: unknown;
}

// --- Widget Types ---

export interface ChartWidget {
  id: string;
  type: 'chart';
  title: string;
  spec: { engine: 'vega-lite'; config: Record<string, unknown> };
  query: WidgetQuery;
  size: GridSize;
}

export interface KpiWidget {
  id: string;
  type: 'kpi';
  title: string;
  query: WidgetQuery;
  valueField: string;
  format?: 'number' | 'currency' | 'percent';
  comparisonField?: string;
  comparisonLabel?: string;
  size: GridSize;
}

export interface TableWidget {
  id: string;
  type: 'table';
  title: string;
  query: WidgetQuery;
  columns: { key: string; label: string; format?: string }[];
  pageSize?: number;
  sortable?: boolean;
  size: GridSize;
}

export interface FilterWidget {
  id: string;
  type: 'filter';
  targetWidgets: string[];
  fields: FilterField[];
  size: GridSize;
}

export type DashboardWidget = ChartWidget | KpiWidget | TableWidget | FilterWidget;
