/**
 * dashboard_refresh tool handler.
 *
 * Re-executes ALL widget queries in a dashboard and returns
 * updated rendered blocks. Does not modify the definition itself.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { ChartWidget, KpiWidget, TableWidget } from '../widgets/types.js';
import { parseDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';
import { validateQuery } from '../query/validator.js';
import type { CustomBlock } from '@nexora-kit/core';

interface RenderedWidget {
  widgetId: string;
  type: string;
  block: CustomBlock;
}

export function createDashboardRefreshHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const definitionJson = input.definition as string;

    if (!dashboardId) {
      return 'Error: dashboardId is required';
    }
    if (!definitionJson) {
      return 'Error: definition is required';
    }

    let def;
    try {
      def = parseDashboard(typeof definitionJson === 'string' ? definitionJson : JSON.stringify(definitionJson));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error parsing dashboard definition: ${message}`;
    }

    const renderedWidgets: RenderedWidget[] = [];
    try {
      for (const w of def.widgets) {
        switch (w.type) {
          case 'chart': {
            const chart = w as ChartWidget;
            const config = registry.getConfig(chart.query.dataSourceId);
            const queryValidation = validateQuery(chart.query.sql ?? '', config.constraints);
            if (!queryValidation.valid) {
              return `Refresh failed: chart widget '${w.id}' query invalid: ${queryValidation.error}`;
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
      return `Dashboard refresh failed: ${message}`;
    }

    const queryCount = renderedWidgets.length;

    return {
      content: `Dashboard '${def.title}' refreshed — ${queryCount} widget${queryCount === 1 ? '' : 's'} re-executed.`,
      blocks: [
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
      ],
    };
  };
}
