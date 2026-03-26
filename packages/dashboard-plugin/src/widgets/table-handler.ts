/**
 * Table widget handler — executes the widget's query and returns table block data.
 *
 * Applies pageSize limiting and returns column/row data for rendering.
 */

import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { TabularResult } from '../data-sources/types.js';
import type { TableWidget } from './types.js';

export interface TableBlockData {
  widgetId: string;
  title: string;
  columns: { key: string; label: string; format?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalRows: number;
  truncated: boolean;
  sortable: boolean;
  pageSize?: number;
}

export interface TableResult {
  type: 'custom:dashboard/table';
  data: TableBlockData;
}

export async function executeTableWidget(
  widget: TableWidget,
  registry: DataSourceRegistry,
): Promise<TableResult> {
  const result: TabularResult = await registry.execute(
    widget.query.dataSourceId,
    widget.query.sql ?? '',
    widget.query.params,
  );

  const pageSize = widget.pageSize;
  const truncated = pageSize != null && result.rowCount > pageSize;
  const rows = truncated ? result.rows.slice(0, pageSize) : result.rows;

  return {
    type: 'custom:dashboard/table',
    data: {
      widgetId: widget.id,
      title: widget.title,
      columns: widget.columns,
      rows,
      rowCount: rows.length,
      totalRows: result.rowCount,
      truncated,
      sortable: widget.sortable ?? false,
      pageSize,
    },
  };
}
