/**
 * dashboard_create tool handler.
 *
 * Creates a new dashboard from a title and widget definitions.
 * Validates widgets, executes all queries, and returns an artifact
 * with the serialized definition plus rendered widget blocks.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { DashboardWidget, ChartWidget, KpiWidget, TableWidget } from '../widgets/types.js';
import { createDashboardDefinition, serializeDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';
import { normalizeChartSpec, validateVegaLiteSpec } from '../chart/validator.js';
import { validateQuery } from '../query/validator.js';
import type { CustomBlock } from '@nexora-kit/core';

export interface ChartBlockData {
  widgetId: string;
  title: string;
  spec: { engine: string; config: Record<string, unknown> };
  data: Record<string, unknown>[];
  columns: { key: string; label: string; type: string }[];
  rowCount: number;
  truncated: boolean;
}

interface RenderedWidget {
  widgetId: string;
  type: string;
  block: CustomBlock;
}

export function createDashboardCreateHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const title = input.title as string;
    const widgetsJson = input.widgets as string;
    const dataSourceId = input.dataSourceId as string | undefined;

    if (!title) {
      return 'Error: title is required';
    }
    if (!widgetsJson) {
      return 'Error: widgets JSON is required';
    }

    // Parse widgets
    let widgets: DashboardWidget[];
    try {
      const parsed = typeof widgetsJson === 'string' ? JSON.parse(widgetsJson) : widgetsJson;
      if (!Array.isArray(parsed)) {
        return 'Error: widgets must be a JSON array';
      }
      widgets = parsed as DashboardWidget[];
    } catch {
      return 'Error: widgets must be valid JSON';
    }

    if (widgets.length === 0) {
      return 'Error: at least one widget is required';
    }

    // Validate each widget has required fields
    for (const w of widgets) {
      if (!w.id || !w.type) {
        return `Error: widget is missing required fields (id, type)`;
      }
      const validTypes = ['chart', 'kpi', 'table', 'filter'];
      if (!validTypes.includes(w.type)) {
        return `Error: invalid widget type '${w.type}' for widget '${w.id}'`;
      }
      if (!w.size) {
        return `Error: widget '${w.id}' is missing size`;
      }
    }

    // Normalize and validate chart specs before executing anything
    for (const w of widgets) {
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
    }

    // Collect data source IDs
    const dataSources = new Set<string>();
    if (dataSourceId) {
      dataSources.add(dataSourceId);
    }
    for (const w of widgets) {
      if (w.type !== 'filter' && 'query' in w) {
        dataSources.add((w as ChartWidget | KpiWidget | TableWidget).query.dataSourceId);
      }
    }

    // Create the definition
    const def = createDashboardDefinition(title, widgets, [...dataSources]);

    // Execute all widget queries
    const renderedWidgets: RenderedWidget[] = [];
    try {
      for (const w of widgets) {
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
                } satisfies ChartBlockData,
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
            // Filters don't execute queries — they're UI-only
            break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Dashboard creation failed: ${message}`;
    }

    const dashboardId = crypto.randomUUID();

    return {
      content: `Dashboard '${title}' created with ${widgets.length} widget${widgets.length === 1 ? '' : 's'}.`,
      artifacts: [
        {
          type: 'create',
          artifactId: dashboardId,
          title,
          content: serializeDashboard(def),
          artifactType: 'data',
        },
      ],
      blocks: [
        {
          type: 'custom:dashboard/grid' as const,
          data: {
            dashboardId,
            title,
            widgets: renderedWidgets.map((rw) => ({
              widgetId: rw.widgetId,
              type: rw.type,
              size: widgets.find((w) => w.id === rw.widgetId)!.size,
              rendered: rw.block.data,
            })),
          },
        },
      ],
    };
  };
}
