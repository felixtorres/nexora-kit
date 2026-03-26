/**
 * dashboard_apply_filter tool handler.
 *
 * Applies a filter value to a dashboard, re-executing only the affected widgets.
 * Filter state is stored in the widget's query params and persisted via artifact update.
 */

import type { ToolHandler, ToolHandlerResponse, CustomBlock } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { ChartWidget, KpiWidget, TableWidget, DashboardWidget, FilterWidget } from '../widgets/types.js';
import { parseDashboard, serializeDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';
import { validateQuery } from '../query/validator.js';

async function executeWidget(
  widget: DashboardWidget,
  registry: DataSourceRegistry,
): Promise<CustomBlock | null> {
  switch (widget.type) {
    case 'chart': {
      const chart = widget as ChartWidget;
      const config = registry.getConfig(chart.query.dataSourceId);
      const validation = validateQuery(chart.query.sql ?? '', config.constraints);
      if (!validation.valid) return null;
      const result = await registry.execute(chart.query.dataSourceId, chart.query.sql ?? '', chart.query.params);
      return {
        type: 'custom:dashboard/chart' as const,
        data: {
          widgetId: widget.id,
          title: chart.title,
          spec: chart.spec,
          data: result.rows,
          columns: result.columns,
          rowCount: result.rowCount,
          truncated: result.truncated,
        },
      };
    }
    case 'kpi':
      return executeKpiWidget(widget as KpiWidget, registry);
    case 'table':
      return executeTableWidget(widget as TableWidget, registry);
    default:
      return null;
  }
}

export function createApplyFilterHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const definitionJson = input.definition as string;
    const filterId = input.filterId as string;
    const field = input.field as string;
    const value = input.value;

    if (!dashboardId || !definitionJson || !filterId || !field) {
      return 'Error: dashboardId, definition, filterId, and field are required';
    }

    let def;
    try {
      def = parseDashboard(typeof definitionJson === 'string' ? definitionJson : JSON.stringify(definitionJson));
    } catch (error) {
      return `Error parsing dashboard: ${error instanceof Error ? error.message : String(error)}`;
    }

    // Find the filter widget
    const filterWidget = def.widgets.find((w) => w.id === filterId && w.type === 'filter') as FilterWidget | undefined;
    if (!filterWidget) {
      return `Error: filter widget '${filterId}' not found`;
    }

    // Inject filter value into affected widgets' query params
    const affectedIds = new Set(filterWidget.targetWidgets);
    for (const widget of def.widgets) {
      if (affectedIds.has(widget.id) && 'query' in widget) {
        const w = widget as ChartWidget | KpiWidget | TableWidget;
        w.query.params = { ...w.query.params, [field]: value };
      }
    }

    // Re-execute affected widgets
    const blocks: CustomBlock[] = [];
    try {
      for (const widget of def.widgets) {
        if (!affectedIds.has(widget.id)) continue;
        const block = await executeWidget(widget, registry);
        if (block) blocks.push(block);
      }
    } catch (error) {
      return `Filter execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return {
      content: `Filter applied: ${field} = ${JSON.stringify(value)}. ${blocks.length} widget${blocks.length === 1 ? '' : 's'} updated.`,
      artifacts: [{
        type: 'update',
        artifactId: dashboardId,
        content: serializeDashboard(def),
        artifactType: 'data',
      }],
      blocks,
    };
  };
}
