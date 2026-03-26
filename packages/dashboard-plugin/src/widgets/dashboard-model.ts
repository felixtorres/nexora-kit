/**
 * Dashboard definition model — the serializable representation of a dashboard.
 *
 * Provides helpers to create, serialize, and parse dashboard definitions.
 * parseDashboard() validates required fields and returns a typed result.
 */

import type { DashboardWidget, FilterField } from './types.js';

export interface DashboardDefinition {
  version: 1;
  title: string;
  description?: string;
  dataSources: string[];
  widgets: DashboardWidget[];
  layout: { columns: 12; rowHeight: number };
  filters?: { global: FilterField[] };
  refreshInterval?: number;
}

export function createDashboardDefinition(
  title: string,
  widgets: DashboardWidget[],
  dataSources: string[],
  options?: {
    description?: string;
    rowHeight?: number;
    filters?: { global: FilterField[] };
    refreshInterval?: number;
  },
): DashboardDefinition {
  return {
    version: 1,
    title,
    description: options?.description,
    dataSources,
    widgets,
    layout: { columns: 12, rowHeight: options?.rowHeight ?? 80 },
    filters: options?.filters,
    refreshInterval: options?.refreshInterval,
  };
}

export function serializeDashboard(def: DashboardDefinition): string {
  return JSON.stringify(def, null, 2);
}

export function parseDashboard(json: string): DashboardDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: failed to parse dashboard definition');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid dashboard: expected a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // version
  if (obj.version !== 1) {
    throw new Error(`Unsupported dashboard version: ${String(obj.version ?? 'missing')}`);
  }

  // title
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    throw new Error('Invalid dashboard: title is required and must be a non-empty string');
  }

  // dataSources
  if (!Array.isArray(obj.dataSources) || obj.dataSources.length === 0) {
    throw new Error('Invalid dashboard: dataSources must be a non-empty array');
  }
  for (const ds of obj.dataSources) {
    if (typeof ds !== 'string') {
      throw new Error('Invalid dashboard: each dataSource must be a string');
    }
  }

  // widgets
  if (!Array.isArray(obj.widgets)) {
    throw new Error('Invalid dashboard: widgets must be an array');
  }
  for (const w of obj.widgets) {
    validateWidget(w);
  }

  // layout
  if (typeof obj.layout !== 'object' || obj.layout === null) {
    throw new Error('Invalid dashboard: layout is required');
  }
  const layout = obj.layout as Record<string, unknown>;
  if (layout.columns !== 12) {
    throw new Error('Invalid dashboard: layout.columns must be 12');
  }
  if (typeof layout.rowHeight !== 'number' || layout.rowHeight <= 0) {
    throw new Error('Invalid dashboard: layout.rowHeight must be a positive number');
  }

  return obj as unknown as DashboardDefinition;
}

function validateWidget(w: unknown): void {
  if (typeof w !== 'object' || w === null) {
    throw new Error('Invalid widget: expected an object');
  }

  const widget = w as Record<string, unknown>;

  if (typeof widget.id !== 'string' || widget.id.length === 0) {
    throw new Error('Invalid widget: id is required');
  }

  const validTypes = ['chart', 'kpi', 'table', 'filter'];
  if (!validTypes.includes(widget.type as string)) {
    throw new Error(`Invalid widget type: ${String(widget.type)}`);
  }

  if (typeof widget.size !== 'object' || widget.size === null) {
    throw new Error(`Invalid widget '${widget.id}': size is required`);
  }
}
