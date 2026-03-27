/**
 * dashboard_update tool handler.
 *
 * Modifies an existing dashboard definition by adding, removing, or
 * updating widgets. Re-executes affected queries and returns the
 * updated artifact + rendered blocks.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { DashboardWidget, ChartWidget, KpiWidget, TableWidget } from '../widgets/types.js';
import { parseDashboard, serializeDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';
import { normalizeChartSpec, validateVegaLiteSpec } from '../chart/validator.js';
import { validateQuery } from '../query/validator.js';
import type { CustomBlock } from '@nexora-kit/core';

interface RenderedWidget {
  widgetId: string;
  type: string;
  block: CustomBlock;
}

export function createDashboardUpdateHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const definitionJson = input.definition as string;
    const addWidgetsJson = input.addWidgets as string | undefined;
    const removeWidgetIdsJson = input.removeWidgetIds as string | undefined;
    const updateWidgetsJson = input.updateWidgets as string | undefined;

    if (!dashboardId) {
      return 'Error: dashboardId is required';
    }
    if (!definitionJson) {
      return 'Error: definition is required';
    }

    // Parse current definition
    let def;
    try {
      def = parseDashboard(typeof definitionJson === 'string' ? definitionJson : JSON.stringify(definitionJson));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error parsing dashboard definition: ${message}`;
    }

    const affectedWidgetIds = new Set<string>();

    // Remove widgets
    if (removeWidgetIdsJson) {
      let removeIds: string[];
      try {
        const parsed = typeof removeWidgetIdsJson === 'string'
          ? JSON.parse(removeWidgetIdsJson)
          : removeWidgetIdsJson;
        if (!Array.isArray(parsed)) {
          return 'Error: removeWidgetIds must be a JSON array of strings';
        }
        removeIds = parsed as string[];
      } catch {
        return 'Error: removeWidgetIds must be valid JSON';
      }

      const removeSet = new Set(removeIds);
      def.widgets = def.widgets.filter((w) => !removeSet.has(w.id));
    }

    // Update widgets (merge partial updates)
    if (updateWidgetsJson) {
      let updates: Partial<DashboardWidget>[];
      try {
        const parsed = typeof updateWidgetsJson === 'string'
          ? JSON.parse(updateWidgetsJson)
          : updateWidgetsJson;
        if (!Array.isArray(parsed)) {
          return 'Error: updateWidgets must be a JSON array';
        }
        updates = parsed as Partial<DashboardWidget>[];
      } catch {
        return 'Error: updateWidgets must be valid JSON';
      }

      for (const update of updates) {
        if (!update.id) {
          return 'Error: each widget update must include an id';
        }
        const idx = def.widgets.findIndex((w) => w.id === update.id);
        if (idx === -1) {
          return `Error: widget '${update.id}' not found in dashboard`;
        }
        def.widgets[idx] = { ...def.widgets[idx], ...update } as DashboardWidget;
        affectedWidgetIds.add(update.id!);
      }
    }

    // Add new widgets
    if (addWidgetsJson) {
      let newWidgets: DashboardWidget[];
      try {
        const parsed = typeof addWidgetsJson === 'string'
          ? JSON.parse(addWidgetsJson)
          : addWidgetsJson;
        if (!Array.isArray(parsed)) {
          return 'Error: addWidgets must be a JSON array';
        }
        newWidgets = parsed as DashboardWidget[];
      } catch {
        return 'Error: addWidgets must be valid JSON';
      }

      for (const w of newWidgets) {
        if (!w.id || !w.type) {
          return `Error: new widget is missing required fields (id, type)`;
        }
        if (def.widgets.some((existing) => existing.id === w.id)) {
          return `Error: widget ID '${w.id}' already exists`;
        }
        if (w.type === 'chart') {
          const chart = w as ChartWidget;
          const normalized = normalizeChartSpec(chart.spec);
          if (typeof normalized === 'string') {
            return `Error: chart widget '${w.id}' has invalid spec: ${normalized}`;
          }
          chart.spec = normalized;

          const specValidation = validateVegaLiteSpec(chart.spec.config);
          if (!specValidation.valid) {
            return `Error: chart widget '${w.id}' has invalid spec: ${specValidation.error}`;
          }
        }
        def.widgets.push(w);
        affectedWidgetIds.add(w.id);

        // Add data source if not already tracked
        if (w.type !== 'filter' && 'query' in w) {
          const dsId = (w as ChartWidget | KpiWidget | TableWidget).query.dataSourceId;
          if (!def.dataSources.includes(dsId)) {
            def.dataSources.push(dsId);
          }
        }
      }
    }

    // Re-execute affected widgets (new + updated)
    const renderedWidgets: RenderedWidget[] = [];
    try {
      for (const w of def.widgets) {
        if (!affectedWidgetIds.has(w.id)) continue;

        switch (w.type) {
          case 'chart': {
            const chart = w as ChartWidget;
            const config = registry.getConfig(chart.query.dataSourceId);
            const queryValidation = validateQuery(chart.query.sql ?? '', config.constraints);
            if (!queryValidation.valid) {
              return `Error: chart widget '${w.id}' query validation failed: ${queryValidation.error}`;
            }
            const result = await registry.execute(
              chart.query.dataSourceId,
              chart.query.sql ?? '',
              chart.query.params,
            );
            renderedWidgets.push({
              widgetId: w.id,
              type: 'chart',
              block: {
                type: 'custom:dashboard/chart' as const,
                data: {
                  widgetId: w.id,
                  title: chart.title,
                  spec: chart.spec,
                  data: result.rows,
                  columns: result.columns,
                  rowCount: result.rowCount,
                  truncated: result.truncated,
                },
              },
            });
            break;
          }
          case 'kpi': {
            const kpiResult = await executeKpiWidget(w as KpiWidget, registry);
            renderedWidgets.push({
              widgetId: w.id,
              type: 'kpi',
              block: kpiResult,
            });
            break;
          }
          case 'table': {
            const tableResult = await executeTableWidget(w as TableWidget, registry);
            renderedWidgets.push({
              widgetId: w.id,
              type: 'table',
              block: tableResult,
            });
            break;
          }
          case 'filter':
            break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Dashboard update failed: ${message}`;
    }

    const changeCount = affectedWidgetIds.size + (removeWidgetIdsJson ? 1 : 0);

    return {
      content: `Dashboard '${def.title}' updated — ${def.widgets.length} widget${def.widgets.length === 1 ? '' : 's'} total.`,
      artifacts: [
        {
          type: 'update',
          artifactId: dashboardId,
          title: def.title,
          content: serializeDashboard(def),
          artifactType: 'data',
        },
      ],
      blocks: renderedWidgets.length > 0
        ? [
            {
              type: 'custom:dashboard/grid' as const,
              data: {
                dashboardId,
                title: def.title,
                widgets: renderedWidgets.map((rw) => ({
                  widgetId: rw.widgetId,
                  type: rw.type,
                  size: def.widgets.find((w) => w.id === rw.widgetId)!.size,
                  rendered: rw.block.data,
                })),
              },
            },
          ]
        : undefined,
    };
  };
}
