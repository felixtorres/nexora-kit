/**
 * dashboard_cross_filter tool handler.
 *
 * When a user clicks/selects data points on a chart, this handler applies
 * those selections as filter conditions on other widgets.
 */

import type { ToolHandler, ToolHandlerResponse, CustomBlock } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { ChartWidget, KpiWidget, TableWidget, DashboardWidget } from '../widgets/types.js';
import { parseDashboard } from '../widgets/dashboard-model.js';
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

export function createCrossFilterHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const definitionJson = input.definition as string;
    const sourceWidgetId = input.sourceWidgetId as string;
    const selectionJson = input.selection as string;
    const targetWidgetIdsJson = input.targetWidgetIds as string | undefined;

    if (!dashboardId || !definitionJson || !sourceWidgetId || !selectionJson) {
      return 'Error: dashboardId, definition, sourceWidgetId, and selection are required';
    }

    let def;
    try {
      def = parseDashboard(typeof definitionJson === 'string' ? definitionJson : JSON.stringify(definitionJson));
    } catch (error) {
      return `Error parsing dashboard: ${error instanceof Error ? error.message : String(error)}`;
    }

    // Parse selection — a record of field→value from the clicked data point
    let selection: Record<string, unknown>;
    try {
      selection = typeof selectionJson === 'string' ? JSON.parse(selectionJson) : selectionJson as Record<string, unknown>;
    } catch {
      return 'Error: selection must be valid JSON';
    }

    // Determine target widgets
    let targetIds: Set<string>;
    if (targetWidgetIdsJson) {
      try {
        const parsed = typeof targetWidgetIdsJson === 'string' ? JSON.parse(targetWidgetIdsJson) : targetWidgetIdsJson;
        targetIds = new Set(parsed as string[]);
      } catch {
        return 'Error: targetWidgetIds must be a JSON array of strings';
      }
    } else {
      // Default: all queryable widgets except the source
      targetIds = new Set(
        def.widgets
          .filter((w) => w.id !== sourceWidgetId && w.type !== 'filter')
          .map((w) => w.id),
      );
    }

    // Inject selection values as query params on target widgets
    for (const widget of def.widgets) {
      if (targetIds.has(widget.id) && 'query' in widget) {
        const w = widget as ChartWidget | KpiWidget | TableWidget;
        w.query.params = { ...w.query.params, ...selection };
      }
    }

    // Re-execute affected widgets
    const blocks: CustomBlock[] = [];
    try {
      for (const widget of def.widgets) {
        if (!targetIds.has(widget.id)) continue;
        const block = await executeWidget(widget, registry);
        if (block) blocks.push(block);
      }
    } catch (error) {
      return `Cross-filter execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    const fields = Object.keys(selection).join(', ');
    return {
      content: `Cross-filter applied from widget '${sourceWidgetId}': ${fields}. ${blocks.length} widget${blocks.length === 1 ? '' : 's'} updated.`,
      blocks,
    };
  };
}
